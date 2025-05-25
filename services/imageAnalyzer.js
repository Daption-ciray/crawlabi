import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs/promises'; // Using promises version of fs
import path from 'path'; // To determine mime type
import appConfig from '../config.js'; // Renamed to appConfig to avoid conflicts

// Constants from appConfig
const VALID_ANGLES = appConfig.analyzer_settings.validAngles;
const VALID_SEVERITY = appConfig.analyzer_settings.validSeverity;
const DEFAULT_HEADERS = appConfig.analyzer_settings.defaultHeaders;

const API_TIMEOUT = appConfig.analyzer_settings.apiTimeout;
const MAX_REDIRECTS = appConfig.analyzer_settings.maxRedirects;
const RETRY_ATTEMPTS = appConfig.analyzer_settings.retryAttempts;
const RETRY_DELAY = appConfig.analyzer_settings.retryDelay;
const MAX_PER_MINUTE = appConfig.analyzer_settings.maxPerMinute;
let sentThisMinute = 0;

setInterval(() => { sentThisMinute = 0; }, 60000); // Interval for MAX_PER_MINUTE reset

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: appConfig.openai.apiKey // Using apiKey from appConfig
});

// Utility functions
async function sleep(ms) { // Consolidated sleep function
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function validateImageUrl(imageUrl, retryCount = 0) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        throw new Error('Invalid image URL provided');
    }

    try {
        const response = await axios.get(imageUrl, {
            headers: DEFAULT_HEADERS, // Using DEFAULT_HEADERS from appConfig
            responseType: 'arraybuffer',
            maxRedirects: MAX_REDIRECTS, // Using MAX_REDIRECTS from appConfig
            timeout: API_TIMEOUT // Using API_TIMEOUT from appConfig
        });

        const contentType = response.headers['content-type'];
        if (!contentType?.startsWith('image/')) {
            // This is a definitive failure, no retry for wrong content type
            throw new Error(`URL does not point to a valid image. Content-Type: ${contentType}`);
        }

        return true; // Image is valid
    } catch (error) {
        // Special handling for 403: proceed as OpenAI might access it
        if (error.response?.status === 403) {
            console.log(`[WARN] Received 403 for ${imageUrl}, proceeding as OpenAI might still access it.`);
            return true; // Treat as "valid" for the purpose of attempting OpenAI analysis
        }

        // Log the error for visibility
        console.warn(`[WARN] validateImageUrl attempt ${retryCount + 1}/${RETRY_ATTEMPTS + 1} failed for ${imageUrl}: ${error.message}`);

        if (retryCount < RETRY_ATTEMPTS) {
            console.log(`[INFO] Retrying image validation for ${imageUrl} in ${RETRY_DELAY}ms...`);
            await sleep(RETRY_DELAY); // Use consolidated sleep
            return validateImageUrl(imageUrl, retryCount + 1); // Recursive call for retry
        }
        
        // If all retries fail, throw the last error
        throw new Error(`Image URL validation failed after ${RETRY_ATTEMPTS + 1} attempts for ${imageUrl}: ${error.message}`);
    }
}

function validateAnalysis(analysis, requireSeverity = false) {
    if (!analysis.angle || !analysis.description || typeof analysis.confidence !== 'number') {
        throw new Error('Invalid analysis format received from API');
    }

    if (!VALID_ANGLES.includes(analysis.angle)) {
        console.warn(`Invalid angle "${analysis.angle}" received, defaulting to "Unclear / Undefined".`);
        analysis.angle = 'Unclear / Undefined';
        analysis.confidence = Math.min(analysis.confidence, 50);
    }

    if (requireSeverity) {
        if (!analysis.damage_severity) {
            console.warn('Damage severity missing when required, defaulting to "Unclear".');
            analysis.damage_severity = 'Unclear';
        } else if (!VALID_SEVERITY.includes(analysis.damage_severity)) {
            console.warn(`Invalid damage severity "${analysis.damage_severity}" received, defaulting to "Unclear".`);
            analysis.damage_severity = 'Unclear';
        }
    }

    analysis.confidence = Math.min(100, Math.max(0, analysis.confidence));
    return analysis;
}

