import dotenv from 'dotenv';
dotenv.config();

export default {
    env: process.env.NODE_ENV || 'development',
    server: {
        port: parseInt(process.env.PORT, 10) || 5000,
        allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o', // Standardized model key
        visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o', // For vision-specific tasks if different
        apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 800, // Default from imageAnalyzer & analysisService
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.2, // from imageAnalyzer
        imageDetail: process.env.OPENAI_IMAGE_DETAIL || 'high', // from imageAnalyzer
        prompts: { // Prompts from imageAnalyzer.js
            analyzeImage: `Analyze this vehicle image and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "detailed description of the vehicle and its condition",
    "confidence": number from 0-100
}

For the angle, strictly use one of the provided options. For the description, include the vehicle's color, visible parts, condition, and any notable features. Be concise yet comprehensive.`,
            analyzeDamage: `Analyze this vehicle image for damage and respond in JSON format with the following fields:
{
    "angle": "[Front|Rear|Left|Right|Interior|Hood Open|Trunk Open|Car Part|Unclear / Undefined]",
    "description": "brief damage description focusing only on key damage points",
    "damage_severity": "[Minor|Moderate|Severe]",
    "confidence": number from 0-100
}

Strictly use one of the provided options for the angle and damage_severity. The description should be concise and focus only on damage details - location, type, and extent.`
        }
    },
    airtable: {
        damagedTable: process.env.AIRTABLE_DAMAGED_TABLE || "Hasarlı",
        referenceTable: process.env.AIRTABLE_REFERENCE_TABLE || "Hasarsız",
        accidentAnalysisTable: process.env.AIRTABLE_ACCIDENT_ANALYSIS_TABLE || "Kaza Analiz Tablosu",
        partAnalysisTable: process.env.AIRTABLE_PART_ANALYSIS_TABLE || "parca analiz",
        prompts: {
            damageAssessment: `You are an expert vehicle damage assessment assistant.\n\nYou will be given two image URLs:\n\n- Damaged vehicle image: [damaged]\n- Undamaged reference vehicle image: [reference]\n\nYour task is to:\n1. Compare the damaged vehicle to the undamaged reference.\n2. Identify only the parts that are visibly damaged and clearly need to be replaced or repaired.\n3. Include both external parts (e.g., bumper, fender, hood, doors, windshield, mirrors, lights, trunk, etc.) and interior parts (e.g., airbag, dashboard, steering wheel, seats, gear console, etc.) only if visible.\n4. Do not include undamaged, hidden, or unclear parts.\n5. Be precise and objective – avoid vague terms like "some damage" or "possible issues".\n6. For each part, provide a clear reason why it needs to be replaced or repaired (e.g., "cracked", "heavily dented", "torn off", "shattered").\n\nYour response must be in the following JSON format:\n{\n  "content": "Damaged / must-be-replaced parts:\\n\\n- [Part name] – [Reason]\\n- [Part name] – [Reason]",\n  "confidence": [a whole number between 0 and 100 indicating how confident you are in the damage list]\n}`,
            singlePartAssessment: `You are a certified vehicle damage assessment expert.\n\nYou will receive a photo showing part(s) of a damaged vehicle. This could be a zoomed-in photo of a single part or a wide view (e.g., hood open) showing multiple parts.\n\nYour tasks:\n1. Identify all visible vehicle parts that appear damaged in the image.\n2. For each damaged part, provide:\n   - "part_name": The name of the damaged part (e.g., "Coolant reservoir", "Radiator support").\n   - "visible_damage": A short description of the damage (e.g., "Cracked and leaking").\n   - "recommendation": One of "Replace", "Repair", or "No damage".\n   - "confidence": A whole number between 0 and 100 representing how confident you are that this specific part is damaged as described.\n\nYour output must be a valid JSON object in the following format:\n{\n  "damage_summary": [\n    {\n      "part_name": "Coolant reservoir",\n      "visible_damage": "Cracked and leaking around the cap",\n      "recommendation": "Replace",\n      "confidence": 92\n    },\n    {\n      "part_name": "Radiator support bracket",\n      "visible_damage": "Bent mounting plate with rust",\n      "recommendation": "Repair",\n      "confidence": 85\n    }\n  ]\n}`
        }
    },
    analyzer_settings: { // From imageAnalyzer.js
        validAngles: [
            'Front', 'Rear', 'Left', 'Right', 'Interior',
            'Hood Open', 'Trunk Open', 'Car Part', 'Unclear / Undefined'
        ],
        validSeverity: ['Minor', 'Moderate', 'Severe'],
        defaultHeaders: { // Consider if all these headers are needed or can be simplified
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
            'Referer': 'https://www.google.com/'
        },
        apiTimeout: parseInt(process.env.ANALYZER_API_TIMEOUT, 10) || 15000,
        maxRedirects: parseInt(process.env.ANALYZER_MAX_REDIRECTS, 10) || 5,
        retryAttempts: parseInt(process.env.ANALYZER_RETRY_ATTEMPTS, 10) || 2,
        retryDelay: parseInt(process.env.ANALYZER_RETRY_DELAY, 10) || 1000,
        maxPerMinute: parseInt(process.env.ANALYZER_MAX_PER_MINUTE, 10) || 18
    },
    scraper: { // From scraper.js
        cacheTTL: parseInt(process.env.SCRAPER_CACHE_TTL_SECONDS, 10) || 1800, // stdTTL in seconds
        launchArgs: process.env.SCRAPER_LAUNCH_ARGS ? process.env.SCRAPER_LAUNCH_ARGS.split(' ') : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        contextOptions: { // Note: viewport is an object, not easily overridable by simple env var string
            userAgent: process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { 
                width: parseInt(process.env.SCRAPER_VIEWPORT_WIDTH, 10) || 1920, 
                height: parseInt(process.env.SCRAPER_VIEWPORT_HEIGHT, 10) || 1080 
            },
            ignoreHTTPSErrors: process.env.SCRAPER_IGNORE_HTTPS_ERRORS ? process.env.SCRAPER_IGNORE_HTTPS_ERRORS === 'true' : true,
            bypassCSP: process.env.SCRAPER_BYPASS_CSP ? process.env.SCRAPER_BYPASS_CSP === 'true' : true,
            javaScriptEnabled: process.env.SCRAPER_JS_ENABLED ? process.env.SCRAPER_JS_ENABLED === 'true' : true,
            hasTouch: process.env.SCRAPER_HAS_TOUCH ? process.env.SCRAPER_HAS_TOUCH === 'true' : false,
            isMobile: process.env.SCRAPER_IS_MOBILE ? process.env.SCRAPER_IS_MOBILE === 'true' : false,
            locale: process.env.SCRAPER_LOCALE || 'tr-TR'
        },
        maxRetries: parseInt(process.env.SCRAPER_MAX_RETRIES, 10) || 3,
        retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY_MS, 10) || 2000,
        defaultTimeout: parseInt(process.env.SCRAPER_DEFAULT_TIMEOUT_MS, 10) || 30000,
        blockedDomainsKeywords: process.env.SCRAPER_BLOCKED_DOMAINS_KEYWORDS ? process.env.SCRAPER_BLOCKED_DOMAINS_KEYWORDS.split(',') : [ 
            'adservice', 'analytics', 'beacon', 'doubleclick', 'googletagmanager',
            'google-analytics', 'facebook.com/tr/', 'pixel', 'track', 'scorecardresearch',
            'adnxs', 'adform', 'adroll', 'adsystem', 'rubiconproject', 'openx', 'criteo',
            '.ads.', '/ads/', ' реклама ', 
            'googleadservices', 'appsflyer', 'criteo', 'outbrain', 'taboola', 'yieldify'
        ]
    }
};
