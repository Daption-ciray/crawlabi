import { chromium } from 'playwright-extra';
import stealth from 'playwright-extra/plugins/stealth/index.js';
import NodeCache from 'node-cache';
import config from '../config.js'; // Import config

// Initialize cache with TTL from config
const cache = new NodeCache({ stdTTL: config.scraper.cacheTTL });

// Add stealth plugin
chromium.use(stealth());

/**
 * ScraperService class provides methods to scrape web pages using Playwright.
 * It includes features like caching, resource blocking, and retry mechanisms.
 */
class ScraperService {
    // BLOCKED_DOMAINS_KEYWORDS are now sourced from config
    static BLOCKED_DOMAINS_KEYWORDS = config.scraper.blockedDomainsKeywords;

    /**
     * Initializes a new ScraperService instance.
     * Sets up default retry, delay, and timeout values from the application configuration.
     */
    constructor() {
        this.browser = null;
        this.context = null;
        // Retry, delay, and timeout values now sourced from config
        this.maxRetries = config.scraper.maxRetries;
        this.retryDelay = config.scraper.retryDelay;
        this.defaultTimeout = config.scraper.defaultTimeout;
    }

    /**
     * Initializes the Playwright browser and context if they haven't been already.
     * Uses launch arguments and context options from the application configuration.
     * @private
     */
    async initialize() {
        if (!this.browser) {
            console.log('ScraperService: Initializing new browser instance...');
            this.browser = await chromium.launch({
                headless: true,
                args: config.scraper.launchArgs // Launch args from config
            });
        }

        if (!this.context) {
            console.log('ScraperService: Initializing new browser context...');
            // Context options from config
            this.context = await this.browser.newContext(config.scraper.contextOptions);

            // Set default timeout
            this.context.setDefaultTimeout(this.defaultTimeout);
        }
    }

    /**
     * Retries a given function a specified number of times with a delay.
     * @param {Function} fn - The asynchronous function to retry.
     * @param {string} operationName - Name of the operation for logging purposes.
     * @param {string} url - URL associated with the operation for logging.
     * @param {number} retries - Number of remaining retries.
     * @returns {Promise<any>} The result of the function if successful.
     * @throws Will throw the last error if all retries fail.
     * @private
     */
    async retry(fn, operationName = 'operation', url = '', retries = this.maxRetries) { // Uses this.maxRetries from constructor
        try {
            return await fn();
        } catch (error) {
            if (retries > 0) {
                const attemptNumber = this.maxRetries - retries + 1; // Uses this.maxRetries
                console.warn(`ScraperService: ${operationName} for ${url} failed on attempt ${attemptNumber}/${this.maxRetries}. Retrying... Error: ${error.message.split('\n')[0]}`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay)); // Uses this.retryDelay
                return this.retry(fn, operationName, url, retries - 1);
            }
            console.error(`ScraperService: ${operationName} for ${url} failed after ${this.maxRetries} attempts. Last error: ${error.message.split('\n')[0]}`); // Uses this.maxRetries
            throw error;
        }
    }

    /**
     * Configures resource blocking for a Playwright page.
     * @param {import('playwright').Page} page - The Playwright page object.
     * @param {object} options - Options for resource blocking.
     * @param {boolean} [options.blockAds=true] - Whether to block ad/tracker domains.
     * @param {boolean} [options.blockTrackers=true] - Whether to block tracker domains (covered by blockAds).
     * @param {boolean} [options.blockMedia=false] - Whether to block images, media, and fonts.
     * @private
     */
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
                // Using BLOCKED_DOMAINS_KEYWORDS from static class property (sourced from config)
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

    /**
     * Extracts data from a Playwright element based on the specified type.
     * @param {import('playwright').ElementHandle} element - The Playwright element.
     * @param {string} type - The type of data to extract ('text', 'html', 'attribute', 'exists', 'count').
     * @param {string} [attributeName] - The name of the attribute to extract if type is 'attribute'.
     * @returns {Promise<string|boolean|number|null>} The extracted data.
     * @private
     */
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

    /**
     * Scrapes a given URL based on an array of selectors.
     * @param {string} url - The URL to scrape.
     * @param {Array<object>} selectors - An array of selector objects. Each object should have:
     *   - `query`: The CSS selector string.
     *   - `name`: A name for this selector's result.
     *   - `type`: Type of data to extract ('text', 'html', 'attribute', 'exists', 'count').
     *   - `multiple` (optional): Boolean, true to select all matching elements.
     *   - `attribute` (optional): String, attribute name if type is 'attribute'.
     * @param {object} [options={}] - Scraping options.
     * @param {number} [options.timeout] - Timeout for page navigation and operations.
     * @param {boolean} [options.waitForNetworkIdle=true] - Whether to wait for network idle state.
     * @param {boolean} [options.useCache=true] - Whether to use cache for results.
     * @param {boolean} [options.blockAds=true] - Whether to block ads.
     * @param {boolean} [options.blockTrackers=true] - Whether to block trackers.
     * @param {boolean} [options.blockMedia=false] - Whether to block media.
     * @returns {Promise<object>} An object containing the scraped data, keyed by selector names.
     */
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
            await this.initialize(); // Ensure browser and context are ready
            const page = await this.context.newPage();
            
            await this._setupResourceBlocking(page, { blockAds, blockTrackers, blockMedia });

            try {
                // Navigate with optimized settings
                await page.goto(url, {
                    waitUntil: 'domcontentloaded', // Faster than 'load' or 'networkidle' for initial load
                    timeout
                });

                if (waitForNetworkIdle) {
                    // Wait for network activity to quiet down after initial load
                    await page.waitForLoadState('networkidle', { timeout });
                }

                const results = {};
                
                for (const selector of selectors) {
                    if (!selector || !selector.query || !selector.name || !selector.type) {
                        console.warn(`ScraperService: Invalid selector object for URL ${url}:`, selector);
                        results[selector.name || `invalid_selector_${Date.now()}`] = null; // Use a unique name for invalid selectors
                        continue;
                    }
                    try {
                        const elements = await page.$$(selector.query); // Get all matching elements
                        
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
                                results[selector.name] = []; // Consistent empty array for 'multiple' if no elements
                            }
                        } else { // Single element expected
                            results[selector.name] = elements[0]
                                ? await this._extractDataFromElement(elements[0], selector.type, selector.attribute)
                                : null; // Null if no element found
                        }
                    } catch (error) {
                        console.error(`ScraperService: Error processing selector "${selector.name}" (${selector.query}) on ${url}: ${error.message.split('\n')[0]}`);
                        results[selector.name] = null; // Ensure result is null on error
                    }
                }

                await page.close();

                if (useCache) {
                    cache.set(cacheKey, results);
                }

                return results;

            } catch (error) {
                // Ensure page is closed even if an error occurs during scraping operations
                if (!page.isClosed()) {
                    await page.close();
                }
                throw error; // Re-throw to be handled by the retry mechanism
            }
        }, 'scrape', url);
    }

    /**
     * Clears the cache. If a URL is provided, only cache entries starting with that URL are cleared.
     * Otherwise, the entire cache is flushed.
     * @param {string} [url=null] - Optional URL to filter cache entries for deletion.
     */
    async clearCache(url = null) {
        if (url) {
            const keys = cache.keys().filter(key => key.startsWith(url));
            cache.del(keys);
            console.log(`ScraperService: Cache cleared for URL pattern: ${url}`);
        } else {
            cache.flushAll();
            console.log('ScraperService: Entire cache flushed.');
        }
    }

    /**
     * Closes the Playwright browser context and the browser instance.
     */
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