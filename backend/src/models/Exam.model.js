import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
    },
    options: {
      type: [String],
      validate: [
        (val) => val.length >= 2,
        'Question must have at least 2 options',
      ],
      required: true,
    },
    correctOptionIndex: {
      type: Number,
      required: [true, 'Correct option index is required'],
      min: 0,
    },
    marks: {
      type: Number,
      default: 1,
      min: [1, 'Marks per question must be at least 1'],
    },
    explanation: {
      type: String,
      default: '',
    },
  },
  { _id: true }
);

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Exam title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    courseCode: {
      type: String,
      required: [true, 'Course code is required'],
      trim: true,
      uppercase: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    creatorName: {
      type: String,
      default: 'Instructor',
    },
    creatorEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      min: [5, 'Duration must be at least 5 minutes'],
      max: [300, 'Duration cannot exceed 300 minutes'],
    },
    totalMarks: {
      type: Number,
      default: 0,
    },
    passingMarks: {
      type: Number,
      required: [true, 'Passing marks are required'],
      min: [0, 'Passing marks cannot be negative'],
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },
    assignedStudentEmails: {
      type: [String],
      default: [], // If specified, only students with these emails can view and take this exam
    },
    questions: [questionSchema],
    proctoringSettings: {
      cameraRequired: { type: Boolean, default: true },
      micRequired: { type: Boolean, default: true },
      faceVerificationRequired: { type: Boolean, default: true },
      tabSwitchLimit: { type: Number, default: 3 },
      maxRiskThreshold: { type: Number, default: 50 },
    },
    courseId: {
      type: String,
      default: null,
      trim: true,
    },
    slot: {
      type: String,
      default: 'A1',
      trim: true,
    },
    instructions: {
      type: String,
      default: '',
      trim: true,
    },
    startTime: {
      type: Date,
      default: null,
    },
    endTime: {
      type: Date,
      default: null,
    },
    maxAttempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    resultsPolicy: {
      releaseMode: {
        type: String,
        enum: ['immediate', 'scheduled', 'manual'],
        default: 'immediate',
      },
      releaseDate: {
        type: Date,
        default: null,
      },
      showScore: {
        type: Boolean,
        default: true,
      },
      showCorrectAnswers: {
        type: Boolean,
        default: true,
      },
      allowReview: {
        type: Boolean,
        default: true,
      },
      showExplanations: {
        type: Boolean,
        default: true,
      },
      isResultsReleased: {
        type: Boolean,
        default: true,
      },
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-calculate total marks from questions before save
examSchema.pre('save', function (next) {
  if (this.questions && this.questions.length > 0) {
    this.totalMarks = this.questions.reduce(
      (sum, q) => sum + (q.marks || 1),
      0
    );
  } else {
    this.totalMarks = 0;
  }
  next();
});

export const Exam = mongoose.models.Exam || mongoose.model('Exam', examSchema);

export default Exam;
