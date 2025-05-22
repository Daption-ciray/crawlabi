import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log dizinini oluştur
const logDirectory = path.join(__dirname, '../logs');
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

// Log dosyası stream'i oluştur
const accessLogStream = fs.createWriteStream(
    path.join(logDirectory, 'access.log'),
    { flags: 'a' }
);

// Custom Morgan token to log request body for POST/PUT requests
morgan.token('body', (req) => {
    if (req.method === 'POST' || req.method === 'PUT') {
        // Truncate long request bodies if necessary, or selectively log fields
        // For now, logging the full body (up to Express's limit)
        return JSON.stringify(req.body, null, 2);
    }
    return '';
});

// Custom Morgan token to log response time with high precision
morgan.token('response-time-ms', (req, res) => {
    if (!res._header || !req._startAt) return ''; // Check if timing headers are set
    const diff = process.hrtime(req._startAt);
    const ms = diff[0] * 1e3 + diff[1] * 1e-6; // Convert hrtime to milliseconds
    return ms.toFixed(2); // Format to 2 decimal places
});

// Custom log format string for Morgan
const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time-ms ms\nRequest Body: :body\n';

// Morgan middleware'ini oluştur
const morganMiddleware = morgan(logFormat, {
    stream: accessLogStream,
    skip: (req, res) => res.statusCode >= 400 // Sadece başarılı istekleri logla
});

// Hata logları için ayrı bir stream
const errorLogStream = fs.createWriteStream(
    path.join(logDirectory, 'error.log'),
    { flags: 'a' }
);

// Hata loglama middleware'i
const errorLogger = (err, req, res, next) => {
    const timestamp = new Date().toISOString();
    const errorLog = `[${timestamp}] ${err.stack}\nRequest: ${req.method} ${req.url}\nBody: ${JSON.stringify(req.body, null, 2)}\n\n`;
    
    errorLogStream.write(errorLog);
    console.error(errorLog);
    next(err);
};

// Konsol loglama middleware'i
const consoleLogger = (req, res, next) => {
    const start = process.hrtime();
    
    // Response tamamlandığında
    res.on('finish', () => {
        const diff = process.hrtime(start);
        const ms = diff[0] * 1e3 + diff[1] * 1e-6;
        
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${ms.toFixed(2)}ms)`);
        if (req.method === 'POST' || req.method === 'PUT') {
            console.log('Request Body:', JSON.stringify(req.body, null, 2));
        }
    });
    
    next();
};

export { morganMiddleware, errorLogger, consoleLogger }; 