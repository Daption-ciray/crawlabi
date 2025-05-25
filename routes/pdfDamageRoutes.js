import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { convertPdfToImages } from '../services/pdfConverterService.js';
import { analyzeDamages } from '../services/imageAnalyzer.js';
import appConfig from '../config.js';
import archiver from 'archiver';
import axios from 'axios';
import os from 'os';

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads_pdf');
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[INFO] PDF upload directory created: ${uploadDir}`);
    } else {
        console.log(`[INFO] PDF upload directory already exists: ${uploadDir}`);
    }
} catch (err) {
    console.error('Failed to create PDF upload directory:', err);
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
    limits: { fileSize: appConfig.cropper ? appConfig.cropper.maxFileSizeMB * 1024 * 1024 : 25 * 1024 * 1024 }
});

// Yardımcı fonksiyon: Bir URL listesindeki dosyaları indirip geçici klasöre kaydeder
async function downloadImagesToTempDir(imageUrls) {
    const tempDir = path.join(os.tmpdir(), `cloudconvert_images_${Date.now()}`);
    await fsp.mkdir(tempDir, { recursive: true });
    const localPaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const ext = path.extname(url).split('?')[0] || '.png';
        const fileName = `image_${i + 1}${ext}`;
        const filePath = path.join(tempDir, fileName);
        const response = await axios.get(url, { responseType: 'stream' });
        await new Promise((resolve, reject) => {
            const stream = fs.createWriteStream(filePath);
            response.data.pipe(stream);
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
        localPaths.push(filePath);
    }
    return { tempDir, localPaths };
}

router.post('/analyze-pdf-damage', upload.single('pdf'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'PDF file not uploaded.' });
    }

    const pdfPath = req.file.path;
    const jobType = req.headers['jobtype'] || 'kaza_analiz';
    console.log(`[pdfDamageRoutes] Received PDF: ${req.file.originalname}, saved to ${pdfPath}, jobType: ${jobType}`);

    try {
        const imageUrls = await convertPdfToImages(pdfPath);

        if (jobType === 'converter') {
            // CloudConvert'ten dönen resimleri indir, zip'le ve gönder
            const { tempDir, localPaths } = await downloadImagesToTempDir(imageUrls);
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', 'attachment; filename=converted_images.zip');
            const archive = archiver('zip');
            archive.pipe(res);
            for (const filePath of localPaths) {
                archive.file(filePath, { name: path.basename(filePath) });
            }
            archive.finalize();
            res.on('finish', () => {
                // Temp dosyaları temizle
                for (const filePath of localPaths) {
                    fsp.unlink(filePath).catch(err => console.error(`Failed to delete temp image file ${filePath}:`, err));
                }
                fsp.rmdir(tempDir, { recursive: true }).catch(err => console.error(`Failed to delete temp image directory ${tempDir}:`, err));
            });
            return;
        } else {
            // CloudConvert'ten dönen resim URL'lerini analiz fonksiyonuna gönder
            if (!imageUrls || imageUrls.length === 0) {
                return res.status(500).json({ error: 'PDF conversion resulted in no images.' });
            }
            const analysisResult = await analyzeDamages(imageUrls);
            res.json({
                message: 'PDF processed and damage analysis initiated.',
                conversion: {
                    sourcePdf: req.file.originalname,
                    imageCount: imageUrls.length,
                    imageUrls: imageUrls
                },
                analysis: {
                    damage_analyses: analysisResult.results,
                    errors: analysisResult.errors,
                    summary: analysisResult.summary
                }
            });
        }
    } catch (error) {
        next(error);
    } finally {
        // Yüklenen orijinal PDF'i her zaman sil
        if (pdfPath) {
            try {
                await fsp.unlink(pdfPath);
            } catch (unlinkError) {
                console.error(`[pdfDamageRoutes] Failed to delete temporary PDF ${pdfPath}:`, unlinkError);
            }
        }
    }
});

export default router;
