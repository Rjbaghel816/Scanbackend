import { getStudentModel } from '../models/Student.js';
import { generateAndSavePDF } from '../services/pdfService.js';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

// ✅ Helper function to check if file exists
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// ✅ FAST image compression
const fastCompressImage = async (buffer) => {
  try {
    return await sharp(buffer)
      .rotate()
      .resize(800, 1000, {
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true
      })
      .jpeg({
        quality: 60,
        progressive: true,
        force: true
      })
      .toBuffer();
  } catch (error) {
    console.warn('Fast compression failed, using original');
    return buffer;
  }
};

// ✅ PARALLEL image processing
const processImagesInParallel = async (files, maxConcurrency = 4) => {
  console.log(`🔄 Processing ${files.length} images with ${maxConcurrency} parallel workers`);
  
  const results = [];
  const queue = [...files];
  
  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrency);
    const batchPromises = batch.map(file => fastCompressImage(file.buffer));
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.warn('Image compression failed, using original');
        results.push(batch[index].buffer);
      }
    });
    
    console.log(`✅ Processed ${results.length}/${files.length} images`);
  }
  
  return results;
};

// @desc    ULTRA-FAST upload scans
// @route   POST /api/upload/scan/:studentId
// @access  Public
export const uploadScans = async (req, res, next) => {
  const startTime = Date.now();
  console.log(`🚀 Starting ULTRA-FAST upload for ${req.files?.length || 0} images`);
  
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.body; // ✅ GET CLASS NAME
    
    const Student = getStudentModel(className); // ✅ USE DYNAMIC MODEL
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No images uploaded' 
      });
    }

    if (files.length > 50) {
      return res.status(400).json({ 
        success: false, 
        message: 'Too many images. Maximum 50 allowed.' 
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (student.status === 'Absent' || student.status === 'Missing') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot scan copies for absent/missing students' 
      });
    }

    console.log(`📸 Processing ${files.length} images for ${student.rollNumber} in class ${className}`);

    try {
      // ✅ STEP 1: Parallel image compression
      const compressionStart = Date.now();
      const compressedBuffers = await processImagesInParallel(files, 4);
      console.log(`⚡ Compression completed in ${Date.now() - compressionStart}ms`);
      
      // ✅ STEP 2: Fast PDF generation
      const pdfStart = Date.now();
      const pdfResult = await generateAndSavePDF(student, compressedBuffers);
      console.log(`⚡ PDF generation completed in ${Date.now() - pdfStart}ms`);
      
      // ✅ STEP 3: Update database
      const scannedPages = files.map((file, index) => ({
        pageNumber: index + 1,
        timestamp: new Date()
      }));

      // Cleanup old PDF
      if (student.pdfPath && await fileExists(student.pdfPath)) {
        try {
          await fs.unlink(student.pdfPath);
          console.log(`✅ Deleted old PDF`);
        } catch (fsError) {
          console.warn('Could not delete old PDF:', fsError.message);
        }
      }

      student.scannedPages = scannedPages;
      student.isScanned = true;
      student.status = student.status === 'Pending' ? 'Present' : student.status;
      student.scanTime = new Date();
      student.pdfPath = pdfResult.pdfPath;
      student.pdfName = pdfResult.pdfFilename; // ✅ Save PDF filename
      student.pdfGeneratedAt = new Date();

      await student.save();

      const totalTime = Date.now() - startTime;
      console.log(`🎉 TOTAL PROCESSING TIME: ${totalTime}ms for ${files.length} images`);

      res.json({
        success: true,
        message: `Successfully scanned ${files.length} pages in ${totalTime}ms`,
        processingTime: totalTime,
        student: {
          ...student.toObject(),
          pagesCount: student.scannedPages.length
        },
        pdfInfo: {
          pdfName: student.pdfName,
          pdfPath: student.pdfPath,
          filename: path.basename(pdfResult.pdfPath),
          pageCount: pdfResult.pageCount,
          fileSize: pdfResult.fileSize,
          downloadUrl: `/api/upload/pdf/${studentId}?className=${className}`
        }
      });

    } catch (pdfError) {
      console.error('❌ PDF generation failed:', pdfError);
      
      if (student.pdfPath && await fileExists(student.pdfPath)) {
        try {
          await fs.unlink(student.pdfPath);
        } catch (cleanupError) {
          console.warn('Cleanup failed:', cleanupError.message);
        }
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to process scanned images.' 
      });
    }

  } catch (error) {
    console.error('❌ Upload scans error:', error);
    next(error);
  }
};

