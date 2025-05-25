import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { promises as fsp } from 'fs';
import archiver from 'archiver';
import appConfig from '../config.js';
import path from 'path';
import os from 'os';
import { createCanvas } from 'canvas';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Attempting with createRequire for pdfjs-dist legacy build.

const CLOUDCONVERT_API_KEY = appConfig.cloudconvert.apiKey;
const CLOUDCONVERT_API_URL = appConfig.cloudconvert.apiUrl;

/**
 * Converts a PDF file to a series of PNG images.
 * If jobType is 'converter', uses local pdfjs-dist/canvas for conversion.
 * Otherwise, uses CloudConvert API.
 * @param {string} pdfFilePath - The local path to the PDF file.
 * @param {string} [jobType] - 'converter' or 'kaza_analiz' (or other CloudConvert jobs).
 * @returns {Promise<string[]|string>} - Array of image URLs (for CloudConvert) or path to the zip file (for local 'converter' job).
 */
async function convertPdfToImages(pdfFilePath, jobType = 'kaza_analiz') {
    if (jobType === 'converter') {
        console.log(`[pdfConverterService] Starting PDF conversion using pdfjs-dist/canvas for: ${pdfFilePath}`);
        const outputDir = path.join(os.tmpdir(), `pdfjs_output_${Date.now()}`);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        try {
            const data = new Uint8Array(await fsp.readFile(pdfFilePath));
            const loadingTask = pdfjsLib.getDocument({ data });
            const pdf = await loadingTask.promise;
            const numPages = pdf.numPages;
            const imagePaths = [];
            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 2.0 }); // 2x zoom, daha okunaklı
                const canvas = createCanvas(viewport.width, viewport.height);
                const context = canvas.getContext('2d');
                await page.render({ canvasContext: context, viewport }).promise;
                const outPath = path.join(outputDir, `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_${pageNum}.png`);
                const out = fs.createWriteStream(outPath);
                const stream = canvas.createPNGStream();
                await new Promise((resolve, reject) => {
                    stream.pipe(out);
                    out.on('finish', resolve);
                    out.on('error', reject);
                });
                imagePaths.push(outPath);
            }
            console.log(`[pdfConverterService] pdfjs-dist conversion successful. Images saved to: ${outputDir}`);
            
            const zipFileName = `pdf_images_${path.basename(pdfFilePath, path.extname(pdfFilePath))}_${Date.now()}.zip`;
            const zipFilePath = path.join(os.tmpdir(), zipFileName);
            const outputZip = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });

            return new Promise((resolve, reject) => {
                outputZip.on('close', () => {
                    console.log(`[pdfConverterService] Zip file created: ${zipFilePath} (${archive.pointer()} total bytes)`);
                    // Clean up the temporary image directory
                    fsp.rm(outputDir, { recursive: true, force: true })
                        .then(() => {
                            console.log(`[pdfConverterService] Cleaned up temporary image directory: ${outputDir}`);
                            resolve(zipFilePath);
                        })
                        .catch(err => {
                            console.error(`[pdfConverterService] Error cleaning up temp directory ${outputDir}:`, err);
                            // Resolve with zip path anyway, as zipping was successful
                            resolve(zipFilePath);
                        });
                });

                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('[pdfConverterService] Archiver warning: ', err);
                    } else {
                        reject(err);
                    }
                });

                archive.on('error', (err) => {
                    // Attempt to clean up the outputDir even if zipping fails
                    if (fs.existsSync(outputDir)) {
                        fsp.rm(outputDir, { recursive: true, force: true }).catch(cleanupErr => {
                           console.error(`[pdfConverterService] Error during cleanup after zip failure for ${outputDir}:`, cleanupErr);
                        });
                    }
                    // also attempt to delete partially created zip file
                    if (fs.existsSync(zipFilePath)) {
                        fsp.unlink(zipFilePath).catch(cleanupErr => {
                            console.error(`[pdfConverterService] Error deleting partial zip ${zipFilePath} after failure:`, cleanupErr);
                        });
                    }
                    reject(new Error(`Zipping failed: ${err.message}`));
                });

                archive.pipe(outputZip);

                imagePaths.forEach(imgPath => {
                    archive.file(imgPath, { name: path.basename(imgPath) });
                });

                archive.finalize();
            });

        } catch (error) {
            console.error('[pdfConverterService] pdfjs-dist conversion or zipping error details:', error);
            // If the error is not from zipping (e.g. pdf rendering failed), outputDir might still exist.
            // If the error IS from zipping, the 'archive.on('error')' handler above should have tried to clean it.
            // This is a fallback.
            if (fs.existsSync(outputDir) && !(error.message && error.message.startsWith('Zipping failed'))) {
                try {
                    await fsp.rm(outputDir, { recursive: true, force: true });
                     console.log(`[pdfConverterService] Cleaned up ${outputDir} in main catch block after error: ${error.message}`);
                } catch (cleanupErr) {
                    console.error(`[pdfConverterService] Error cleaning up ${outputDir} in main catch block:`, cleanupErr);
                }
            }
            throw new Error(`Local PDF conversion and zipping process failed: ${error.message || error}`);
        }
    } else {
        // CloudConvert ile devam et (mevcut kod olduğu gibi kalacak)
        if (!CLOUDCONVERT_API_KEY) {
            throw new Error('CloudConvert API key is not configured.');
        }
        console.log(`[pdfConverterService] Starting PDF conversion using CloudConvert for: ${pdfFilePath}`);
        
        console.log('[pdfConverterService] Creating CloudConvert job...');
        let jobRes;
        try {
            jobRes = await axios.post(
                `${CLOUDCONVERT_API_URL}/jobs`,
                {
                    tasks: {
                        import_pdf: { operation: 'import/upload' },
                        convert_pdf: {
                            operation: 'convert',
                            input: 'import_pdf',
                            output_format: 'png',
                            engine: 'poppler', // CloudConvert hala poppler kullanabilir
                        },
                        export_images: {
                            operation: 'export/url',
                            input: 'convert_pdf',
                            inline: false,
                            archive_multiple_files: false
                        },
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    // CloudConvert için timeout (15 dakika)
                    timeout: 900000 
                }
            );
        } catch (error) {
            console.error('[pdfConverterService] Error creating CloudConvert job:', error.response ? error.response.data : error.message);
            throw new Error(`CloudConvert job creation failed: ${error.message ? error.message : 'Unknown error'}`);
        }

        const jobData = jobRes.data.data;
        const jobId = jobData.id;
        const importTask = jobData.tasks.find(t => t.name === 'import_pdf');
        if (!importTask || !importTask.result || !importTask.result.form) {
            console.error('[pdfConverterService] Failed to get upload task details from CloudConvert job:', jobData);
            throw new Error('CloudConvert job creation did not return expected upload task details.');
        }
        const uploadUrl = importTask.result.form.url;
        const uploadParams = importTask.result.form.parameters;
        console.log(`[pdfConverterService] CloudConvert job ${jobId} created. Uploading PDF...`);
        const form = new FormData();
        for (const key in uploadParams) {
            form.append(key, uploadParams[key]);
        }
        form.append('file', fs.createReadStream(pdfFilePath));
        try {
            await axios.post(uploadUrl, form, {
                 headers: form.getHeaders(),
                 timeout: 900000 // Yükleme için de timeout
            });
            console.log('[pdfConverterService] PDF uploaded successfully.');
        } catch (error) {
            console.error('[pdfConverterService] Error uploading PDF to CloudConvert:', error.response ? error.response.data : error.message);
            throw new Error(`PDF upload to CloudConvert failed: ${error.message}`);
        }
        console.log('[pdfConverterService] Waiting for CloudConvert job to complete...');
        let currentJobStatus = 'waiting';
        let currentJobData;
        const startTime = Date.now();
        const timeoutMs = 900000; 
        while (currentJobStatus !== 'finished' && currentJobStatus !== 'error') {
            if (Date.now() - startTime > timeoutMs) {
                console.error(`[pdfConverterService] CloudConvert job ${jobId} timed out.`);
                // Hata durumunda ve timeout durumunda geçici klasörü temizleme (CloudConvert için geçerli değil, çünkü URL alıyoruz)
                throw new Error(`CloudConvert job ${jobId} timed out after ${timeoutMs / 1000} seconds.`);
            }
            await new Promise(res => setTimeout(res, 5000)); // Bekleme süresini 5 saniyeye çıkardım, API'yi daha az yormak için
            try {
                const statusRes = await axios.get(`${CLOUDCONVERT_API_URL}/jobs/${jobId}`, {
                    headers: { Authorization: `Bearer ${CLOUDCONVERT_API_KEY}` },
                    timeout: 30000 // Durum sorgulama için timeout
                });
                currentJobData = statusRes.data.data;
                currentJobStatus = currentJobData.status;
                console.log(`[pdfConverterService] Job ${jobId} status: ${currentJobStatus}`);
            } catch (error) {
                console.warn('[pdfConverterService] Error fetching job status, retrying:', error.message);
                // Burada hata oluşursa döngü devam edebilir, ancak sürekli hata alıyorsa bir noktada kesmek iyi olabilir.
            }
        }
        if (currentJobStatus === 'error') {
            console.error('[pdfConverterService] CloudConvert job failed:', currentJobData);
            const failedTask = currentJobData.tasks.find(task => task.status === 'error');
            const errorMessage = failedTask ? `${failedTask.name} operation failed: ${failedTask.message}` : 'Unknown error in CloudConvert job.';
            throw new Error(`CloudConvert job failed! ${errorMessage}`);
        }
        console.log('[pdfConverterService] CloudConvert job finished. Retrieuting image URLs...');
        const exportTask = currentJobData.tasks.find(t => t.name === 'export_images' && t.status === 'finished');
        if (!exportTask || !exportTask.result || !exportTask.result.files) {
            console.error('[pdfConverterService] Export task not found or failed:', currentJobData);
            throw new Error('Could not retrieve image URLs from CloudConvert job.');
        }
        const imageUrls = exportTask.result.files.map(f => f.url);
        console.log('[pdfConverterService] Image URLs retrieved (first 5):', imageUrls.slice(0,5));
        return imageUrls;
    }
}

export { convertPdfToImages };