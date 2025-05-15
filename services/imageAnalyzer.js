import OpenAI from 'openai';
import axios from 'axios';
import config from '../config.js';
import pLimit from 'p-limit';

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

// Initialize rate limiter
const limit = pLimit(CONCURRENT_LIMIT);

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
        analysis.angle = 'Unclear / Undefined';
        analysis.confidence = Math.min(analysis.confidence, 50);
    }

    if (requireSeverity && !VALID_SEVERITY.includes(analysis.damage_severity)) {
        analysis.damage_severity = 'Unclear';
    }

    analysis.confidence = Math.min(100, Math.max(0, analysis.confidence));
    return analysis;
}

function parseApiResponse(content, requireSeverity = false) {
    try {
        const analysis = JSON.parse(content);
        return validateAnalysis(analysis, requireSeverity);
    } catch (error) {
        console.error('Failed to parse API response as JSON:', error);
        const angleMatch = content.match(/angle["\s:]+([^"}\n]+)/i);
        const descMatch = content.match(/description["\s:]+([^"}\n]+)/i);
        const severityMatch = content.match(/damage_severity["\s:]+([^"}\n]+)/i);
        const confMatch = content.match(/confidence["\s:]+(\d+)/i);

        return validateAnalysis({
            angle: angleMatch ? angleMatch[1].trim() : 'Unclear / Undefined',
            description: descMatch ? descMatch[1].trim() : 'No analysis available',
            damage_severity: severityMatch ? severityMatch[1].trim() : 'Unclear',
            confidence: confMatch ? parseInt(confMatch[1]) : 0
        }, requireSeverity);
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

async function safeAnalyzeImage(url, fn) {
    while (sentThisMinute >= MAX_PER_MINUTE) {
        console.log('TPM limitine yaklaşıldı, 1 sn bekleniyor...');
        await sleep(1000);
    }
    sentThisMinute++;
    return fn(url);
}

async function analyzeImage(imageUrl) {
    try {
        console.log('Starting image analysis for:', imageUrl);
        await validateImageUrl(imageUrl);

        const prompt = `Analyze this vehicle image and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "detailed description of the vehicle and its condition",
    "confidence": number from 0-100
}

For the angle, strictly use one of the provided options. For the description, include the vehicle's color, visible parts, condition, and any notable features. Be concise yet comprehensive.`;

        const content = await callOpenAI(prompt, imageUrl);
        const analysis = parseApiResponse(content);

        console.log('Successfully analyzed image:', {
            url: imageUrl,
            angle: analysis.angle,
            confidence: analysis.confidence
        });

        return {
            angle: analysis.angle,
            description: analysis.description,
            confidence: analysis.confidence
        };

    } catch (error) {
        console.error('Error in analyzeImage:', {
            error: error.message,
            imageUrl: imageUrl
        });
        throw new Error(`Image analysis failed: ${error.message}`);
    }
}

async function analyzeImages(imageUrls) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('Invalid image URLs array provided');
    }
    console.log('Starting batch image analysis for', imageUrls.length, 'images');
    const results = [];
    const errors = [];
    for (const url of imageUrls) {
        try {
            const result = await safeAnalyzeImage(url, analyzeImage);
            results.push({ url, ...result });
        } catch (error) {
            errors.push({ url, error: error.message });
        }
    }
    const summary = {
        total: imageUrls.length,
        successful: results.length,
        failed: errors.length
    };
    console.log('Batch analysis completed:', summary);
    return { results, errors, summary };
}

async function analyzeDamage(imageUrl) {
    try {
        console.log('Starting damage analysis for:', imageUrl);
        await validateImageUrl(imageUrl);

        const prompt = `Analyze this vehicle image for damage and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "brief damage description focusing only on key damage points",
    "damage_severity": "[Minor|Moderate|Severe]",
    "confidence": number from 0-100
}

Strictly use one of the provided options for the angle and damage_severity. The description should be concise and focus only on damage details - location, type, and extent.`;

        const content = await callOpenAI(prompt, imageUrl);
        const analysis = parseApiResponse(content, true);

        console.log('Successfully analyzed damage:', {
            url: imageUrl,
            angle: analysis.angle,
            severity: analysis.damage_severity,
            confidence: analysis.confidence
        });

        return {
            angle: analysis.angle,
            description: analysis.description,
            damage_severity: analysis.damage_severity,
            confidence: analysis.confidence
        };

    } catch (error) {
        console.error('Error in analyzeDamage:', {
            error: error.message,
            imageUrl: imageUrl
        });
        throw new Error(`Damage analysis failed: ${error.message}`);
    }
}

async function analyzeDamages(imageUrls) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('Invalid image URLs array provided');
    }
    console.log('Starting batch damage analysis for', imageUrls.length, 'images');
    const results = [];
    const errors = [];
    for (const url of imageUrls) {
        try {
            const result = await safeAnalyzeImage(url, analyzeDamage);
            results.push({ url, ...result });
        } catch (error) {
            errors.push({ url, error: error.message });
        }
    }
    const summary = {
        total: imageUrls.length,
        successful: results.length,
        failed: errors.length
    };
    console.log('Batch damage analysis completed:', summary);
    return { results, errors, summary };
}

export {
    analyzeImage,
    analyzeImages,
    analyzeDamage,
    analyzeDamages
};