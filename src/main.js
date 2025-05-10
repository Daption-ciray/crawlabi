import { chromium } from 'playwright';
import express from 'express';
import { z } from 'zod';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { performance } from 'perf_hooks';
import compression from 'compression';
import NodeCache from 'node-cache';

// Önbellek oluştur (30 dakika TTL)
const resultsCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

// Express uygulamasını oluştur
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(helmet());
app.use(cors());
app.use(compression());

// API kullanım limiti ekle
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Validasyon şeması - tek URL için optimize edildi
const selectorSchema = z.object({
  name: z.string().min(1, "İsim alanı zorunludur"),
  query: z.string().min(1, "Sorgu alanı zorunludur"),
  type: z.enum(['text', 'html', 'attribute', 'count', 'exists', 'innerText']).default('text'),
  multiple: z.boolean().default(false),
  attribute: z.string().optional(),
  transform: z.function().optional(),
});

const requestSchema = z.object({
  url: z.string().url("Geçerli bir URL gereklidir"),
  selectors: z.array(selectorSchema).optional().default([]),
  options: z.object({
    timeout: z.number().int().positive().default(30000),
    waitForNetworkIdle: z.boolean().default(true),
    userAgent: z.string().optional(),
    useCache: z.boolean().default(true),
    blockAds: z.boolean().default(true),
    blockTrackers: z.boolean().default(true),
    blockMedia: z.boolean().default(false),
  }).optional().default({}),
});

