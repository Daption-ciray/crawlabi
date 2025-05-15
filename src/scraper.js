import { chromium } from 'playwright';
import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import NodeCache from 'node-cache';

// Initialize cache with 30 minutes TTL
const cache = new NodeCache({ stdTTL: 1800 });

// Add stealth plugin
playwright.chromium.use(stealth());

class ScraperService {
    constructor() {
        this.browser = null;
        this.context = null;
        this.maxRetries = 3;
        this.retryDelay = 2000;
        this.defaultTimeout = 30000;
    }

    async initialize() {
        if (!this.browser) {
            this.browser = await playwright.chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });
        }

        if (!this.context) {
            this.context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1920, height: 1080 },
                ignoreHTTPSErrors: true,
                bypassCSP: true,
                javaScriptEnabled: true,
                hasTouch: false,
                isMobile: false,
                locale: 'tr-TR'
            });

            // Set default timeout
            this.context.setDefaultTimeout(this.defaultTimeout);
        }
    }

    async retry(fn, retries = this.maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.retry(fn, retries - 1);
            }
            throw error;
        }
    }

    async scrape(url, selectors, options = {}) {
        const {
            timeout = this.defaultTimeout,
            waitForNetworkIdle = true,
            useCache = true,
            blockAds = true,
            blockTrackers = true,
            blockMedia = false
        } = options;

        const cacheKey = `${url}-${JSON.stringify(selectors)}`;
        
        if (useCache) {
            const cachedResult = cache.get(cacheKey);
            if (cachedResult) return cachedResult;
        }

        return this.retry(async () => {
            await this.initialize();
            const page = await this.context.newPage();

            // Resource blocking
            if (blockAds || blockTrackers || blockMedia) {
                await page.route('**/*', route => {
                    const request = route.request();
                    const url = request.url();
                    const resourceType = request.resourceType();

                    // Block ads and trackers
                    if (blockAds || blockTrackers) {
                        const blockedDomains = [
                            'ads', 'analytics', 'tracking', 'doubleclick',
                            'google-analytics', 'facebook.com', 'googletagmanager',
                            'adnxs', 'adform', 'adroll', 'adsystem'
                        ];
                        
                        if (blockedDomains.some(domain => url.includes(domain))) {
                            return route.abort();
                        }
                    }

                    // Block media
                    if (blockMedia && ['image', 'media', 'font'].includes(resourceType)) {
                        return route.abort();
                    }

                    return route.continue();
                });
            }

            try {
                // Navigate with optimized settings
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout
                });

                if (waitForNetworkIdle) {
                    await page.waitForLoadState('networkidle', { timeout });
                }

                const results = {};
                
                for (const selector of selectors) {
                    try {
                        const elements = await page.$$(selector.query);
                        
                        if (selector.multiple) {
                            results[selector.name] = await Promise.all(
                                elements.map(async (el) => {
                                    try {
                                        switch (selector.type) {
                                            case 'text':
                                                return (await el.textContent())?.trim() || null;
                                            case 'html':
                                                return await el.innerHTML();
                                            case 'attribute':
                                                return await el.getAttribute(selector.attribute);
                                            case 'count':
                                                return elements.length;
                                            case 'exists':
                                                return true;
                                            default:
                                                return null;
                                        }
                                    } catch {
                                        return null;
                                    }
                                })
                            );
                        } else {
                            const element = elements[0];
                            if (element) {
                                switch (selector.type) {
                                    case 'text':
                                        results[selector.name] = (await element.textContent())?.trim() || null;
                                        break;
                                    case 'html':
                                        results[selector.name] = await element.innerHTML();
                                        break;
                                    case 'attribute':
                                        results[selector.name] = await element.getAttribute(selector.attribute);
                                        break;
                                    case 'count':
                                        results[selector.name] = elements.length;
                                        break;
                                    case 'exists':
                                        results[selector.name] = true;
                                        break;
                                    default:
                                        results[selector.name] = null;
                                }
                            } else {
                                results[selector.name] = selector.type === 'exists' ? false : null;
                            }
                        }
                    } catch {
                        results[selector.name] = null;
                    }
                }

                await page.close();

                if (useCache) {
                    cache.set(cacheKey, results);
                }

                return results;

            } catch (error) {
                await page.close();
                throw error;
            }
        });
    }

    async clearCache(url = null) {
        if (url) {
            const keys = cache.keys().filter(key => key.startsWith(url));
            cache.del(keys);
        } else {
            cache.flushAll();
        }
    }

    async close() {
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export const scraperService = new ScraperService(); 