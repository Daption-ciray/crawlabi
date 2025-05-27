import express from 'express';
import OpenAI from 'openai';
import config from '../config.js';
import { md2docx } from '@adobe/helix-md2docx';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

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
        if (markdownContent.startsWith('```\n')) {
            markdownContent = markdownContent.substring(4);
        }
        if (markdownContent.endsWith('\n```')) {
            markdownContent = markdownContent.substring(0, markdownContent.length - 4);
        }
        if (markdownContent.startsWith('"') && markdownContent.endsWith('"')) {
            markdownContent = markdownContent.substring(1, markdownContent.length - 1);
        }
        return markdownContent.trim();
    } catch (error) {
        console.error('JSON to Markdown conversion error:', error);
        throw new Error('Failed to convert JSON to Markdown');
    }
}

router.post('/generate-report', async (req, res) => {
    try {
        const jsonData = req.body;
        const format = req.query.format || 'docx';

        // JSON'ı Markdown'a çevir
        const markdownContent = await convertJsonToMarkdown(jsonData);
        console.log('Generated Markdown:\n', markdownContent);

        // Markdown'ı DOCX'e çevir
        const docxBuffer = await md2docx(markdownContent);

        if (format === 'pdf') {
            // Markdown'ı HTML'e çevir
            const htmlContent = marked.parse(markdownContent);
            // Puppeteer ile HTML'den PDF oluştur
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            const pdfBuffer = await page.pdf({ format: 'A4' });
            await browser.close();

            // PDF'i base64 string olarak döndür
            const base64Content = Buffer.from(pdfBuffer).toString('base64');
            res.json({
                success: true,
                format: 'pdf',
                data: base64Content
            });
            return;
        }

        // DOCX formatı için mevcut davranış
        const base64Content = Buffer.from(docxBuffer).toString('base64');
        res.json({
            success: true,
            format: 'docx',
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