import express from 'express';
import cors from 'cors';
// import compression from 'compression'; // Removed as it's not used
import dotenv from 'dotenv';
dotenv.config();

import config from './config.js'; // Import config
import { morganMiddleware, errorLogger, consoleLogger } from './middleware/logger.js';
import imageRoutes from './routes/imageRoutes.js';
import scraperRoutes from './routes/scraper.js';
import analysisRoutes from './routes/analysisRoutes.js';
import cropperRoutes from './routes/cropperRoutes.js';

const app = express();

// Development middleware
app.use(express.json({ limit: '50mb' })); // Increased limit for local development
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS Configuration
// const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []; // Replaced by config
const corsOptions = {
    origin: (origin, callback) => {
        if (config.env !== 'production' || !origin || config.server.allowedOrigins.indexOf(origin) !== -1) { // Use config
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};
app.use(cors(corsOptions));

// Logging middleware
app.use(morganMiddleware);
app.use(consoleLogger);

// Routes
app.use('/api', imageRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/cropper', cropperRoutes);

// Error handling middleware
app.use(errorLogger);
app.use((err, req, res, next) => {
    console.error('Error details:', {
        message: err.message,
        stack: err.stack, // Show full stack trace in development
        path: req.path,
        method: req.method
    });

    res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
        status: err.statusCode || 500,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = config.server.port; // Use config
app.listen(PORT, () => {
    console.log(`🚀 Development server running at http://localhost:${PORT}`);
    console.log('\n📝 Available endpoints:');
    console.log(`POST http://localhost:${PORT}/api/analyze`);
    console.log(`POST http://localhost:${PORT}/api/damage-analyze`);
    console.log(`POST http://localhost:${PORT}/api/scraper/scrape`);
    console.log(`DELETE http://localhost:${PORT}/api/scraper/cache`);
    console.log(`GET http://localhost:${PORT}/api/scraper/status`);
    console.log(`POST http://localhost:${PORT}/api/analysis/compare_images`);
    console.log(`POST http://localhost:${PORT}/api/cropper/crop-analyze`);
    console.log('\n📂 Logs:');
    console.log(`- Access logs: ./logs/access.log`);
    console.log(`- Error logs: ./logs/error.log`);
}); 