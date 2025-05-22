import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import sharp from 'sharp';
import config from '../config.js';

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const croppedDir = path.join(process.cwd(), 'cropped');
if (!fs.existsSync(croppedDir)) fs.mkdirSync(croppedDir);

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
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB limit
});

async function analyzeImageWithOpenAI(imagePath, prompt) {
    const apiKey = config.openai.apiKey;
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    const payload = {
        model: config.openai.apiModel,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            "url": `data:image/jpeg;base64,${imageBase64}`
                        }
                    }
                ]
            }
        ],
        max_tokens: config.openai.maxTokens
    };
    try {
        const response = await axios.post(config.openai.apiUrl, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message || 'Bilinmeyen OpenAI API hatası';
        console.error('OpenAI API çağrısı sırasında hata:', errorMessage, error.stack);
        throw new Error(`OpenAI API analizi başarısız: ${errorMessage}`);
    }
}

// POST /api/crop-analyze
router.post('/crop-analyze', upload.single('image'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Resim yüklenmedi.' });
    }
    const imagePath = req.file.path;
    const cropAreas = [
        {
            label: 'sürücü görüşleri',
            box: { x: 50, y: 1150, width: 10000, height: 2500 }
        },
        {
            label: 'çarpışma yerinin ve anının taslağını çiziniz',
            box: { x: 29, y: 1000, width: 900, height: 190 }
        }
    ];
    try {
        const results = [];
        for (let i = 0; i < cropAreas.length; i++) {
            const area = cropAreas[i];
            let { x, y, width, height } = area.box;
            const sharpImage = sharp(imagePath);
            const metadata = await sharpImage.metadata();
            const imgWidth = metadata.width;
            const imgHeight = metadata.height;
            x = Math.max(0, x);
            y = Math.max(0, y);
            width = Math.min(width, imgWidth - x);
            height = Math.min(height, imgHeight - y);
            if (width <= 0 || height <= 0) continue;
            const cropFile = path.join(croppedDir, `${Date.now()}_${i}_${area.label.replace(/\s/g, '_')}.jpg`);
            await sharpImage.extract({ left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) }).toFile(cropFile);
            let detailPrompt;
            if (area.label === 'sürücü görüşleri') {
                detailPrompt = 'Bu alan bir trafik kazası tespit tutanağında sürücülerin kendi el yazılarıyla kazayla ilgili görüşlerini yazdıkları bölümdür. OCR ile metni olduğu gibi çıkar. Sürücü A ve Sürücü B metinlerini ayır ve aynen yaz. Yorum yapma, sadece metni olduğu gibi döndür.';
            } else if (area.label === 'çarpışma yerinin ve anının taslağını çiziniz') {
                detailPrompt = 'Bu alan bir trafik kazası tespit tutanağında sürücülerin kazanın nasıl gerçekleştiğini çizerek gösterdikleri kroki bölümüdür. Krokideki araçların konumunu, yönünü, çarpışma noktasını ve kazanın nasıl gerçekleştiğini şemadan çıkar ve detaylıca açıkla. Eğer kroki eksik veya anlaşılmazsa belirt.';
            } else {
                detailPrompt = 'Bu alanı detaylı analiz et. İçeriği, yazıları ve varsa krokiyi açıkla.';
            }
            let detailResult = null;
            try {
                detailResult = await analyzeImageWithOpenAI(cropFile, detailPrompt);
            } catch (e) {
                console.error(`'${area.label}' alanı için detaylı OpenAI analizi başarısız:`, e.message);
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