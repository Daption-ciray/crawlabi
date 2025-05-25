import express from 'express';
import OpenAI from 'openai';
import config from '../config.js';
import { md2docx } from '@adobe/helix-md2docx';
// import { Readable } from 'stream'; // Artık Readable'a ihtiyacımız olmayabilir
// import fs, { promises as fsp } from 'fs'; // Dosya işlemlerine ihtiyacımız olmayabilir
// import path from 'path'; // Path'e ihtiyacımız olmayabilir

const router = express.Router();

const openai = new OpenAI({
    apiKey: config.openai.apiKey
});

// JSON'ı Markdown'a çeviren fonksiyon
async function convertJsonToMarkdown(jsonData) {
    try {
        const prompt = `Convert the following JSON data into a well-formatted markdown document. 
        Include proper headings, bold text, and maintain the structure. 
        The output should be clean and professional looking markdown:
        
        ${JSON.stringify(jsonData, null, 2)}`;

        const completion = await openai.chat.completions.create({
            model: config.openai.defaultModel,
            messages: [
                {
                    role: "system",
                    content: "You are a professional document formatter. Convert the given JSON into well-formatted markdown."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3
        });

        let markdownContent = completion.choices[0].message.content;
        // LLM çıktısının başlangıç ve bitişindeki gereksiz tırnakları veya markdown block işaretlerini temizle
        if (markdownContent.startsWith('```\n')) {
            markdownContent = markdownContent.substring(4);
        }
        if (markdownContent.endsWith('\n```')) {
            markdownContent = markdownContent.substring(0, markdownContent.length - 4);
        }
         if (markdownContent.startsWith('"') && markdownContent.endsWith('"')) {
            markdownContent = markdownContent.substring(1, markdownContent.length - 1);
        }

        return markdownContent.trim(); // Baş ve sondaki boşlukları temizle

    } catch (error) {
        console.error('JSON to Markdown conversion error:', error);
        throw new Error('Failed to convert JSON to Markdown');
    }
}

// Ana route
router.post('/generate-report', async (req, res) => {
    try {
        const jsonData = req.body;

        // JSON'ı Markdown'a çevir (LLM kullanarak)
        const markdownContent = await convertJsonToMarkdown(jsonData);
        console.log('Generated Markdown:\n', markdownContent); // Oluşturulan markdown'ı logla

        // Markdown string'ini doğrudan DOCX buffer'a çevir (@adobe/helix-md2docx kütüphanesini kullan)
        // Kütüphanenin doğrudan string alıp buffer döndürdüğünü varsayıyoruz.
        const docxBuffer = await md2docx(markdownContent);

        // DOCX buffer'ını base64'e çevir
        const base64Content = docxBuffer.toString('base64');

        // Response gönder
        res.json({
            success: true,
            data: base64Content
        });

    } catch (error) {
        console.error('Report generation error:\n', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate report'
        });
    }
});

export default router; 