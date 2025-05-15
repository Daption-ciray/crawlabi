import dotenv from 'dotenv';
dotenv.config();

export default {
    openai: {
        apiKey: process.env.OPENAI_API_KEY
    },
    server: {
        port: process.env.PORT || 3000
    }
}; 