// @desc    Delete student scans and PDF
// @route   DELETE /api/upload/scan/:studentId
// @access  Public
export const deleteScans = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (student.pdfPath) {
      try {
        if (await fileExists(student.pdfPath)) {
          await fs.unlink(student.pdfPath);
          console.log(`✅ Deleted PDF: ${student.pdfPath}`);
        }
      } catch (fsError) {
        console.warn('Could not delete PDF file:', fsError);
      }
    }

    student.scannedPages = [];
    student.isScanned = false;
    student.scanTime = null;
    student.pdfPath = null;
    student.pdfName = null;
    student.pdfGeneratedAt = null;

    await student.save();

    res.json({
      success: true,
      message: 'Scans and PDF deleted successfully',
      student: {
        ...student.toObject(),
        pagesCount: 0
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Download PDF
// @route   GET /api/upload/pdf/:studentId
// @access  Public
export const downloadPDF = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (!student.pdfPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'PDF not found for this student' 
      });
    }

    if (!(await fileExists(student.pdfPath))) {
      student.pdfPath = null;
      student.pdfGeneratedAt = null;
      await student.save();
      
      return res.status(404).json({ 
        success: false, 
        message: 'PDF file not found. Please rescan.' 
      });
    }

    const filename = `Copy_${student.rollNumber}_${student.subjectCode}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(student.pdfPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: 'Error streaming PDF file' 
        });
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get PDF info without downloading
// @route   GET /api/upload/pdf/:studentId/info
// @access  Public
export const getPDFInfo = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.query; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (!student.pdfPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'PDF not generated for this student' 
      });
    }

    let fileStats = null;
    try {
      if (await fileExists(student.pdfPath)) {
        fileStats = await fs.stat(student.pdfPath);
      }
    } catch (error) {
      console.warn('Could not get PDF file stats:', error);
    }

    res.json({
      success: true,
      pdfInfo: {
        pdfName: student.pdfName || `Copy_${student.rollNumber}_${student.subjectCode}.pdf`,
        pdfPath: student.pdfPath,
        filename: student.pdfName || `Copy_${student.rollNumber}_${student.subjectCode}.pdf`,
        filePath: student.pdfPath,
        fileSize: fileStats?.size || 0,
        generatedAt: student.pdfGeneratedAt,
        pageCount: student.scannedPages?.length || 0,
        downloadUrl: `/api/upload/pdf/${studentId}?className=${className}`,
        exists: !!fileStats
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Rescan student - delete old and allow new scan
// @route   POST /api/upload/rescan/:studentId
// @access  Public
export const rescanStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.body; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (student.pdfPath) {
      try {
        if (await fileExists(student.pdfPath)) {
          await fs.unlink(student.pdfPath);
          console.log(`✅ Deleted PDF for rescan: ${student.pdfPath}`);
        }
      } catch (fsError) {
        console.warn('Could not delete PDF file for rescan:', fsError);
      }
    }

    student.scannedPages = [];
    student.isScanned = false;
    student.scanTime = null;
    student.pdfPath = null;
    student.pdfName = null;
    student.pdfGeneratedAt = null;

    await student.save();

    res.json({
      success: true,
      message: 'Student reset for rescanning',
      student: {
        ...student.toObject(),
        pagesCount: 0
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Batch delete multiple students' scans
// @route   POST /api/upload/batch-delete
// @access  Public
export const batchDeleteScans = async (req, res, next) => {
  try {
    const { studentIds, className = 'default' } = req.body; // ✅ ADDED: Class parameter
    const Student = getStudentModel(className);
    
    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student IDs array is required' 
      });
    }

    const results = {
      deleted: 0,
      failed: 0,
      errors: []
    };

    for (const studentId of studentIds) {
      try {
        const student = await Student.findById(studentId);
        if (student) {
          if (student.pdfPath) {
            try {
              if (await fileExists(student.pdfPath)) {
                await fs.unlink(student.pdfPath);
              }
            } catch (fsError) {
              console.warn(`Could not delete PDF for student ${studentId}:`, fsError);
            }
          }

          student.scannedPages = [];
          student.isScanned = false;
          student.scanTime = null;
          student.pdfPath = null;
          student.pdfName = null;
          student.pdfGeneratedAt = null;

          await student.save();
          results.deleted++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Student ${studentId}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `Batch delete completed: ${results.deleted} successful, ${results.failed} failed`,
      results
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Delete PDF file from filesystem and MongoDB
// @route   DELETE /api/upload/pdf/:studentId
// @access  Public
export const deletePDF = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { className = 'default' } = req.query;
    const Student = getStudentModel(className);
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    if (!student.pdfPath) {
      return res.status(400).json({ 
        success: false, 
        message: 'No PDF found for this student' 
      });
    }

    // Delete PDF file from filesystem
    let fileDeleted = false;
    if (await fileExists(student.pdfPath)) {
      try {
        await fs.unlink(student.pdfPath);
        fileDeleted = true;
        console.log(`✅ Deleted PDF file: ${student.pdfPath}`);
      } catch (fsError) {
        console.warn('Could not delete PDF file:', fsError);
        return res.status(500).json({ 
          success: false, 
          message: `Failed to delete PDF file: ${fsError.message}` 
        });
      }
    } else {
      console.warn(`PDF file not found at path: ${student.pdfPath}`);
    }

    // Reset student record in MongoDB
    student.status = 'Pending';
    student.isScanned = false;
    student.scannedPages = [];
    student.scanTime = null;
    student.pdfPath = null;
    student.pdfName = null;
    student.pdfGeneratedAt = null;
    await student.save();

    res.json({
      success: true,
      message: fileDeleted 
        ? 'PDF file and database entry deleted successfully' 
        : 'PDF database entry removed (file was already missing)',
      student: {
        ...student.toObject(),
        pagesCount: 0
      }
    });

  } catch (error) {
    next(error);
  }
};