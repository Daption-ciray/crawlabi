import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { convertPdfToImages } from '../services/pdfConverterService.js';
import { analyzeDamages } from '../services/imageAnalyzer.js'; // To call existing analysis logic
import appConfig from '../config.js';
import archiver from 'archiver';
import axios from 'axios';
import os from 'os';


const router = express.Router();

// Configure multer for PDF uploads
const uploadDir = path.join(process.cwd(), 'uploads_pdf'); // Temporary directory for PDFs
// Ensure upload directory exists
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[INFO] PDF upload directory created: ${uploadDir}`);
    } else {
        console.log(`[INFO] PDF upload directory already exists: ${uploadDir}`);
    }
} catch (err) {
    console.error('Failed to create PDF upload directory:', err);
    // Bu kritik bir hata ise, uygulamayı burada durdurabilirsin.
    process.exit(1);
}

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

// Yardımcı fonksiyon: URL'den dosya indirip geçici bir klasöre kaydet (CloudConvert için, Poppler için gerekmeyebilir)
// Bu fonksiyon artık pdfConverterService içinde kalabilir veya buraya taşınabilir eğer sadece burada kullanılacaksa.
// Şimdilik pdfConverterService içinde olduğunu varsayıyorum ve Poppler için bu kullanılmayacak.

// POST /api/pdf/analyze-pdf-damage
router.post('/analyze-pdf-damage', upload.single('pdf'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'PDF file not uploaded.' });
    }

    const pdfPath = req.file.path;
    const jobType = req.headers['jobtype'] || 'kaza_analiz';
    console.log(`[pdfDamageRoutes] Received PDF: ${req.file.originalname}, saved to ${pdfPath}, jobType: ${jobType}`);

    let tempImagePaths = []; // Poppler tarafından oluşturulan dosyaların yollarını tutacak
    let tempImageDir = ''; // Poppler tarafından oluşturulan dosyaların klasörünü tutacak

    try {
        const conversionResult = await convertPdfToImages(pdfPath, jobType);

        if (jobType === 'converter') {
            // conversionResult burada lokal dosya yolları array'i olmalı (Poppler'dan gelen)
            tempImagePaths = conversionResult; // Silmek için yolları sakla
            if (tempImagePaths.length > 0) {
                tempImageDir = path.dirname(tempImagePaths[0]); // Geçici klasörün yolu
            }

            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', 'attachment; filename=converted_images.zip');
            const archive = archiver('zip');
            archive.pipe(res);
            for (const filePath of tempImagePaths) {
                archive.file(filePath, { name: path.basename(filePath) });
            }
            archive.finalize();
            // Zip gönderimi bittiğinde geçici dosyaları ve klasörü silmek için stream'in bitmesini bekle
            res.on('finish', () => {
                console.log('[pdfDamageRoutes] Zip stream finished. Cleaning up Poppler temp files...');
                for (const filePath of tempImagePaths) {
                    fsp.unlink(filePath).catch(err => console.error(`Failed to delete temp Poppler file ${filePath}:`, err));
                }
                if (tempImageDir) {
                    fsp.rm(tempImageDir, { recursive: true, force: true }).catch(err => console.error(`Failed to delete temp Poppler directory ${tempImageDir}:`, err));
                }
            });
            return; // Analiz yapmadan çık
        } else {
            // jobType !== 'converter' (CloudConvert veya diğerleri)
            // conversionResult burada image URL'leri array'i olmalı
            if (!conversionResult || conversionResult.length === 0) {
                return res.status(500).json({ error: 'PDF conversion resulted in no images.' });
            }
            console.log(`[pdfDamageRoutes] Analyzing images for damage (CloudConvert)...`);
            const analysisResult = await analyzeDamages(conversionResult);
            res.json({
                message: 'PDF processed and damage analysis initiated.',
                conversion: {
                    sourcePdf: req.file.originalname,
                    imageCount: conversionResult.length,
                    imageUrls: conversionResult
                },
                analysis: {
                    damage_analyses: analysisResult.results,
                    errors: analysisResult.errors,
                    summary: analysisResult.summary
                }
            });
        }
    } catch (error) {
        console.error(`[pdfDamageRoutes] Error processing PDF ${req.file.originalname}:`, error);
        // Hata durumunda da Poppler dosyalarını silmeye çalış
        if (jobType === 'converter') {
            for (const filePath of tempImagePaths) {
                fsp.unlink(filePath).catch(err => console.error(`Cleanup error: Failed to delete temp Poppler file ${filePath}:`, err));
            }
            if (tempImageDir) {
                fsp.rm(tempImageDir, { recursive: true, force: true }).catch(err => console.error(`Cleanup error: Failed to delete temp Poppler directory ${tempImageDir}:`, err));
            }
        }
        next(error);
    } finally {
        // Yüklenen orijinal PDF'i her zaman sil
        if (pdfPath) {
            try {
                await fsp.unlink(pdfPath);
                console.log(`[pdfDamageRoutes] Deleted temporary PDF: ${pdfPath}`);
            } catch (unlinkError) {
                console.error(`[pdfDamageRoutes] Failed to delete temporary PDF ${pdfPath}:`, unlinkError);
            }
        }
    }
});

export default router;