function parseApiResponse(content, requireSeverity = false) {
    try {
        const analysis = JSON.parse(content);
        return validateAnalysis(analysis, requireSeverity);
    } catch (jsonParseError) {
        console.warn('Failed to parse API response as JSON, attempting regex extraction:', jsonParseError.message);
        const angleMatch = content.match(/"angle"\s*:\s*"([^"]+)"/i);
        const descMatch = content.match(/"description"\s*:\s*"([^"]+)"/i);
        const severityMatch = content.match(/"damage_severity"\s*:\s*"([^"]+)"/i);
        const confMatch = content.match(/"confidence"\s*:\s*(\d+)/i);

        const extractedAnalysis = {
            angle: angleMatch ? angleMatch[1].trim() : 'Unclear / Undefined',
            description: descMatch ? descMatch[1].trim() : 'No analysis available from regex',
            confidence: confMatch ? parseInt(confMatch[1], 10) : 0
        };

        if (requireSeverity) {
            extractedAnalysis.damage_severity = severityMatch ? severityMatch[1].trim() : 'Unclear';
        }
        
        console.log("Regex extracted analysis:", extractedAnalysis);
        return validateAnalysis(extractedAnalysis, requireSeverity);
    }
}

// Original sleep function removed as it's consolidated into the one above

async function callOpenAI(prompt, imageUrl, openAiRetryCount = 0) { // Renamed retryCount to avoid confusion
    try {
        const response = await openai.chat.completions.create({
            model: appConfig.openai.visionModel, // Using visionModel from appConfig
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl,
                                detail: appConfig.openai.imageDetail // Using imageDetail from appConfig
                            }
                        }
                    ]
                }
            ],
            max_tokens: appConfig.openai.maxTokens, // Using maxTokens from appConfig
            response_format: { type: "json_object" },
            temperature: appConfig.openai.temperature // Using temperature from appConfig
        });

        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI API');
        }

        return response.choices[0].message.content;
    } catch (error) {
        // Note: RETRY_ATTEMPTS and RETRY_DELAY here are for OpenAI call, not image validation.
        // These should ideally be distinct config values if OpenAI has different retry needs.
        // For now, using the same values as defined in analyzer_settings.
        if (openAiRetryCount < RETRY_ATTEMPTS) {
            console.log(`Retrying OpenAI call (${openAiRetryCount + 1}/${RETRY_ATTEMPTS}): ${error.message}`);
            await sleep(RETRY_DELAY); // Use consolidated sleep
            return callOpenAI(prompt, imageUrl, openAiRetryCount + 1);
        }
        throw error;
    }
}

async function performImageAnalysis(imageUrl, prompt, requireSeverity = false) {
    try {
        console.log(`Starting analysis for: ${imageUrl}, Severity required: ${requireSeverity}`);
        await validateImageUrl(imageUrl);

        const content = await callOpenAI(prompt, imageUrl);
        const analysis = parseApiResponse(content, requireSeverity);

        console.log('Successfully analyzed:', {
            url: imageUrl,
            ...analysis
        });
        return analysis;

    } catch (error) {
        console.error(`Error in performImageAnalysis for ${imageUrl}:`, error.message);
        return { 
            error: `Analysis failed: ${error.message}`, 
            angle: 'Unclear / Undefined', 
            description: 'Analysis failed', 
            confidence: 0,
            ...(requireSeverity && { damage_severity: 'Unclear' })
        };
    }
}

async function processBatchAnalysis(imageUrls, analysisFn) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('Invalid image URLs array provided');
    }
    console.log(`Starting batch analysis for ${imageUrls.length} images.`);
    
    const results = [];
    const errors = [];

    for (const url of imageUrls) {
        while (sentThisMinute >= MAX_PER_MINUTE) {
            console.log(`TPM limit (${MAX_PER_MINUTE}/min) reached, waiting 1 second...`);
            await sleep(1000);
        }
        sentThisMinute++;
        
        try {
            const result = await analysisFn(url);
            if (result.error) {
                 errors.push({ url, error: result.error, details: result });
            } else {
                results.push({ url, ...result });
            }
        } catch (error) {
            console.error(`Unhandled error during batch processing for ${url}:`, error.message);
            errors.push({ url, error: error.message });
        }
    }

    const summary = {
        total: imageUrls.length,
        successful: results.length,
        failed: errors.length
    };
    console.log('Batch analysis completed:', summary);
    if (errors.length > 0) {
        console.warn('Errors during batch processing:', errors);
    }
    return { results, errors, summary };
}

// Airtable kayıt fonksiyonu
async function saveToAirtable({ table, fields }) {
    const apiKey = appConfig.airtable.apiKey;
    const baseId = appConfig.airtable.baseId;
    if (!apiKey || !baseId) {
        throw new Error('Airtable API anahtarı veya Base ID eksik!');
    }
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    try {
        const response = await axios.post(url, { fields }, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Airtable kayıt hatası:', error.response?.data || error.message);
        throw error;
    }
}

// Airtable'da ilgili tablodaki tüm kayıtları silen yardımcı fonksiyon
async function clearAirtableTable(table) {
    const apiKey = appConfig.airtable.apiKey;
    const baseId = appConfig.airtable.baseId;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    // Tüm kayıtları çek
    const records = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${apiKey}`
        }
    });
    const ids = records.data.records.map(r => r.id);
    // 10'lu gruplar halinde sil
    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await axios.delete(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`
            },
            params: { 'records[]': batch }
        });
    }
}

