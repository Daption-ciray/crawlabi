import express from 'express';
import { analyzeImages } from '../services/analysisService.js';

const router = express.Router();

router.post('/compare_images', async (req, res) => {
  try {
    const { airtableApiKey, baseId } = req.body;
    const result = await analyzeImages(airtableApiKey, baseId);
    
    // Silinen kayıt sayılarını log'dan çıkar
    const clearedCounts = {
      part_analysis: parseInt(result.logs?.find(log => log.includes('parca analiz'))?.match(/\d+/)?.[0] || '0'),
      accident_analysis: parseInt(result.logs?.find(log => log.includes('Kaza Analiz Tablosu'))?.match(/\d+/)?.[0] || '0')
    };

    res.json({
      ...result,
      cleared_records: clearedCounts
    });
  } catch (error) {
    console.error('Analysis route error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      status: 500,
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 