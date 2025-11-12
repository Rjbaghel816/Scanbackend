import { getStudentModel, getAllClasses } from '../models/Student.js';
import { processExcelUpload } from '../services/excelService.js';
import xlsx from 'xlsx';

// ✅ NEW: Get all available classes
export const getClasses = async (req, res, next) => {
  try {
    const classes = await getAllClasses();
    
    res.json({
      success: true,
      classes: classes
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all students with pagination and filters
// @route   GET /api/students
// @access  Public
export const getStudents = async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '',
      status = '',
      sortBy = 'rollNumber',
      sortOrder = 'asc',
      className = 'default' // ✅ ADDED: Class parameter
    } = req.query;

    // ✅ GET DYNAMIC MODEL FOR CLASS
    const Student = getStudentModel(className);
    
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Build filter with class
    let filter = { className }; // ✅ ADDED: Filter by class
    
    if (search) {
      filter.$or = [
        { rollNumber: { $regex: search, $options: 'i' } },
        { subjectCode: { $regex: search, $options: 'i' } },
        { subjectName: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      filter.status = status;
    }

    const [students, total] = await Promise.all([
      Student.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Student.countDocuments(filter)
    ]);

    res.json({
      success: true,
      className, // ✅ RETURN CLASS NAME
      students: students.map(student => ({
        ...student,
        pagesCount: student.scannedPages ? student.scannedPages.length : 0
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalStudents: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single student
// @route   GET /api/students/:id
// @access  Public
export const getStudent = async (req, res, next) => {
  try {
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    res.json({ 
      success: true, 
      student: {
        ...student.toObject(),
        pagesCount: student.scannedPages.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update student status
// @route   PATCH /api/students/:id/status
// @access  Public
export const updateStatus = async (req, res, next) => {
  try {
    const { status, remark, className = 'default' } = req.body; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);

    // ✅ Added "Missing" in allowed statuses
    const validStatuses = ['Pending', 'Present', 'Absent', 'Missing'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Valid status is required: ${validStatuses.join(', ')}` 
      });
    }

    const updateData = { status };
    if (remark !== undefined) updateData.remark = remark;
    
    // ✅ If status is Absent or Missing, clear scanned data
    if (status === 'Absent' || status === 'Missing') {
      updateData.scannedPages = [];
      updateData.isScanned = false;
      updateData.scanTime = null;
      updateData.pdfPath = null;
      updateData.pdfGeneratedAt = null;
    }

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Status updated successfully',
      student 
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload Excel and create students
// @route   POST /api/students/upload-excel
// @access  Public
export const uploadExcel = async (req, res, next) => {
  try {
    const { className = 'default_class' } = req.body; // ✅ GET CLASS NAME FROM FRONTEND
    
    // ✅ FIXED: Check for file instead of excelData in body
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No Excel file uploaded. Please select a file.' 
      });
    }

    console.log('📁 Uploaded file details:', {
      filename: req.file.originalname,
      className: className,
      size: req.file.size,
      bufferLength: req.file.buffer?.length
    });

    let excelData = [];
    
    try {
      // ✅ FIXED: Read Excel file from buffer using xlsx
      const workbook = xlsx.read(req.file.buffer, { 
        type: 'buffer',
        cellDates: true,
        cellText: false 
      });
      
      console.log('📊 Workbook sheets:', workbook.SheetNames);
      
      // Get first sheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON array
      excelData = xlsx.utils.sheet_to_json(worksheet, { 
        header: 1, // This gives array of arrays
        defval: '',
        blankrows: false
      });
      
      console.log('📈 Excel data parsed successfully. Total rows:', excelData.length);
      
      // Show first few rows for debugging
      if (excelData.length > 0) {
        console.log('🔍 First 3 rows sample:');
        excelData.slice(0, 3).forEach((row, index) => {
          console.log(`Row ${index}:`, row);
        });
      }
      
    } catch (excelError) {
      console.error('❌ Excel parsing error:', excelError);
      return res.status(400).json({
        success: false,
        message: 'Invalid Excel file format. Please upload a valid Excel file.'
      });
    }

    if (!excelData || excelData.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Excel file is empty or contains no data' 
      });
    }

    console.log(`🔄 Processing ${excelData.length} rows for class: ${className}`);
    
    // ✅ PROCESS EXCEL WITH CLASS NAME
    const result = await processExcelUpload(excelData, className);
    
    console.log('✅ Excel processing completed:', result);
    
    res.json({
      success: true,
      message: `Excel file processed successfully for class ${className}!`,
      ...result
    });

  } catch (error) {
    console.error('❌ Excel upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process Excel file'
    });
  }
};

// @desc    Generate/Download PDF for student
// @route   GET /api/students/:id/generate-pdf
// @access  Public
export const generatePDF = async (req, res, next) => {
  try {
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (!student.isScanned || !student.pdfPath) {
      return res.status(400).json({ 
        success: false, 
        message: 'No scanned PDF available for this student' 
      });
    }

    const fs = await import('fs');
    
    if (!fs.existsSync(student.pdfPath)) {
      return res.status(404).json({ 
        success: false, 
        message: 'PDF file not found. Please rescan the copies.' 
      });
    }

    const filename = `Copy_${student.rollNumber}_${student.subjectCode}.pdf`;
    
    res.download(student.pdfPath, filename, (err) => {
      if (err) {
        console.error('PDF download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false, 
            message: 'Error downloading PDF' 
          });
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get statistics
// @route   GET /api/students/stats/summary
// @access  Public
export const getStats = async (req, res, next) => {
  try {
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    // Simple stats calculation with class filter
    const total = await Student.countDocuments({ className });
    const scanned = await Student.countDocuments({ className, isScanned: true });
    const absent = await Student.countDocuments({ className, status: 'Absent' });
    const pdfGenerated = await Student.countDocuments({ className, pdfPath: { $ne: null } });
    
    const remaining = total - scanned - absent;

    res.json({
      success: true,
      className, // ✅ RETURN CLASS NAME
      stats: {
        total: total,
        scanned: scanned,
        absent: absent,
        remaining: remaining,
        pdfGenerated: pdfGenerated
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete student and associated PDF
// @route   DELETE /api/students/:id
// @access  Public
export const deleteStudent = async (req, res, next) => {
  try {
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Delete associated PDF file if exists
    if (student.pdfPath) {
      const fs = await import('fs');
      try {
        if (fs.existsSync(student.pdfPath)) {
          await fs.promises.unlink(student.pdfPath);
          console.log(`✅ Deleted PDF: ${student.pdfPath}`);
        }
      } catch (fsError) {
        console.warn(`Could not delete PDF file: ${student.pdfPath}`, fsError);
      }
    }

    await Student.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Student and associated PDF deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete all students (for cleanup)
// @route   DELETE /api/students
// @access  Public
export const deleteAllStudents = async (req, res, next) => {
  try {
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    // Delete all PDF files first
    const fs = await import('fs');
    
    const students = await Student.find({ className, pdfPath: { $ne: null } });
    
    for (const student of students) {
      if (student.pdfPath && fs.existsSync(student.pdfPath)) {
        try {
          await fs.promises.unlink(student.pdfPath);
        } catch (fsError) {
          console.warn(`Could not delete PDF: ${student.pdfPath}`, fsError);
        }
      }
    }

    // Delete all students from database for this class
    const result = await Student.deleteMany({ className });
    
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} students and their PDF files from class ${className}`
    });
  } catch (error) {
    next(error);
  }
};

// ✅ NEW: Update student remark
export const updateStudentRemark = async (req, res, next) => {
  try {
    const { remark, className = 'default' } = req.body;
    const Student = getStudentModel(className);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { remark },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Remark updated successfully',
      student 
    });
  } catch (error) {
    next(error);
  }
};