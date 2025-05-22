
import multer from 'multer';
import path from 'path';
import express from 'express';
import fs from 'fs'; // fs.readFileSync is used by analyzeImageWithOpenAI which will be removed
// import axios from 'axios'; // No longer needed as OpenAI call is in service
import sharp from 'sharp';
import appConfig from '../config.js';
// Import the new service function
import { analyzeImageFromFile } from '../services/imageAnalyzer.js';

const router = express.Router();

const uploadDir = path.join(process.cwd(), appConfig.cropper.uploadDir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const croppedDir = path.join(process.cwd(), appConfig.cropper.croppedDir);
if (!fs.existsSync(croppedDir)) fs.mkdirSync(croppedDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const imageFileFilter = (req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
        cb(null, true);
    } else {
        cb(new Error('Geçersiz dosya tipi, sadece JPEG veya PNG kabul edilir!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: appConfig.cropper.maxFileSizeMB * 1024 * 1024 }
});

// The analyzeImageWithOpenAI function is now removed from here and its logic is in imageAnalyzer.js

// POST /api/crop-analyze
router.post('/crop-analyze', upload.single('image'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Resim yüklenmedi.' });
    }
    const imagePath = req.file.path; // Path to the originally uploaded image
    const cropAreas = appConfig.cropper.cropAreas;
    
    try {
        const results = [];
        for (let i = 0; i < cropAreas.length; i++) {
            const area = cropAreas[i];
            let { x, y, width, height } = area.box;
            const sharpImage = sharp(imagePath); // Use the original uploaded image path for sharp
            const metadata = await sharpImage.metadata();
            const imgWidth = metadata.width;
            const imgHeight = metadata.height;

            x = Math.max(0, x);
            y = Math.max(0, y);
            width = Math.min(width, imgWidth - x);
            height = Math.min(height, imgHeight - y);

            if (width <= 0 || height <= 0) {
                console.log(`[INFO] Skipping crop area "${area.label}" due to zero width/height.`);
                continue;
            }
            
            const cropFile = path.join(croppedDir, `${Date.now()}_${i}_${area.label.replace(/\s/g, '_')}.jpg`);
            await sharpImage.extract({ left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) }).toFile(cropFile);
            
            let detailPrompt;
            if (area.label === 'sürücü görüşleri') {
                detailPrompt = appConfig.cropper.prompts.driverStatements;
            } else if (area.label === 'çarpışma yerinin ve anının taslağını çiziniz') {
                detailPrompt = appConfig.cropper.prompts.accidentSketch;
            } else {
                detailPrompt = appConfig.cropper.prompts.defaultAreaAnalysis;
            }
            
            let detailResult = null;
            try {
                // Use the new service function, calling it with the path of the *cropped file*
                detailResult = await analyzeImageFromFile(cropFile, detailPrompt);
                // Note: analyzeImageFromFile returns raw content. If JSON is expected, parse it here.
                // For current prompts, raw text is likely fine.
            } catch (e) {
                console.error(`[ERROR] OpenAI analysis failed for cropped area '${area.label}' (file: ${cropFile}):`, e.message, e.stack);
                // It's important that `e` is an Error object, which it should be if thrown correctly from service
                detailResult = { error: `Detaylı analiz başarısız: ${e.message}` };
            }
            
            results.push({
                label: area.label,
                box: area.box,
                cropFile: path.basename(cropFile),
                detail: detailResult
            });
        }
        res.json({
            message: 'Analiz tamamlandı',
            detectedAreas: results
        });
    } catch (err) {
        next(err);
    }
});

export default router; 