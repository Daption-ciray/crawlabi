import express from 'express';
import cors from 'cors';
// import compression from 'compression'; // Removed as it's not used
import dotenv from 'dotenv';
import fs from 'fs'; // fs modülünü import et
import { promises as fsp } from 'fs'; // Promise tabanlı fs fonksiyonları için
import path from 'path'; // path modülünü import et

dotenv.config();

import config from './config.js'; // Import config
import { morganMiddleware, errorLogger, consoleLogger } from './middleware/logger.js';
import imageRoutes from './routes/imageRoutes.js';
import scraperRoutes from './routes/scraper.js';
import analysisRoutes from './routes/analysisRoutes.js';
import pdfDamageRoutes from './routes/pdfDamageRoutes.js';

const UPLOAD_DIR_PDF = path.join(process.cwd(), 'uploads_pdf');

async function clearDirectory(directory) {
    try {
        if (fs.existsSync(directory)) {
            const files = await fsp.readdir(directory);
            for (const file of files) {
                await fsp.unlink(path.join(directory, file));
            }
            console.log(`[INFO] Cleared temporary directory: ${directory}`);
        } else {
            // Klasör yoksa oluşturabiliriz (opsiyonel, route'da zaten var ama başlangıçta da olması iyi olabilir)
            await fsp.mkdir(directory, { recursive: true });
            console.log(`[INFO] Created temporary directory: ${directory}`);
        }
    } catch (err) {
        console.error(`[ERROR] Failed to clear/create temporary directory ${directory}:`, err);
    }
}

const app = express();

// Uygulama başlamadan önce uploads_pdf klasörünü temizle/oluştur
clearDirectory(UPLOAD_DIR_PDF).then(() => {
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
    app.use('/api/pdf', pdfDamageRoutes);

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
        console.log(`POST http://localhost:${PORT}/api/pdf/analyze-pdf-damage`);
        console.log('\n📂 Logs:');
        console.log(`- Access logs: ./logs/access.log`);
        console.log(`- Error logs: ./logs/error.log`);
    });
}).catch(err => {
    console.error("[FATAL] Could not initialize app due to directory clearing/creation error:", err);
    process.exit(1);
}); 