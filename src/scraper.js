import { chromium } from 'playwright';
import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import NodeCache from 'node-cache';

// Initialize cache with 30 minutes TTL
const cache = new NodeCache({ stdTTL: 1800 });

// Add stealth plugin
playwright.chromium.use(stealth());

class ScraperService {
    static BLOCKED_DOMAINS_KEYWORDS = [
        'adservice', 'analytics', 'beacon', 'doubleclick', 'googletagmanager',
        'google-analytics', 'facebook.com/tr/', 'pixel', 'track', 'scorecardresearch',
        'adnxs', 'adform', 'adroll', 'adsystem', 'rubiconproject', 'openx', 'criteo',
        // Common ad/tracker keywords - expand as needed
        '.ads.', '/ads/', ' реклама ', // Cyrillic 'reklama' for ads
        'googleadservices', 'appsflyer', 'criteo', 'outbrain', 'taboola', 'yieldify'
    ];

    constructor() {
        this.browser = null;
        this.context = null;
        this.maxRetries = 3;
        this.retryDelay = 2000;
        this.defaultTimeout = 30000;
    }

    async initialize() {
        if (!this.browser) {
            console.log('ScraperService: Initializing new browser instance...');
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
            console.log('ScraperService: Initializing new browser context...');
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

    async retry(fn, operationName = 'operation', url = '', retries = this.maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (retries > 0) {
                const attemptNumber = this.maxRetries - retries + 1;
                console.warn(`ScraperService: ${operationName} for ${url} failed on attempt ${attemptNumber}/${this.maxRetries}. Retrying... Error: ${error.message.split('\n')[0]}`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.retry(fn, operationName, url, retries - 1);
            }
            console.error(`ScraperService: ${operationName} for ${url} failed after ${this.maxRetries} attempts. Last error: ${error.message.split('\n')[0]}`);
            throw error;
        }
    }

    async _setupResourceBlocking(page, options) {
        const { blockAds = true, blockTrackers = true, blockMedia = false } = options;
        if (!blockAds && !blockTrackers && !blockMedia) {
            return;
        }

        await page.route('**/*', route => {
            const request = route.request();
            const reqUrl = request.url().toLowerCase();
            const resourceType = request.resourceType();

            if (blockAds || blockTrackers) {
                if (ScraperService.BLOCKED_DOMAINS_KEYWORDS.some(keyword => reqUrl.includes(keyword))) {
                    // console.log(`ScraperService: Blocking ad/tracker: ${reqUrl}`);
                    return route.abort('aborted');
                }
            }

            if (blockMedia && ['image', 'media', 'font'].includes(resourceType)) {
                // console.log(`ScraperService: Blocking media: ${reqUrl} (type: ${resourceType})`);
                return route.abort('aborted');
            }

            return route.continue();
        });
    }

    async _extractDataFromElement(element, type, attributeName) {
        if (!element) return null;
        try {
            switch (type) {
                case 'text':
                    return (await element.textContent())?.trim() || null;
                case 'html':
                    return await element.innerHTML();
                case 'attribute':
                    return attributeName ? await element.getAttribute(attributeName) : null;
                default:
                    console.warn(`ScraperService: Unknown selector type for data extraction: ${type}`);
                    return null;
            }
        } catch (ex) {
            console.warn(`ScraperService: Error extracting data type '${type}' from element: ${ex.message.split('\n')[0]}`);
            return null;
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
            if (cachedResult) {
                console.log(`ScraperService: Cache hit for ${url}`);
                return cachedResult;
            }
        }

        return this.retry(async () => {
            await this.initialize();
            const page = await this.context.newPage();
            
            await this._setupResourceBlocking(page, { blockAds, blockTrackers, blockMedia });

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
                    if (!selector || !selector.query || !selector.name || !selector.type) {
                        console.warn(`ScraperService: Invalid selector object for URL ${url}:`, selector);
                        results[selector.name || `invalid_selector_${Date.now()}`] = null;
                        continue;
                    }
                    try {
                        const elements = await page.$$(selector.query);
                        
                        if (selector.type === 'exists') {
                            results[selector.name] = elements.length > 0;
                        } else if (selector.type === 'count') {
                            results[selector.name] = elements.length;
                        } else if (selector.multiple) {
                            if (elements.length > 0) {
                                results[selector.name] = await Promise.all(
                                    elements.map(el => this._extractDataFromElement(el, selector.type, selector.attribute))
                                );
                            } else {
                                results[selector.name] = []; // Return empty array if no elements found for multiple
                            }
                        } else { // Single element
                            results[selector.name] = elements[0]
                                ? await this._extractDataFromElement(elements[0], selector.type, selector.attribute)
                                : null;
                        }
                    } catch (error) {
                        console.error(`ScraperService: Error processing selector "${selector.name}" (${selector.query}) on ${url}: ${error.message.split('\n')[0]}`);
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
        }, 'scrape', url);
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
        console.log('ScraperService: Closing browser context and browser...');
        if (this.context) {
            try {
                await this.context.close();
            } catch (e) {
                console.error('ScraperService: Error closing context:', e.message);
            }
            this.context = null;
        }
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {
                console.error('ScraperService: Error closing browser:', e.message);
            }
            this.browser = null;
        }
        console.log('ScraperService: Browser and context closed.');
    }
}

export const scraperService = new ScraperService(); 