import express from 'express';
import { scraperService } from '../src/scraper.js';

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
    console.log('Test endpoint hit');
    res.json({ message: 'Scraper route is working!' });
});

// Scrape data from URL
router.post('/scrape', async (req, res) => {
    console.log('Scrape endpoint hit with body:', req.body);
    
    try {
        const { url, selectors, options } = req.body;

        if (!url || !selectors) {
            console.log('Missing parameters:', { url, selectors });
            return res.status(400).json({
                error: 'Missing required parameters: url and selectors are required'
            });
        }

        console.log('Starting scrape with parameters:', {
            url,
            selectorsCount: selectors.length,
            options
        });

        const results = await scraperService.scrape(url, selectors, options);
        console.log('Scrape completed successfully:', results);
        res.json(results);

    } catch (error) {
        console.error('Scraping route error:', {
            error: error.message,
            stack: error.stack,
            body: req.body
        });
        res.status(500).json({
            error: error.message || 'Internal server error',
            details: error.stack
        });
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
        res.status(500).json({
            error: error.message || 'Failed to clear cache'
        });
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