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

/**
 * Analyzes a single image to determine its angle and general description.
 * @param {string} imageUrl - The URL of the image to analyze.
 * @returns {Promise<object>} A promise that resolves to an analysis object.
 *                            The object includes angle, description, confidence, and potentially an error.
 */
async function analyzeImage(imageUrl) {
    const prompt = appConfig.openai.prompts.analyzeImage; // Using prompt from appConfig
    return performImageAnalysis(imageUrl, prompt, false);
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
async function analyzeDamage(imageUrl) {
    const prompt = appConfig.openai.prompts.analyzeDamage; // Using prompt from appConfig
    return performImageAnalysis(imageUrl, prompt, true);
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
    callOpenAI,
    analyzeImageFromFile // Added new function for file-based analysis
};

// --- Start of new/modified functions for file-based analysis ---

/**
 * Internal helper to call OpenAI with a base64 encoded image.
 * @param {string} imageBase64 - The base64 encoded image string.
 * @param {string} mimeType - The MIME type of the image (e.g., 'image/jpeg', 'image/png').
 * @param {string} promptText - The text prompt for the analysis.
 * @param {number} [retryCount=0] - Current retry attempt.
 * @returns {Promise<object>} The parsed JSON response from OpenAI.
 * @throws Will throw an error if the API call fails after retries.
 */
async function _callOpenAIWithBase64(imageBase64, mimeType, promptText, retryCount = 0) {
    try {
        const response = await openai.chat.completions.create({
            model: appConfig.openai.visionModel,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptText },
                        {
                            type: "image_url",
                            image_url: {
                                "url": `data:${mimeType};base64,${imageBase64}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: appConfig.openai.maxTokens,
            // response_format: { type: "json_object" }, // Only if all prompts using this will return JSON
            temperature: appConfig.openai.temperature
        });

        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI API (no content)');
        }
        // Assuming the response is JSON, if not, this will fail.
        // The prompts used by cropperRoutes might not always ask for JSON.
        // If the response is plain text, just return response.choices[0].message.content;
        // For now, let's assume it could be JSON or text, and the caller handles parsing if needed.
        return response.choices[0].message.content; // Return raw content

    } catch (error) {
        if (retryCount < RETRY_ATTEMPTS) {
            console.log(`[WARN] _callOpenAIWithBase64 attempt ${retryCount + 1}/${RETRY_ATTEMPTS + 1} failed: ${error.message}`);
            console.log(`[INFO] Retrying OpenAI call with base64 image in ${RETRY_DELAY}ms...`);
            await sleep(RETRY_DELAY);
            return _callOpenAIWithBase64(imageBase64, mimeType, promptText, retryCount + 1);
        }
        console.error(`[ERROR] _callOpenAIWithBase64 failed after ${RETRY_ATTEMPTS + 1} attempts: ${error.message}`);
        throw error; // Re-throw the error to be caught by the caller
    }
}

/**
 * Reads an image file, converts it to base64, and analyzes it using OpenAI with a given prompt.
 * This function is intended for use cases where a dynamic prompt is applied to a local image file.
 * @param {string} imagePath - The local path to the image file.
 * @param {string} promptText - The text prompt for the analysis.
 * @returns {Promise<object>} A promise that resolves to the OpenAI API response data (raw content).
 * @throws Will throw an error if file reading or API call fails.
 */
async function analyzeImageFromFile(imagePath, promptText) {
    console.log(`[INFO] Starting analysis for image file: ${imagePath}`);
    try {
        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        
        let mimeType = 'image/jpeg'; // Default MIME type
        const ext = path.extname(imagePath).toLowerCase();
        if (ext === '.png') {
            mimeType = 'image/png';
        } else if (ext === '.jpg' || ext === '.jpeg') {
            mimeType = 'image/jpeg';
        } else if (ext === '.webp') {
            mimeType = 'image/webp';
        }
        // Add more MIME types as needed

        console.log(`[INFO] Image file read and encoded to base64. MIME type: ${mimeType}. Prompt: "${promptText.substring(0,100)}..."`);

        // Using the new internal helper for base64 images
        const analysisResult = await _callOpenAIWithBase64(imageBase64, mimeType, promptText);
        
        console.log('[INFO] Successfully analyzed image from file.');
        return analysisResult; // Return raw content, parsing should be handled by caller if JSON is expected

    } catch (error) {
        console.error(`[ERROR] Error in analyzeImageFromFile for ${imagePath}:`, error.message, error.stack);
        // Ensure the error is re-thrown so the route can catch it
        throw new Error(`Failed to analyze image from file ${imagePath}: ${error.message}`);
    }
}
// --- End of new/modified functions for file-based analysis ---