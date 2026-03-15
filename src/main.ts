import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { router } from './routes.js';

await Actor.init();

const input = await Actor.getInput<{ 
    startUrls: any[]; 
    maxItems?: number; 
    maxRequestsPerCrawl?: number; 
    proxyConfiguration?: any 
}>() as any;

const {
    startUrls = ['https://www.n11.com/bilgisayar/dizustu-bilgisayar'],
    maxItems = 100,
    maxRequestsPerCrawl = 50,
    proxyConfiguration: proxyConfig,
} = input;

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    // Use maxRequestsPerCrawl from input, or fallback to a sensible default
    maxRequestsPerCrawl,
    maxRequestRetries: 5,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 20,
    },
    requestHandler: router,
    requestHandlerTimeoutSecs: 60,
    browserPoolOptions: {
        useFingerprints: true,
    },
    launchContext: {
        useChrome: true,
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled'],
        },
    },
    preNavigationHooks: [
        async ({ page, gotoOptions }) => {
            // Random delay 1-3s
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Upgrade-Insecure-Requests': '1',
                'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                'sec-ch-ua-platform': '"Windows"',
            });
            if (gotoOptions) {
                (gotoOptions as any).waitUntil = 'domcontentloaded';
            }
        },
    ],
    postNavigationHooks: [
        async ({ response, session, log, request }) => {
            if (response && response.status() === 403) {
                log.warning(`[403] BLOCK detected for ${request.url}. Retiring session...`);
                session?.retire();
                throw new Error(`403 Forbidden: Proxy/Session blocked.`);
            }
        },
    ],
});

console.log(`Starting crawl with maxItems: ${maxItems}, maxRequestsPerCrawl: ${maxRequestsPerCrawl}`);
await crawler.run(startUrls.map((req: any) => ({
    ...req,
    userData: { maxItems, ...req.userData },
})));

await Actor.exit();
