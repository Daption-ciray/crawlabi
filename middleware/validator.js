export const validateUrls = (req, res, next) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Please provide an array of image URLs'
        });
    }
    next();
}; 