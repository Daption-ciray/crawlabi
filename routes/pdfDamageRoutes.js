import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { convertPdfToImages } from '../services/pdfConverterService.js';
import { analyzeDamages } from '../services/imageAnalyzer.js'; // To call existing analysis logic
import appConfig from '../config.js';

const router = express.Router();

// Configure multer for PDF uploads
const uploadDir = path.join(process.cwd(), 'uploads_pdf'); // Temporary directory for PDFs
// Ensure upload directory exists
fs.mkdir(uploadDir, { recursive: true }).catch(err => {
    console.error('Failed to create PDF upload directory:', err);
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const pdfFileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type, only PDF is accepted!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: pdfFileFilter,
    limits: { fileSize: appConfig.cropper ? appConfig.cropper.maxFileSizeMB * 1024 * 1024 : 25 * 1024 * 1024 } // Default 25MB if cropper config gone
});

// POST /api/pdf/analyze-damage (or a similar path based on how it's mounted in app.js)
router.post('/analyze-pdf-damage', upload.single('pdf'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'PDF file not uploaded.' });
    }

    const pdfPath = req.file.path;
    console.log(`[pdfDamageRoutes] Received PDF: ${req.file.originalname}, saved to ${pdfPath}`);

    try {
        // 1. Convert PDF to image URLs
        console.log(`[pdfDamageRoutes] Converting PDF to images...`);
        const imageUrls = await convertPdfToImages(pdfPath);
        console.log(`[pdfDamageRoutes] PDF converted to ${imageUrls.length} image(s).`);

        if (!imageUrls || imageUrls.length === 0) {
            return res.status(500).json({ error: 'PDF conversion resulted in no images.' });
        }

        // 2. Analyze images for damage (using the existing service function)
        console.log(`[pdfDamageRoutes] Analyzing images for damage...`);
        const analysisResult = await analyzeDamages(imageUrls); // analyzeDamages expects an array of URLs

        // 3. Respond to client
        res.json({
            message: 'PDF processed and damage analysis initiated.',
            conversion: {
                sourcePdf: req.file.originalname,
                imageCount: imageUrls.length,
                imageUrls: imageUrls // Optionally return image URLs
            },
            analysis: {
                damage_analyses: analysisResult.results,
                errors: analysisResult.errors,
                summary: analysisResult.summary
            }
        });

    } catch (error) {
        console.error(`[pdfDamageRoutes] Error processing PDF ${req.file.originalname}:`, error);
        // Ensure a proper error response is sent
        // The error might come from convertPdfToImages or analyzeDamages
        // 'next' will pass it to the global error handler in app.js
        next(error);
    } finally {
        // 4. Clean up the uploaded PDF file
        if (pdfPath) {
            try {
                await fs.unlink(pdfPath);
                console.log(`[pdfDamageRoutes] Deleted temporary PDF: ${pdfPath}`);
            } catch (unlinkError) {
                console.error(`[pdfDamageRoutes] Failed to delete temporary PDF ${pdfPath}:`, unlinkError);
            }
        }
    }
});

export default router;
