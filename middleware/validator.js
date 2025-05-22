/**
 * Middleware to validate if the request body contains a non-empty array of 'urls'.
 * Responds with a 400 error if validation fails.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 */
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