import express from 'express';
import {
  uploadScans,
  deleteScans,
  downloadPDF,
  getPDFInfo,
  rescanStudent,
  batchDeleteScans
} from '../controllers/uploadController.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Upload scans and generate PDF directly
router.post('/scan/:studentId', 
  upload.array('images', 50),
  handleMulterError,
  uploadScans
);

// Delete scans and PDF
router.delete('/scan/:studentId', deleteScans);

// Download PDF with class support
router.get('/pdf/:studentId', downloadPDF);

// Get PDF info without downloading
router.get('/pdf/:studentId/info', getPDFInfo);

// Rescan student (delete old and allow new scan)
router.post('/rescan/:studentId', rescanStudent);

// Batch delete multiple students' scans
router.post('/batch-delete', batchDeleteScans);

export default router;