import mongoose from 'mongoose';

const scannedPageSchema = new mongoose.Schema({
  pageNumber: { 
    type: Number, 
    required: true 
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  }
}, { _id: true });

const studentSchema = new mongoose.Schema({
  rollNumber: { 
    type: String, 
    required: true, 
    trim: true,
    index: true 
  },
  subjectCode: { 
    type: String, 
    required: true, 
    trim: true 
  },
  subjectName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  status: { 
    type: String, 
    enum: ['Pending', 'Present', 'Absent', 'Missing'],
    default: 'Pending' 
  },
  remark: { 
    type: String, 
    default: '' 
  },
  scannedPages: [scannedPageSchema],
  isScanned: { 
    type: Boolean, 
    default: false 
  },
  scanTime: { 
    type: Date 
  },
  pdfPath: {
    type: String,
    default: null
  },
  pdfName: {
    type: String,
    default: null
  },
  pdfGeneratedAt: {
    type: Date,
    default: null
  },
  className: {
    type: String,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Indexes
studentSchema.index({ className: 1, rollNumber: 1 });
studentSchema.index({ className: 1, status: 1 });
studentSchema.index({ className: 1, isScanned: 1 });

// Virtual for pages count
studentSchema.virtual('pagesCount').get(function() {
  return this.scannedPages.length;
});

// Update isScanned based on scannedPages
studentSchema.pre('save', function(next) {
  if (this.scannedPages && this.scannedPages.length > 0) {
    this.isScanned = true;
    if (!this.scanTime) {
      this.scanTime = new Date();
    }
  } else {
    this.isScanned = false;
    this.scanTime = null;
    this.pdfPath = null;
    this.pdfName = null;
    this.pdfGeneratedAt = null;
  }
  next();
});

// ✅ FIXED: DYNAMIC MODEL CREATION with proper className handling
const studentModels = new Map();

export const getStudentModel = (className) => {
  // ✅ FIX: Ensure className is always a string
  let normalizedClassName;
  if (Array.isArray(className)) {
    normalizedClassName = className[0]; // Take first element if it's an array
  } else {
    normalizedClassName = className;
  }
  
  normalizedClassName = normalizedClassName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  
  if (!studentModels.has(normalizedClassName)) {
    const collectionName = `class_${normalizedClassName}`;
    
    const ClassStudentModel = mongoose.model(
      `Student_${normalizedClassName}`, 
      studentSchema, 
      collectionName
    );
    
    studentModels.set(normalizedClassName, ClassStudentModel);
    console.log(`✅ Created new model for class: ${normalizedClassName}`);
  }
  
  return studentModels.get(normalizedClassName);
};

// Get all available classes
export const getAllClasses = async () => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    const classCollections = collections
      .filter(col => col.name.startsWith('class_'))
      .map(col => ({
        collectionName: col.name,
        className: col.name.replace('class_', ''),
        displayName: col.name.replace('class_', '').replace(/_/g, ' ')
      }));

    return classCollections;
  } catch (error) {
    console.error('Error fetching classes:', error);
    return [];
  }
};

export default mongoose.model('Student', studentSchema);