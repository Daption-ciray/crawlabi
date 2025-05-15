import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { morganMiddleware, errorLogger, consoleLogger } from './middleware/logger.js';
import imageRoutes from './routes/imageRoutes.js';
import scraperRoutes from './routes/scraper.js';

const app = express();

// Development middleware
app.use(cors()); // Allow all origins in development
app.use(compression()); // Compress responses
app.use(express.json({ limit: '50mb' })); // Increased limit for local development
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use(morganMiddleware);
app.use(consoleLogger);

// Routes
app.use('/api', imageRoutes);
app.use('/api/scraper', scraperRoutes);

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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Development server running at http://localhost:${PORT}`);
    console.log('\n📝 Available endpoints:');
    console.log(`POST http://localhost:${PORT}/api/analyze`);
    console.log(`POST http://localhost:${PORT}/api/damage-analyze`);
    console.log(`POST http://localhost:${PORT}/api/scraper/scrape`);
    console.log(`DELETE http://localhost:${PORT}/api/scraper/cache`);
    console.log(`GET http://localhost:${PORT}/api/scraper/status`);
    console.log('\n📂 Logs:');
    console.log(`- Access logs: ./logs/access.log`);
    console.log(`- Error logs: ./logs/error.log`);
}); 