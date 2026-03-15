import { createPlaywrightRouter } from 'crawlee';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

// Default handler for category pages
router.addDefaultHandler(async ({ request, page, enqueueLinks, log }) => {
    log.info(`[CATEGORY] Processing ${request.url}`);

    // Wait for product items to appear
    await page.waitForSelector('a.product-item', { timeout: 15000 }).catch(() => {
        log.warning(`[CATEGORY] Product items didn't load for ${request.url}`);
    });

    // Enqueue product links
    // Check if we already have enough products
    const enqueued = await enqueueLinks({
        selector: 'a.product-item',
        label: 'detail',
        userData: request.userData, // Pass maxItems forward
    });
    
    log.info(`[CATEGORY] Enqueued ${enqueued.processedRequests.length} products from ${request.url}`);

    // Handle pagination (n11 pagination uses ?pg=2 or similar)
    await enqueueLinks({
        selector: '.pagination a, a.next',
        globs: ['https://www.n11.com/**?pg=*'],
    });
});

// Handler for product detail pages
router.addHandler('detail', async ({ request, page, log }) => {
    log.info(`[PRODUCT] Extracting: ${request.url}`);

    try {
        // Extract product data - check multiple possible locations
        const productData = await page.evaluate(() => {
            const w = window as any;
            // Return the first one that has data
            return w.productModel || w.__PRELOADED_STATE__ || w.productDetail || null;
        });
        
        if (!productData) {
            log.warning(`[PRODUCT] No product data found in window for ${request.url}`);
            
            // DEBUG: Save Screenshot and HTML
            const timestamp = Date.now();
            const screenshot = await page.screenshot();
            await Actor.setValue(`DEBUG-SCREENSHOT-${timestamp}.png`, screenshot, { contentType: 'image/png' });
            
            const html = await page.content();
            await Actor.setValue(`DEBUG-HTML-${timestamp}.html`, html, { contentType: 'text/html' });
            
            log.info(`[PRODUCT] Saved debug data (screenshot and HTML) for ${request.url}`);
            return;
        }

        // Map n11 productModel to flat structure
        // n11 productModel structure:
        // product: { id, title, price, ... }
        // seller: { name, id, ... }
        const p = productData.product || {};
        const s = productData.seller || {};
        
        // Handle price - n11 has various price fields (displayPrice, lowPrice, etc.)
        // We'll try to find the final price (similar to "SEPETTE" discount logic)
        const priceValue = p.lowPrice || p.displayPrice || null;
        const priceText = p.displayPrice ? `${p.displayPrice} TL` : 'N/A';

        // Images
        const images = p.images || [];
        const thumbnail = images.length > 0 ? images[0] : '';

        // Check if we already reached maxItems
        // We can use Actor.pushData's count or a local counter
        // For simplicity and accuracy in a distributed setting, we use Actor.pushData
        // but for local crawler control, we can communicate via global state or userData
        
        await Actor.pushData({
            thumbnail,
            productId: String(p.id || ''),
            title: p.title || '',
            brand: p.brand || '',
            price: priceText,
            priceValue: priceValue ? Number(priceValue) : null,
            sellerName: s.name || '',
            sellerId: String(s.id || ''),
            category: p.categoryName || '',
            inStock: p.inStock ?? true,
            url: request.url,
            scrapedAt: new Date().toISOString()
        });

        log.info(`[PRODUCT] ✓ ${p.brand || ''} - ${p.title} | ${priceText}`);
    } catch (e: any) {
        log.error(`[PRODUCT] Failed: ${request.url}: ${e.message}`);
    }
});
