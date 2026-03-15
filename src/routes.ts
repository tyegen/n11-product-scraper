import { createPlaywrightRouter } from 'crawlee';
import { Actor } from 'apify';
import { gotScraping } from 'crawlee';

export const router = createPlaywrightRouter();

/**
 * Fetch a single product detail via HTTP (fallback for lightweight extraction)
 */
async function fetchProductDetail(url: string, proxyUrl?: string): Promise<any | null> {
    try {
        const response = await gotScraping({
            url,
            proxyUrl,
            headers: {
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Upgrade-Insecure-Requests': '1',
            },
        });
        if (response.statusCode !== 200) return null;
        
        const html = response.body;
        // Search for window.productModel or similar in the HTML string
        const marker = 'window.productModel = ';
        const idx = html.indexOf(marker);
        if (idx < 0) return null;
        
        const jsonStart = idx + marker.length;
        const scriptEnd = html.indexOf(';', jsonStart);
        if (scriptEnd < 0) return null;
        
        const jsonStr = html.substring(jsonStart, scriptEnd).trim();
        return JSON.parse(jsonStr);
    } catch {
        return null;
    }
}

/**
 * Greedy data mapper to handle different JSON structures (listing vs detail)
 */
function formatProduct(p: any, url: string) {
    // Handle potential differences between listing data and detail data
    // n11 usually has product and seller objects
    const product = p.product || p;
    const seller = p.seller || {};
    
    // Price extraction logic - greedy
    const priceText = product.displayPrice || product.price || 'N/A';
    const priceValue = product.lowPrice || product.displayPrice || product.priceValue || null;
    
    // Thumbnail logic
    const img = product.images?.[0] || product.image || '';

    return {
        thumbnail: img,
        productId: String(product.id || ''),
        title: product.title || product.name || '',
        brand: product.brand || '',
        price: priceText,
        priceValue: priceValue ? Number(priceValue) : null,
        sellerName: seller.name || '',
        sellerId: String(seller.id || ''),
        category: product.categoryName || '',
        inStock: product.inStock ?? true,
        url: product.url ? (product.url.startsWith('http') ? product.url : `https://www.n11.com${product.url}`) : url,
        scrapedAt: new Date().toISOString()
    };
}

// Default handler for category pages (Hybrid approach)
router.addDefaultHandler(async ({ request, page, enqueueLinks, log }) => {
    log.info(`[CATEGORY] Processing ${request.url}`);

    const { maxItems = 100 } = request.userData as any;

    // Wait for product layout to appear
    await page.waitForSelector('a.product-item', { timeout: 15000 }).catch(() => {
        log.warning(`[CATEGORY] Product items didn't load for ${request.url}`);
    });

    // STEP 1: Greedy search for product list in window PROPS/STATE
    const categoryData = await page.evaluate(() => {
        const w = window as any;
        // Search for all possible state objects
        const searchKeys = ['productModel', '__PRELOADED_STATE__', 'productDetail'];
        
        for (const key of searchKeys) {
            const val = w[key];
            if (!val) continue;

            // Look for product arrays inside
            let products: any[] | null = null;
            if (Array.isArray(val.products)) products = val.products;
            else if (val.searchResult?.products) products = val.searchResult.products;
            else if (val.categoryProducts?.products) products = val.categoryProducts.products;
            else if (val.data?.products) products = val.data.products;
            
            if (products && products.length > 0) {
                // Serialization Fix: Force flatten proxies
                return {
                    source: key,
                    products: JSON.parse(JSON.stringify(products))
                };
            }
        }
        return { source: null, products: [] as any[] };
    });

    let currentCount = 0;
    if (categoryData.products.length > 0) {
        log.info(`[CATEGORY] Found ${categoryData.products.length} products in window.${categoryData.source}. Extracting directly...`);
        
        for (const p of categoryData.products) {
            if (currentCount >= maxItems) {
                log.info(`[CATEGORY] Reached maxItems limit (${maxItems}) during listing extraction.`);
                return;
            }
            const data = formatProduct(p, request.url);
            await Actor.pushData(data);
            currentCount++;
            log.info(`[PRODUCT] ✓ ${data.brand} - ${data.title} | ${data.price}`);
        }
    } else {
        log.warning(`[CATEGORY] No products found in window objects for ${request.url}. Checking for DOM items...`);
        
        // Check if there are items in the DOM even if window variables are missing
        const domCount = await page.$$eval('a.product-item', (items) => items.length);
        if (domCount === 0) {
            log.error(`[CATEGORY] NO PRODUCTS FOUND ON PAGE: ${request.url}. Capturing debug info...`);
            
            // DEBUG: Save Screenshot and HTML
            const timestamp = Date.now();
            const screenshot = await page.screenshot().catch(() => null);
            if (screenshot) await Actor.setValue(`DEBUG-CAT-SCREENSHOT-${timestamp}.png`, screenshot, { contentType: 'image/png' });
            
            const html = await page.content();
            await Actor.setValue(`DEBUG-CAT-HTML-${timestamp}.html`, html, { contentType: 'text/html' });
        } else {
            log.info(`[CATEGORY] Found ${domCount} items in DOM, but JSON variables were empty. Enqueuing via detail handler...`);
        }
    }

    // STEP 2: Paginate and enqueue links if we need more
    if (currentCount < maxItems) {
        log.info(`[CATEGORY] Need more products (${currentCount}/${maxItems}). Enqueuing pagination and details...`);
        
        // Enqueue details for products not yet extracted (if any)
        await enqueueLinks({
            selector: 'a.product-item',
            label: 'detail',
            userData: request.userData,
        });

        // Pagination
        await enqueueLinks({
            selector: '.pagination a, a.next',
            globs: ['https://www.n11.com/**?pg=*'],
            userData: request.userData,
        });
    }
});

// Handler for product detail pages
router.addHandler('detail', async ({ request, page, log }) => {
    log.info(`[PRODUCT] Extracting: ${request.url}`);

    try {
        // Greedy search for detail data
        let productData = await page.evaluate(() => {
            const w = window as any;
            const data = w.productModel || w.__PRELOADED_STATE__ || w.productDetail || null;
            // Serialization Fix
            return data ? JSON.parse(JSON.stringify(data)) : null;
        });
        
        if (!productData) {
            log.info(`[PRODUCT] Variable missing in window for ${request.url}. Falling back to HTTP fetch...`);
            
            // Fallback to HTTP Fetch to save browser resources
            productData = await fetchProductDetail(request.url);
        }
        
        if (!productData) {
            log.warning(`[PRODUCT] Failed to extract data for ${request.url}. Capturing debug info...`);
            
            // DEBUG: Save Screenshot and HTML
            const timestamp = Date.now();
            const screenshot = await page.screenshot().catch(() => null);
            if (screenshot) await Actor.setValue(`DEBUG-SCREENSHOT-${timestamp}.png`, screenshot, { contentType: 'image/png' });
            
            const html = await page.content();
            await Actor.setValue(`DEBUG-HTML-${timestamp}.html`, html, { contentType: 'text/html' });
            
            return;
        }

        const data = formatProduct(productData, request.url);
        await Actor.pushData(data);
        log.info(`[PRODUCT] ✓ ${data.brand} - ${data.title} | ${data.price}`);
    } catch (e: any) {
        log.error(`[PRODUCT] Failed: ${request.url}: ${e.message}`);
    }
});
