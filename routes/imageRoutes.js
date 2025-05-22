import express from 'express';
import { analyzeImages, analyzeDamages } from '../services/imageAnalyzer.js';
import { validateUrls } from '../middleware/validator.js';

const router = express.Router();

router.post('/analyze', validateUrls, async (req, res) => {
    try {
        const { urls } = req.body;

        console.log('Received request to analyze images:', {
            count: urls.length,
            urls: urls
        });

        const result = await analyzeImages(urls);

        // If all images failed, return an error
        if (result.results.length === 0 && result.errors.length > 0) {
            return res.status(500).json({
                error: 'Analysis failed',
                message: 'Failed to analyze any of the provided images',
                details: result.errors
            });
        }

        // Return success response with both successful and failed analyses
        return res.json({
            success: true,
            data: {
                analyses: result.results,
                errors: result.errors,
                summary: result.summary
            }
        });

    } catch (error) {
        console.error('Error in /analyze endpoint:', error);
        // Add statusCode if not present, or for specific error types
        if (!error.statusCode) {
            error.statusCode = 500; 
        }
        next(error); // Pass to global error handler
    }
});

router.post('/damage-analyze', validateUrls, async (req, res) => {
    try {
        const { urls } = req.body;

        console.log('Received request to analyze damage:', {
            count: urls.length,
            urls: urls
        });

        const result = await analyzeDamages(urls);

        // If all images failed, return an error
        if (result.results.length === 0 && result.errors.length > 0) {
            return res.status(500).json({
                error: 'Damage analysis failed',
                message: 'Failed to analyze damage for any of the provided images',
                details: result.errors
            });
        }

        // Return success response with both successful and failed analyses
        return res.json({
            success: true,
            data: {
                damage_analyses: result.results,
                errors: result.errors,
                summary: result.summary
            }
        });

    } catch (error) {
        console.error('Error in /damage-analyze endpoint:', error);
        // Add statusCode if not present, or for specific error types
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error); // Pass to global error handler
    }
});

export default router; 