// Selektörleri işleme fonksiyonu
const processSelectors = async (page, selectors) => {
  const data = {};
  
  for (const selector of selectors) {
    try {
      const { name, query, type, multiple, attribute } = selector;
      
      // Seçici kontrolü
      let elementExists;
      try {
        elementExists = await page.$(query) !== null;
      } catch (error) {
        console.log(`Invalid selector: ${query} - ${error.message}`);
        data[name] = multiple ? [] : null;
        continue;
      }
      
      if (!elementExists) {
        data[name] = multiple ? [] : null;
        continue;
      }
      
      const elements = page.locator(query);
      const count = await elements.count();
      
      if (type === 'exists') {
        data[name] = elementExists;
        continue;
      }
      
      if (type === 'count') {
        data[name] = count;
        continue;
      }
      
      if (count === 0) {
        data[name] = multiple ? [] : null;
        continue;
      }
      
      // Veri çıkarma - parallel işlem kullanarak hızlandırıldı
      switch (type) {
        case 'text':
          data[name] = multiple 
            ? await elements.allTextContents()
            : await elements.first().textContent();
          break;
        case 'innerText':
          data[name] = multiple
            ? await elements.evaluateAll(els => els.map(el => el.innerText))
            : await elements.first().innerText();
          break;
        case 'html':
          data[name] = multiple 
            ? await elements.evaluateAll(els => els.map(el => el.innerHTML))
            : await elements.first().innerHTML();
          break;
        case 'attribute':
          if (attribute) {
            data[name] = multiple 
              ? await elements.evaluateAll((els, attr) => els.map(el => el.getAttribute(attr)), attribute)
              : await elements.first().getAttribute(attribute);
          }
          break;
      }
      
      // Dönüşüm
      if (selector.transform && typeof selector.transform === 'function') {
        try {
          data[name] = selector.transform(data[name]);
        } catch (error) {
          console.log(`Transform error for ${selector.name}: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`Error processing selector ${selector.name}: ${error.message}`);
      data[selector.name] = selector.multiple ? [] : null;
    }
  }
  
  return data;
};

// Önbellek anahtar oluşturma
const createCacheKey = (url, selectors) => {
  const selectorHash = JSON.stringify(selectors.map(s => ({
    name: s.name,
    query: s.query,
    type: s.type,
    multiple: s.multiple,
    attribute: s.attribute
  })));
  
  return `${url}:${selectorHash}`;
};

// Kaynak engelleme kuralları
const createBlockRules = (options) => {
  const rules = [];
  
  if (options.blockAds) {
    rules.push({
      urlPattern: /.*(?:googleadservices|doubleclick|adservice|adsystem|adnxs|advertising)\.com.*/,
      resourceType: ['script', 'xhr', 'fetch', 'image']
    });
  }
  
  if (options.blockTrackers) {
    rules.push({
      urlPattern: /.*(?:google-analytics|googletagmanager|facebook|twitter|linkedin)\.com\/(?!login).*/,
      resourceType: ['script', 'xhr', 'fetch']
    });
  }
  
  if (options.blockMedia) {
    rules.push({
      urlPattern: /.*\.(?:mp4|webm|ogg|mp3|avi|mov|flv)(?:\?.*)?$/,
      resourceType: ['media']
    });
  }
  
  return rules;
};

// Tarayıcı argümanlarını oluştur
const createBrowserArgs = () => [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--js-flags=--max-old-space-size=1024',
  '--disable-notifications',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-background-networking',
  '--disable-breakpad',
  '--disable-backing-store-limit',
  '--disable-hang-monitor',
  '--disable-client-side-phishing-detection',
  '--disable-prompt-on-repost',
  '--disable-domain-reliability',
  '--disable-sync',
];

// Tek URL için scrape işlemi
const scrapeSingleUrl = async (url, selectors = [], options = {}) => {
  const startTime = performance.now();
  
  // Önbellek kontrolü
  if (options.useCache) {
    const cacheKey = createCacheKey(url, selectors);
    const cachedResult = resultsCache.get(cacheKey);
    
    if (cachedResult) {
      return {
        ...cachedResult,
        meta: {
          ...cachedResult.meta,
          fromCache: true,
          executionTime: 0.01
        }
      };
    }
  }
  
  let browser = null;
  let page = null;
  
  try {
    // Tarayıcı başlat
    browser = await chromium.launch({
      headless: true,
      args: createBrowserArgs()
    });
    
    // Yeni bir sayfa aç
    const context = await browser.newContext({
      userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1
    });
    
    page = await context.newPage();
    
    // Kaynak engelleme
    const blockRules = createBlockRules(options);
    if (blockRules.length > 0) {
      await page.route('**/*', (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        const requestUrl = request.url();
        
        for (const rule of blockRules) {
          if (rule.resourceType.includes(resourceType) && rule.urlPattern.test(requestUrl)) {
            return route.abort();
          }
        }
        
        return route.continue();
      });
    }
    
    // Sayfaya git
    await page.goto(url, { 
      timeout: options.timeout || 30000,
      waitUntil: 'domcontentloaded',
      referer: 'https://www.google.com/',
    });
    
    if (options.waitForNetworkIdle) {
      await page.waitForLoadState('networkidle', { 
        timeout: Math.min(options.timeout || 30000, 10000)
      }).catch(() => {
        console.log('Network idle timeout exceeded, continuing anyway');
      });
    }

    // Veri çıkarma
    const pageTitle = await page.title().catch(() => '');
    const extractedData = await processSelectors(page, selectors);
    
    const result = {
      url,
      title: pageTitle,
      timestamp: new Date().toISOString(),
      data: extractedData,
      meta: {
        executionTime: ((performance.now() - startTime) / 1000).toFixed(2),
        timestamp: new Date().toISOString(),
        fromCache: false
      }
    };
    
    // Önbelleğe alma
    if (options.useCache) {
      const cacheKey = createCacheKey(url, selectors);
      resultsCache.set(cacheKey, result);
    }
    
    return result;
  } catch (error) {
    console.error(`Error scraping ${url}: ${error.message}`);
    
    // Hata bilgisini dön
    return {
      url,
      error: error.message,
      timestamp: new Date().toISOString(),
      meta: {
        executionTime: ((performance.now() - startTime) / 1000).toFixed(2),
        timestamp: new Date().toISOString(),
        success: false
      }
    };
  } finally {
    // Kaynakları temizle
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
};

// Requestleri doğrulama middleware
const validateRequest = (req, res, next) => {
  try {
    const validatedData = requestSchema.parse(req.body);
    req.validatedData = validatedData;
    next();
  } catch (error) {
    res.status(400).json({
      status: 'error',
      message: 'Validation error',
      details: error.errors
    });
  }
};

// API endpoint'i - tek URL için
app.post('/api/scrape', validateRequest, async (req, res) => {
  const startTime = performance.now();
  
  try {
    const { url, selectors, options } = req.validatedData;
    
    const result = await scrapeSingleUrl(url, selectors, options);

    res.json({
      status: 'success',
      ...result,
      meta: {
        ...result.meta,
        apiResponseTime: ((performance.now() - startTime) / 1000).toFixed(2)
      }
    });
  } catch (error) {
    console.error('Error in /api/scrape endpoint:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    });
  }
});

// Önbellek temizleme
app.delete('/api/cache', (req, res) => {
  const keysDeleted = resultsCache.flushAll();
  res.json({
    status: 'success',
    message: 'Cache cleared',
    keysDeleted
  });
});

// URL bazlı önbellek temizleme
app.delete('/api/cache/:url', (req, res) => {
  const url = decodeURIComponent(req.params.url);
  const keys = resultsCache.keys().filter(key => key.startsWith(url));
  
  let keysDeleted = 0;
  for (const key of keys) {
    if (resultsCache.del(key)) keysDeleted++;
  }
  
  res.json({
    status: 'success',
    message: `Cache cleared for URL: ${url}`,
    keysDeleted
  });
});

// Durum endpoint'i
app.get('/api/status', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
    },
    cache: {
      keys: resultsCache.keys().length,
      stats: resultsCache.getStats()
    },
    pid: process.pid
  });
});

// Crawl endpointini de desteklemeye devam et (geriye dönük uyumluluk)
app.post('/api/crawl', validateRequest, async (req, res) => {
  const startTime = performance.now();
  
  try {
    const { url, selectors, options } = req.validatedData;
    
    const result = await scrapeSingleUrl(url, selectors, options);

    res.json({
      status: 'success',
      results: [result],
      meta: {
        urlsProcessed: 1,
        executionTime: result.meta.executionTime,
        apiResponseTime: ((performance.now() - startTime) / 1000).toFixed(2),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in /api/crawl endpoint:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    });
  }
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Web Scraping API sunucusu port ${PORT} üzerinde çalışıyor`);
});

// Hata yönetimi
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Düzgün kapanma
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});