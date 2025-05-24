import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs'; // Use standard fs for createReadStream
import appConfig from '../config.js';

const CLOUDCONVERT_API_KEY = appConfig.cloudconvert.apiKey;
const CLOUDCONVERT_API_URL = appConfig.cloudconvert.apiUrl;

/**
 * Converts a PDF file to a series of PNG images using CloudConvert API.
 * @param {string} pdfFilePath - The local path to the PDF file.
 * @returns {Promise<string[]>} A promise that resolves to an array of image URLs.
 * @throws Will throw an error if any step in the conversion process fails.
 */
async function convertPdfToImages(pdfFilePath) {
    if (!CLOUDCONVERT_API_KEY) {
        throw new Error('CloudConvert API key is not configured.');
    }

    console.log(`[pdfConverterService] Starting PDF conversion for: ${pdfFilePath}`);

    // 1. Create a CloudConvert job
    console.log('[pdfConverterService] Creating CloudConvert job...');
    let jobRes;
    try {
        jobRes = await axios.post(
            `${CLOUDCONVERT_API_URL}/jobs`,
            {
                tasks: {
                    import_pdf: {
                        operation: 'import/upload',
                    },
                    convert_pdf: {
                        operation: 'convert',
                        input: 'import_pdf',
                        output_format: 'png',
                        engine: 'poppler', // Specify engine for potentially better results
                        // page_range: '', // All pages by default if empty or omitted
                    },
                    export_images: {
                        operation: 'export/url',
                        input: 'convert_pdf',
                        inline: false, // Ensure we get URLs
                        archive_multiple_files: false // Get individual file URLs
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (error) {
        console.error('[pdfConverterService] Error creating CloudConvert job:', error.response ? error.response.data : error.message);
        throw new Error(`CloudConvert job creation failed: ${error.message}`);
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

    // 2. Upload the PDF file
    const form = new FormData();
    for (const key in uploadParams) {
        form.append(key, uploadParams[key]);
    }
    form.append('file', fs.createReadStream(pdfFilePath));

    try {
        await axios.post(uploadUrl, form, { headers: form.getHeaders() });
        console.log('[pdfConverterService] PDF uploaded successfully.');
    } catch (error) {
        console.error('[pdfConverterService] Error uploading PDF to CloudConvert:', error.response ? error.response.data : error.message);
        throw new Error(`PDF upload to CloudConvert failed: ${error.message}`);
    }

    // 3. Wait for the job to complete
    console.log('[pdfConverterService] Waiting for CloudConvert job to complete...');
    let currentJobStatus = 'waiting';
    let currentJobData;
    const startTime = Date.now();
    const timeoutMs = 300000; // 5 minutes timeout for conversion

    while (currentJobStatus !== 'finished' && currentJobStatus !== 'error') {
        if (Date.now() - startTime > timeoutMs) {
            console.error(`[pdfConverterService] CloudConvert job ${jobId} timed out.`);
            throw new Error(`CloudConvert job ${jobId} timed out after ${timeoutMs / 1000} seconds.`);
        }
        await new Promise(res => setTimeout(res, 3000)); // Poll every 3 seconds
        try {
            const statusRes = await axios.get(`${CLOUDCONVERT_API_URL}/jobs/${jobId}`, {
                headers: { Authorization: `Bearer ${CLOUDCONVERT_API_KEY}` },
            });
            currentJobData = statusRes.data.data;
            currentJobStatus = currentJobData.status;
            console.log(`[pdfConverterService] Job ${jobId} status: ${currentJobStatus}`);
        } catch (error) {
            console.warn('[pdfConverterService] Error fetching job status, retrying:', error.message);
            // Allow loop to continue for retries, timeout will catch persistent errors
        }
    }

    if (currentJobStatus === 'error') {
        console.error('[pdfConverterService] CloudConvert job failed:', currentJobData);
        const failedTask = currentJobData.tasks.find(task => task.status === 'error');
        const errorMessage = failedTask ? `${failedTask.name} operation failed: ${failedTask.message}` : 'Unknown error in CloudConvert job.';
        throw new Error(`CloudConvert job failed! ${errorMessage}`);
    }

    console.log('[pdfConverterService] CloudConvert job finished. Retrieuting image URLs...');

    // 4. Get the exported image URLs
    const exportTask = currentJobData.tasks.find(t => t.name === 'export_images' && t.status === 'finished');
    if (!exportTask || !exportTask.result || !exportTask.result.files) {
        console.error('[pdfConverterService] Export task not found or failed:', currentJobData);
        throw new Error('Could not retrieve image URLs from CloudConvert job.');
    }

    const imageUrls = exportTask.result.files.map(f => f.url);
    console.log('[pdfConverterService] Image URLs retrieved:', imageUrls);
    return imageUrls;
}

export { convertPdfToImages };
