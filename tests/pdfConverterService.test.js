import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { convertPdfToImages } from '../services/pdfConverterService.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { PDFDocument, rgb } from 'pdf-lib';
import AdmZip from 'adm-zip'; // For checking zip contents

// Adjust __dirname for ES modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const sampleFilesDir = path.join(__dirname, 'sample_files');
const samplePdfPath = path.join(sampleFilesDir, 'test_document.pdf');
let createdZipFilePath; // To store the path of the zip file for cleanup

// Set a longer timeout for tests involving file operations and processing
describe('pdfConverterService - Local Conversion (jobType: "converter")', () => {
    jest.setTimeout(60000); // 60 seconds

    beforeAll(async () => {
        try {
            // Create a directory for sample files if it doesn't exist
            await fs.mkdir(sampleFilesDir, { recursive: true });

            // Create a simple dummy PDF file for testing using pdf-lib
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([300, 200]); // Small page size
            page.drawText('This is a test PDF document for pdfConverterService.', {
                x: 10,
                y: 100,
                size: 10,
                color: rgb(0, 0, 0),
            });
            const pdfBytes = await pdfDoc.save();
            await fs.writeFile(samplePdfPath, pdfBytes);
            console.log(`Sample PDF created at: ${samplePdfPath}`);
        } catch (error) {
            console.error("Error in beforeAll creating sample PDF:", error);
            throw error; // Fail the test setup if PDF can't be created
        }
    });

    afterAll(async () => {
        try {
            // Clean up the sample PDF
            await fs.unlink(samplePdfPath);
            console.log(`Cleaned up sample PDF: ${samplePdfPath}`);
        } catch (error) {
            // Log error if cleanup fails but don't fail the test suite for it
            console.warn(`Could not clean up sample PDF: ${samplePdfPath}. Error: ${error.message}`);
        }

        // Clean up the created zip file
        if (createdZipFilePath) {
            try {
                await fs.unlink(createdZipFilePath);
                console.log(`Cleaned up test zip file: ${createdZipFilePath}`);
            } catch (error) {
                console.warn(`Could not clean up test zip file: ${createdZipFilePath}. Error: ${error.message}`);
            }
        }
        
        // Clean up the sample_files directory if empty (optional)
        try {
            const files = await fs.readdir(sampleFilesDir);
            if (files.length === 0) {
                await fs.rmdir(sampleFilesDir);
                console.log(`Cleaned up empty directory: ${sampleFilesDir}`);
            }
        } catch (error) {
            // Ignore errors if directory is not empty or cannot be removed
            console.warn(`Could not clean up directory ${sampleFilesDir}, it might not be empty or an error occurred: ${error.message}`);
        }
    });

    it('should convert PDF to a zip file, return the zip file path, and the zip should contain PNG images', async () => {
        try {
            console.log(`Calling convertPdfToImages with PDF: ${samplePdfPath}, jobType: 'converter'`);
            createdZipFilePath = await convertPdfToImages(samplePdfPath, 'converter');
            console.log(`convertPdfToImages returned: ${createdZipFilePath}`);

            // 1. Assert the function returns a string
            expect(typeof createdZipFilePath).toBe('string');

            // 2. Assert the path ends with '.zip'
            expect(createdZipFilePath.endsWith('.zip')).toBe(true);

            // 3. Assert the file at the returned path exists
            await fs.access(createdZipFilePath); // Throws if not accessible
            console.log(`Zip file exists at: ${createdZipFilePath}`);

            // 4. Assert the file is a valid zip file and contains PNGs
            const zip = new AdmZip(createdZipFilePath);
            const zipEntries = zip.getEntries();
            expect(zipEntries.length).toBeGreaterThan(0); // Check if not empty
            
            // Check if there's at least one PNG file (as we created a 1-page PDF)
            const hasPngEntry = zipEntries.some(entry => entry.entryName.endsWith('.png') && !entry.isDirectory);
            expect(hasPngEntry).toBe(true);
            
            console.log(`Test successful: Zip file created at ${createdZipFilePath} and contains PNG images.`);

        } catch (error) {
            console.error("Test execution error:", error);
            // If an error occurs, ensure createdZipFilePath is still set if the function returned before failing assertions
            if (error.message.includes("convertPdfToImages") && typeof createdZipFilePath === 'string') {
                 // This helps ensure cleanup even if assertions fail after file creation
            }
            throw error; // Re-throw to fail the test
        }
    });
});
