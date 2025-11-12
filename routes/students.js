import express from 'express';
import multer from 'multer';
import {
  getStudents,
  getStudent,
  updateStatus,
  uploadExcel,
  generatePDF,
  getStats,
  deleteStudent,
  deleteAllStudents,
  getClasses, // ✅ NEW: Import getClasses
  updateStudentRemark // ✅ NEW: Import updateStudentRemark
} from '../controllers/studentController.js';

const router = express.Router();

// ✅ MULTER CONFIGURATION FOR FILE UPLOADS
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Allow Excel files
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/vnd.ms-excel.sheet.macroEnabled.12'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed (.xlsx, .xls)'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// ✅ NEW ROUTE: Get all available classes
router.get('/classes', getClasses);

// Routes
router.get('/', getStudents);
router.get('/stats/summary', getStats);
router.get('/:id', getStudent);
router.patch('/:id/status', updateStatus);
router.patch('/:id/remark', updateStudentRemark); // ✅ NEW: Remark update route

// ✅ FIXED: Add upload.single('file') middleware for Excel upload
router.post('/upload-excel', upload.single('file'), uploadExcel);

router.get('/:id/generate-pdf', generatePDF);
router.delete('/:id', deleteStudent);
router.delete('/', deleteAllStudents);

export default router;