// Tabloya yeni ID üret (ör: hasarli_arac_1, hasarli_arac_2, ...)
async function getNextAirtableId(table, idField, prefix) {
    const apiKey = appConfig.airtable.apiKey;
    const baseId = appConfig.airtable.baseId;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const records = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${apiKey}`
        }
    });
    let max = 0;
    for (const rec of records.data.records) {
        const val = rec.fields[idField];
        if (typeof val === 'string' && val.startsWith(prefix)) {
            const num = parseInt(val.replace(prefix, ''), 10);
            if (!isNaN(num) && num > max) {
                max = num;
            }
        }
    }
    return `${prefix}${max + 1}`;
}

// Sistemi başlatırken tablolardaki kayıtları temizle (bir kere çalışsın)
let tablesCleared = false;
async function clearTablesOnce() {
    if (!tablesCleared) {
        await clearAirtableTable(appConfig.airtable.damagedTable || 'Hasarlı');
        await clearAirtableTable(appConfig.airtable.referenceTable || 'Hasarsız');
        tablesCleared = true;
    }
}

/**
 * Analyzes a single image to determine its angle and general description.
 * @param {string} imageUrl - The URL of the image to analyze.
 * @returns {Promise<object>} A promise that resolves to an analysis object.
 *                            The object includes angle, description, confidence, and potentially an error.
 */
async function analyzeImage(imageUrl, extraFields = {}) {
    await clearTablesOnce();
    const prompt = appConfig.openai.prompts.analyzeImage;
    const result = await performImageAnalysis(imageUrl, prompt, false);
    // Airtable mapping (Hasarsız tablo)
    const nextId = await getNextAirtableId(appConfig.airtable.referenceTable || 'Hasarsız', 'hasarsiz_arac_id', 'hasarsiz_arac_');
    const fields = {
        hasarsiz_arac_id: nextId,
        angle: result.angle,
        confidence: result.confidence,
        hasarsiz_image_url: imageUrl,
        notes: result.description
    };
    // Tablo adı config'ten
    const table = appConfig.airtable.referenceTable || 'Hasarsız';
    await saveToAirtable({ table, fields });
    return result;
}

/**
 * Analyzes a batch of images to determine their angles and general descriptions.
 * @param {string[]} imageUrls - An array of image URLs to analyze.
 * @returns {Promise<object>} A promise that resolves to an object containing results, errors, and a summary.
 */
async function analyzeImages(imageUrls) {
    return processBatchAnalysis(imageUrls, analyzeImage);
}

/**
 * Analyzes a single image for specific damage assessment.
 * @param {string} imageUrl - The URL of the image to analyze for damage.
 * @returns {Promise<object>} A promise that resolves to an analysis object.
 *                            The object includes angle, damage description, severity, confidence, and potentially an error.
 */
async function analyzeDamage(imageUrl, extraFields = {}) {
    await clearTablesOnce();
    const prompt = appConfig.openai.prompts.analyzeDamage;
    const result = await performImageAnalysis(imageUrl, prompt, true);
    // Airtable mapping (Hasarlı tablo)
    const nextId = await getNextAirtableId(appConfig.airtable.damagedTable || 'Hasarlı', 'hasarli_arac_id', 'hasarli_arac_');
    const fields = {
        hasarli_arac_id: nextId,
        angle: result.angle,
        damage_severity: result.damage_severity,
        confidence: result.confidence,
        damage_description: result.description,
        hasarli_image_url: imageUrl
    };
    // Tablo adı config'ten
    const table = appConfig.airtable.damagedTable || 'Hasarlı';
    await saveToAirtable({ table, fields });
    return result;
}

/**
 * Analyzes a batch of images for specific damage assessment.
 * @param {string[]} imageUrls - An array of image URLs to analyze for damage.
 * @returns {Promise<object>} A promise that resolves to an object containing results, errors, and a summary.
 */
async function analyzeDamages(imageUrls) {
    return processBatchAnalysis(imageUrls, analyzeDamage);
}

export {
    analyzeImage,
    analyzeImages,
    analyzeDamage,
    analyzeDamages,
    // Exporting for potential use in analysisService if direct OpenAI call is needed with specific configurations
    // However, prefer using the specific analysis functions like analyzeDamage or analyzeImage.
    callOpenAI
};