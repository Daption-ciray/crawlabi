import express from 'express';
import { analyzeImages } from '../services/analysisService.js';

const router = express.Router();

router.post('/compare_images', async (req, res) => {
  try {
    const { airtableApiKey, baseId } = req.body;
    const result = await analyzeImages(airtableApiKey, baseId);
    
    // Attempt to parse cleared record counts from log messages within the result.
    // This is a temporary solution and ideally, structured data should be returned.
    const clearedCounts = {
      part_analysis: parseInt(result.logs?.find(log => log.includes('parca analiz'))?.match(/\d+/)?.[0] || '0'),
      accident_analysis: parseInt(result.logs?.find(log => log.includes('Kaza Analiz Tablosu'))?.match(/\d+/)?.[0] || '0')
    };

    res.json({
      ...result,
      cleared_records: clearedCounts
    });
  } catch (error) {
    console.error('Error in /compare_images route:', error); // Log specific route context
    // Optionally add a statusCode to the error if it's a specific known type
    // e.g., if (error instanceof SpecificServiceError) error.statusCode = 4xx;
    next(error); // Pass to global error handler
  }
});

export default router; 