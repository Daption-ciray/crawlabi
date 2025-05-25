import express from 'express';
import { scraperService } from '../src/scraper.js';

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
    console.log('Test endpoint hit');
    res.json({ message: 'Scraper route is working!' });
});

// Yardımcı fonksiyon: Obje içindeki tüm dizileri düzleştir ve birleştir
function flattenAllArrays(obj) {
    let allItems = [];
    
    if (Array.isArray(obj)) {
        allItems.push(...obj);
    } else if (obj && typeof obj === 'object') {
        for (const value of Object.values(obj)) {
            if (Array.isArray(value)) {
                allItems.push(...value);
            } else if (value && typeof value === 'object') {
                allItems.push(...flattenAllArrays(value));
            } else if (value != null) {
                allItems.push(value);
            }
        }
    } else if (obj != null) {
        allItems.push(obj);
    }
    
    return allItems;
}

// Scrape data from URL
router.post('/scrape', async (req, res, next) => {
    try {
        let { url, selectors, options, domain, title } = req.body;

        // 1. url bir dizi mi, yoksa virgüllü string mi?
        let urlList = [];
        if (Array.isArray(url)) {
            urlList = url;
        } else if (typeof url === 'string') {
            urlList = url.split(',').map(u => u.trim()).filter(Boolean);
        }

        // 2. Her url'yi tam url'ye çevir (opsiyonel domain ile)
        urlList = urlList.map(u => {
            if (u.startsWith('http')) return u;
            if (domain) return domain.replace(/\/$/, '') + u;
            return u;
        });

        if (!urlList.length || !selectors) {
            return res.status(400).json({
                error: 'Missing required parameters: url(s) and selectors are required'
            });
        }

        // 3. Her bir url için scrape işlemi fonksiyonu
        const scrapeOne = async (singleUrl) => {
            try {
                return await scraperService.scrape(singleUrl, selectors, options);
            } catch (err) {
                return null;
            }
        };

        // 4. Tüm url'leri aynı anda asenkron işle
        const rawResults = await Promise.all(urlList.map(scrapeOne));

        // 5. Tüm sonuçları tamamen düzleştir
        let allItems = [];
        for (const result of rawResults) {
            if (result != null) {
                allItems.push(...flattenAllArrays(result));
            }
        }

        // 6. Null ve duplicate temizliği
        const seen = new Set();
        const cleanedResults = allItems.filter(item => {
            if (item == null) return false;
            const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // 7. Response field adını title parametresine göre belirle
        const responseFieldName = title || 'results';
        const response = {
            count: cleanedResults.length
        };
        response[responseFieldName] = cleanedResults;

        res.json(response);

    } catch (error) {
        console.error('Scraping route error:', { // Log contextual details
            message: error.message,
            stack: error.stack, // Keep stack for server-side logging
            url: req.body.url, // Log relevant request parameters
            options: req.body.options
        });
        // Add statusCode if not present, or for specific error types
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error); // Pass to global error handler
    }
});

// Clear cache
router.delete('/cache', async (req, res) => {
    console.log('Clear cache endpoint hit');
    try {
        const { url } = req.query;
        await scraperService.clearCache(url);
        console.log('Cache cleared successfully');
        res.json({ message: 'Cache cleared successfully' });
    } catch (error) {
        console.error('Cache clear error:', error);
         // Add statusCode if not present, or for specific error types
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error); // Pass to global error handler
    }
});

// Get API status
router.get('/status', (req, res) => {
    console.log('Status endpoint hit');
    res.json({
        status: 'operational',
        version: '1.0.0',
        features: {
            scraping: true,
            caching: true,
            resourceBlocking: true
        }
    });
});

export default router; 