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
        apiModel: process.env.OPENAI_API_MODEL || 'gpt-4.1',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2048,
        apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'
    }
}; 