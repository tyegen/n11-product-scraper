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
    const enqueued = await enqueueLinks({
        selector: 'a.product-item',
        label: 'detail',
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
        await page.waitForLoadState('domcontentloaded');

        // Extract product data from window.productModel
        const productData = await page.evaluate(() => {
            const w = window as any;
            return w.productModel || null;
        });
        
        if (!productData) {
            log.warning(`[PRODUCT] No productModel data found for ${request.url}`);
            
            // SAVE DEBUG HTML
            const html = await page.content();
            await Actor.setValue(`DEBUG-${Date.now()}`, html, { contentType: 'text/html' });
            log.info(`[PRODUCT] Saved debug HTML for ${request.url}`);
            
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
