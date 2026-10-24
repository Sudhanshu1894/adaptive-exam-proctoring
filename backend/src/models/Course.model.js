import mongoose from 'mongoose';

const studentEnrollmentSchema = new mongoose.Schema(
  {
    rollNo: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    studentId: {
      type: String,
      default: null,
      trim: true,
    },
    studentName: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ['enrolled', 'pending_verification'],
      default: 'pending_verification',
    },
    verifiedIdentity: {
      type: Boolean,
      default: false,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    courseId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    courseCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slot: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    teacherId: {
      type: String,
      required: true,
      trim: true,
    },
    teacherEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    studentRoster: [studentEnrollmentSchema],
  },
  {
    timestamps: true,
  }
);

export const Course = mongoose.models.Course || mongoose.model('Course', courseSchema);

export default Course;
