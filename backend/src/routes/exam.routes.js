import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { requireTeacher, requireStudent } from '../middleware/role.middleware.js';
import {
  createExam,
  getTeacherExams,
  getExamDetails,
  updateExam,
  deleteExam,
  togglePublishStatus,
  getExamAnalytics,
  updateResultsPolicy,
  getAvailableExams,
  startAttempt,
  saveAnswer,
  submitAttempt,
  getMyAttempts,
  getAttemptDetails,
  recordProctoringEvent,
  getAttemptProctoringEvents,
  getAllTeacherAttemptsHandler,
  enrollReferenceImage,
  getReferenceStatus,
  analyzeProctoringFrame,
  getAttemptProctoringStatus,
} from '../controllers/exam.controller.js';

const router = express.Router();

// ==========================================
// TEACHER WORKSPACE ROUTES (RBAC: teacher)
// ==========================================
router.post('/teacher', protect, requireTeacher, createExam);
router.get('/teacher', protect, requireTeacher, getTeacherExams);
router.get('/teacher/attempts', protect, requireTeacher, getAllTeacherAttemptsHandler);
router.get('/teacher/all-attempts', protect, requireTeacher, getAllTeacherAttemptsHandler);
router.get('/teacher/:id', protect, requireTeacher, getExamDetails);
router.put('/teacher/:id', protect, requireTeacher, updateExam);
router.delete('/teacher/:id', protect, requireTeacher, deleteExam);
router.patch('/teacher/:id/publish', protect, requireTeacher, togglePublishStatus);
router.patch('/teacher/:id/results-policy', protect, requireTeacher, updateResultsPolicy);
router.get('/teacher/:id/analytics', protect, requireTeacher, getExamAnalytics);

// ==========================================
// STUDENT ARENA ROUTES (RBAC: student)
// ==========================================
router.get('/student/available', protect, requireStudent, getAvailableExams);
router.post('/student/start', protect, requireStudent, startAttempt);
router.patch('/student/attempt/:attemptId/answer', protect, requireStudent, saveAnswer);
router.post('/student/attempt/:attemptId/submit', protect, requireStudent, submitAttempt);
router.get('/student/attempts', protect, requireStudent, getMyAttempts);
router.get('/student/attempt/:attemptId', protect, requireStudent, getAttemptDetails);
router.post('/student/attempt/:attemptId/proctor-event', protect, requireStudent, recordProctoringEvent);
router.post('/student/attempt/:attemptId/proctor-frame', protect, requireStudent, analyzeProctoringFrame);
router.get('/student/attempt/:attemptId/proctor-status', protect, requireStudent, getAttemptProctoringStatus);
router.post('/student/enroll-reference', protect, requireStudent, enrollReferenceImage);
router.get('/student/reference-status', protect, requireStudent, getReferenceStatus);

// Common / Audit telemetry route
router.get('/attempt/:attemptId/proctor-events', protect, getAttemptProctoringEvents);
router.get('/:id', protect, getExamDetails);

export default router;

