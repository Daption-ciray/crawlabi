import OpenAI from 'openai';
import axios from 'axios';
import config from '../config.js';

// Constants
const VALID_ANGLES = [
    'Front', 'Rear', 'Left', 'Right', 'Interior',
    'Hood Open', 'Trunk Open', 'Car Part', 'Unclear / Undefined'
];

const VALID_SEVERITY = ['Minor', 'Moderate', 'Severe'];

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
    'Referer': 'https://www.google.com/'
};

const CONCURRENT_LIMIT = 2;
const API_TIMEOUT = 15000;
const MAX_REDIRECTS = 5;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY = 1000;
const MAX_PER_MINUTE = 18;
let sentThisMinute = 0;

setInterval(() => { sentThisMinute = 0; }, 60000);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: config.openai.apiKey
});

// Utility functions
async function validateImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        throw new Error('Invalid image URL provided');
    }

    try {
        const response = await axios.get(imageUrl, {
            headers: DEFAULT_HEADERS,
            responseType: 'arraybuffer',
            maxRedirects: MAX_REDIRECTS,
            timeout: API_TIMEOUT
        });

        const contentType = response.headers['content-type'];
        if (!contentType?.startsWith('image/')) {
            throw new Error(`URL does not point to a valid image. Content-Type: ${contentType}`);
        }

        return true;
    } catch (error) {
        if (error.response?.status === 403) {
            console.log('Received 403 but proceeding with analysis as GPT might be able to access the image');
            return true;
        }
        throw new Error(`Image URL validation failed: ${error.message}`);
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

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAI(prompt, imageUrl, retryCount = 0) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl,
                                detail: "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens: 800,
            response_format: { type: "json_object" },
            temperature: 0.2
        });

        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI API');
        }

        return response.choices[0].message.content;
    } catch (error) {
        if (retryCount < RETRY_ATTEMPTS) {
            console.log(`Retrying OpenAI call (${retryCount + 1}/${RETRY_ATTEMPTS}): ${error.message}`);
            await sleep(RETRY_DELAY);
            return callOpenAI(prompt, imageUrl, retryCount + 1);
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

async function analyzeImage(imageUrl) {
    const prompt = `Analyze this vehicle image and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "detailed description of the vehicle and its condition",
    "confidence": number from 0-100
}

For the angle, strictly use one of the provided options. For the description, include the vehicle's color, visible parts, condition, and any notable features. Be concise yet comprehensive.`;
    return performImageAnalysis(imageUrl, prompt, false);
}

async function analyzeImages(imageUrls) {
    return processBatchAnalysis(imageUrls, analyzeImage);
}

async function analyzeDamage(imageUrl) {
    const prompt = `Analyze this vehicle image for damage and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "brief damage description focusing only on key damage points",
    "damage_severity": "[Minor|Moderate|Severe]",
    "confidence": number from 0-100
}

Strictly use one of the provided options for the angle and damage_severity. The description should be concise and focus only on damage details - location, type, and extent.`;
    return performImageAnalysis(imageUrl, prompt, true);
}

async function analyzeDamages(imageUrls) {
    return processBatchAnalysis(imageUrls, analyzeDamage);
}

export {
    analyzeImage,
    analyzeImages,
    analyzeDamage,
    analyzeDamages
};