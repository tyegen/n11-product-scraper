import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { router } from './routes.js';

await Actor.init();

const {
    startUrls = ['https://www.n11.com/bilgisayar/dizustu-bilgisayar'],
    proxyConfiguration: proxyConfig,
} = await Actor.getInput() as any;

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    // n11 might have anti-bot, so we use common browser launch options
    launchContext: {
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled'],
        },
    },
});

await crawler.run(startUrls);

await Actor.exit();
