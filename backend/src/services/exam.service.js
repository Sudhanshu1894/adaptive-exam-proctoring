import mongoose from 'mongoose';
import { Exam } from '../models/Exam.model.js';
import { ExamAttempt } from '../models/ExamAttempt.model.js';
import { uploadEvidenceSnapshot, getPresignedDownloadUrl } from './aws/s3.service.js';
import { detectFaces, detectLabels, compareFaces } from './aws/rekognition.service.js';
import { getStudentReferenceImage } from './user.service.js';
import { invokeIncidentEvaluatorLambda } from './aws/lambda.service.js';
import { sendHighRiskProctorAlert } from './aws/sns.service.js';
import {
  evaluateProctoringRisk,
  evaluateSnsAlertTrigger,
  generateProctoringSummary,
  getRecommendedIntervalMs,
  calculateRiskLevel,
  ABSENCE_THRESHOLDS,
} from './proctoring/riskEngine.service.js';

import { initialMemoryExams, initialMemoryAttempts } from './mockData.js';
import dynamoService, { isDynamoDbMode } from './dynamo/dynamo.service.js';

// In-Memory store fallback for standalone development (mock mode only)
const memoryExams = [...initialMemoryExams];
const memoryAttempts = [...initialMemoryAttempts];

const isMongoConnected = () => !isDynamoDbMode() && mongoose.connection.readyState === 1;


/**
 * Sanitize question objects for students (stripping correct answer)
 */
export const sanitizeQuestionsForStudent = (questions) => {
  return (questions || []).map((q, idx) => {
    const raw = q.toObject ? q.toObject() : { ...q };
    delete raw.correctOptionIndex;
    delete raw.explanation;
    const qId = (raw._id || raw.questionId || raw.id || `q_${idx}`).toString();
    const text = raw.text || raw.question || '';
    return {
      ...raw,
      _id: qId,
      id: qId,
      questionId: qId,
      text,
      question: text,
      options: Array.isArray(raw.options) ? raw.options : [],
      marks: Number(raw.marks) || 1,
    };
  });
};

/**
 * Evaluates whether exam results are currently released based on the teacher's policy
 */
export const isExamResultsReleased = (exam) => {
  if (!exam) return false;
  const policy = exam.resultsPolicy || {};
  const releaseMode = policy.releaseMode || 'immediate';

  if (releaseMode === 'immediate') {
    return true;
  }
  if (releaseMode === 'scheduled') {
    if (!policy.releaseDate) return false;
    return new Date() >= new Date(policy.releaseDate);
  }
  if (releaseMode === 'manual') {
    return policy.isResultsReleased === true;
  }
  return true;
};

/**
 * Sanitizes an attempt for student consumption based strictly on the teacher's results and answer review policy.
 * Students must NEVER receive hidden answers, unreleased marks, or unauthorized result data through API responses.
 */
export const sanitizeAttemptForStudent = (attempt, exam) => {
  if (!attempt) return null;
  const rawAttempt = attempt.toObject ? attempt.toObject() : { ...attempt };
  const rawExam = exam && exam.toObject ? exam.toObject() : (exam || {});
  const policy = rawExam.resultsPolicy || {};

  const isReleased = isExamResultsReleased(rawExam);

  // If results are NOT released yet:
  if (!isReleased) {
    return {
      _id: rawAttempt._id || rawAttempt.sessionId,
      sessionId: rawAttempt.sessionId || rawAttempt._id,
      attemptId: rawAttempt.sessionId || rawAttempt._id,
      examId: rawAttempt.examId || rawAttempt.exam,
      studentId: rawAttempt.studentId || rawAttempt.student,
      examTitle: rawAttempt.examTitle || rawExam.title,
      courseCode: rawAttempt.courseCode || rawExam.courseCode,
      slot: rawExam.slot || 'A1',
      status: rawAttempt.status,
      startTime: rawAttempt.startTime,
      endTime: rawAttempt.endTime,
      durationMinutes: rawAttempt.durationMinutes,
      resultsStatus: 'pending_release',
      resultsMessage: policy.releaseMode === 'scheduled' && policy.releaseDate
        ? `Results scheduled for release on ${new Date(policy.releaseDate).toLocaleString()}`
        : 'Results are pending instructor review and release.',
      isResultsReleased: false,
      resultsPolicy: {
        releaseMode: policy.releaseMode || 'manual',
        releaseDate: policy.releaseDate || null,
        showScore: policy.showScore !== false,
        showCorrectAnswers: policy.showCorrectAnswers !== false,
        allowReview: policy.allowReview !== false,
        showExplanations: policy.showExplanations !== false,
      },
    };
  }

  // Results ARE released: Enforce granular visibility controls
  const showScore = policy.showScore !== false;
  const showCorrectAnswers = policy.showCorrectAnswers !== false;
  const allowReview = policy.allowReview !== false;
  const showExplanations = policy.showExplanations !== false;

  const sanitized = {
    ...rawAttempt,
    resultsStatus: 'released',
    isResultsReleased: true,
    resultsPolicy: {
      releaseMode: policy.releaseMode || 'immediate',
      releaseDate: policy.releaseDate || null,
      showScore,
      showCorrectAnswers,
      allowReview,
      showExplanations,
    },
  };

  // 1. Show or hide scores
  if (!showScore) {
    delete sanitized.score;
    delete sanitized.totalMarks;
    delete sanitized.percentage;
    delete sanitized.isPassed;
  }

  // 2. Allow or disallow answer review
  if (!allowReview) {
    delete sanitized.answers;
  } else if (Array.isArray(sanitized.answers)) {
    // If review is allowed, process questions and answer details
    const questionMap = new Map();
    (rawExam.questions || []).forEach((q) => {
      const qId = (q._id || q.questionId || q.id).toString();
      questionMap.set(qId, q);
    });

    sanitized.answers = sanitized.answers.map((ans) => {
      const qId = (ans.questionId || ans._id || '').toString();
      const originalQ = questionMap.get(qId) || {};
      const answerCopy = { ...ans };

      // Attach question text and options for display in review
      answerCopy.questionText = originalQ.text || originalQ.question || '';
      answerCopy.options = originalQ.options || [];
      answerCopy.maxMarks = originalQ.marks || 1;

      // 3. Show or hide correct answers
      if (showCorrectAnswers) {
        answerCopy.correctOptionIndex = originalQ.correctOptionIndex;
      } else {
        delete answerCopy.correctOptionIndex;
        delete answerCopy.isCorrect;
        delete answerCopy.marksAwarded;
      }

      // 4. Show or hide explanations
      if (showExplanations && originalQ.explanation) {
        answerCopy.explanation = originalQ.explanation;
      } else {
        delete answerCopy.explanation;
      }

      return answerCopy;
    });
  }

  return sanitized;
};

/**
 * Teacher: Create new exam
 */
export const createExam = async (examData, teacherUser) => {
  const calculatedTotalMarks = (examData.questions || []).reduce(
    (sum, q) => sum + (Number(q.marks) || 1),
    0
  );

  let courseInfo = null;
  if (examData.courseId) {
    try {
      courseInfo = await dynamoService.getCourse(examData.courseId);
    } catch {
      courseInfo = null;
    }
  }

  const resultsPolicy = {
    releaseMode: examData.resultsPolicy?.releaseMode || 'immediate',
    releaseDate: examData.resultsPolicy?.releaseDate || null,
    showScore: examData.resultsPolicy?.showScore !== false,
    showCorrectAnswers: examData.resultsPolicy?.showCorrectAnswers !== false,
    allowReview: examData.resultsPolicy?.allowReview !== false,
    showExplanations: examData.resultsPolicy?.showExplanations !== false,
    isResultsReleased: examData.resultsPolicy?.isResultsReleased !== undefined
      ? !!examData.resultsPolicy.isResultsReleased
      : (examData.resultsPolicy?.releaseMode === 'immediate'),
  };

  const payload = {
    ...examData,
    courseId: examData.courseId || null,
    courseCode: courseInfo ? courseInfo.courseCode : (examData.courseCode || 'GENERAL-101'),
    courseTitle: courseInfo ? courseInfo.title : (examData.courseTitle || ''),
    slot: courseInfo ? courseInfo.slot : (examData.slot || 'A1'),
    instructions: examData.instructions || '',
    startTime: examData.startTime || null,
    endTime: examData.endTime || null,
    maxAttempts: Number(examData.maxAttempts) || 1,
    resultsPolicy,
    creator: teacherUser.id || teacherUser._id,
    creatorName: teacherUser.name,
    creatorEmail: (examData.creatorEmail || teacherUser.email || '').toLowerCase().trim(),
    status: examData.status || 'draft',
    totalMarks: calculatedTotalMarks,
    passingMarks: Number(examData.passingMarks) || Math.floor(calculatedTotalMarks * 0.4),
  };

  if (isDynamoDbMode()) {
    return await dynamoService.putExam(payload);
  }

  if (isMongoConnected()) {
    return await Exam.create(payload);
  }

  const newExam = {
    _id: `exam_${Date.now()}`,
    ...payload,
    questions: (payload.questions || []).map((q, idx) => ({
      _id: q._id || `q_${Date.now()}_${idx}`,
      ...q,
      marks: Number(q.marks) || 1,
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  memoryExams.push(newExam);
  return newExam;
};

/**
 * Teacher: Get all exams created by teacher
 */
export const getTeacherExams = async (teacherId) => {
  if (isDynamoDbMode()) {
    const exams = await dynamoService.listExams(teacherId);
    return exams.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  if (isMongoConnected()) {
    return await Exam.find({
      $or: [
        { creator: teacherId },
        { isMockTest: true },
        { courseCode: 'MOCK-101' },
      ],
    }).sort({ createdAt: -1 }).exec();
  }

  return memoryExams
    .filter((e) => e.creator.toString() === teacherId.toString() || e.isMockTest || e.courseCode === 'MOCK-101')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

/**
 * Common: Get exam by ID
 */
export const getExamById = async (examId, sanitizeForStudent = false) => {
  let exam = null;

  if (isDynamoDbMode()) {
    exam = await dynamoService.getExam(examId);
  } else if (isMongoConnected()) {
    exam = await Exam.findById(examId).exec();
  } else {
    exam = memoryExams.find((e) => (e._id || e.examId).toString() === examId.toString());
  }

  if (!exam) return null;

  const examData = exam.toObject ? exam.toObject() : { ...exam };

  if (sanitizeForStudent && examData.questions) {
    examData.questions = sanitizeQuestionsForStudent(examData.questions);
  }

  return examData;
};

/**
 * Teacher: Update exam
 */
export const updateExam = async (examId, updateData, teacherId) => {
  if (isDynamoDbMode()) {
    const current = await dynamoService.getExam(examId);
    if (!current) return null;

    if (teacherId && current.creator && current.creator.toString() !== teacherId.toString()) {
      throw new Error('Unauthorized to modify this examination');
    }

    const updated = {
      ...current,
      ...updateData,
      updatedAt: new Date().toISOString(),
    };
    if (updateData.questions) {
      updated.totalMarks = updateData.questions.reduce(
        (sum, q) => sum + (Number(q.marks) || 1),
        0
      );
    }
    return await dynamoService.putExam(updated);
  }

  if (isMongoConnected()) {
    const exam = await Exam.findOne({ _id: examId, creator: teacherId });
    if (!exam) return null;

    Object.assign(exam, updateData);
    if (updateData.questions) {
      exam.totalMarks = updateData.questions.reduce(
        (sum, q) => sum + (Number(q.marks) || 1),
        0
      );
    }
    return await exam.save();
  }

  const index = memoryExams.findIndex(
    (e) => (e._id || e.examId).toString() === examId.toString() && e.creator.toString() === teacherId.toString()
  );
  if (index === -1) return null;

  const current = memoryExams[index];
  const updated = {
    ...current,
    ...updateData,
    updatedAt: new Date(),
  };

  if (updateData.questions) {
    updated.totalMarks = updateData.questions.reduce(
      (sum, q) => sum + (Number(q.marks) || 1),
      0
    );
  }

  memoryExams[index] = updated;
  return updated;
};

/**
 * Teacher: Delete exam
 */
export const deleteExam = async (examId, teacherId) => {
  if (isDynamoDbMode()) {
    const current = await dynamoService.getExam(examId);
    if (!current) return null;
    if (teacherId && current.creator && current.creator.toString() !== teacherId.toString()) {
      throw new Error('Unauthorized to delete this examination');
    }
    current.status = 'deleted';
    await dynamoService.putExam(current);
    return current;
  }

  if (isMongoConnected()) {
    return await Exam.findOneAndDelete({ _id: examId, creator: teacherId }).exec();
  }

  const index = memoryExams.findIndex(
    (e) => (e._id || e.examId).toString() === examId.toString() && e.creator.toString() === teacherId.toString()
  );
  if (index === -1) return null;

  return memoryExams.splice(index, 1)[0];
};

/**
 * Teacher: Toggle publish status
 */
export const setExamPublishStatus = async (examId, status, teacherId) => {
  return await updateExam(examId, { status }, teacherId);
};

/**
 * Student: Get all published exams filtered strictly by enrolled courses and schedule
 */
export const getAvailableExamsForStudent = async (studentId, teacherEmailFilter = null, studentEmail = null) => {
  let publishedExams = [];

  if (isDynamoDbMode()) {
    const all = await dynamoService.listExams(null);
    publishedExams = all.filter((e) => {
      if (e.status !== 'published') return false;
      if (teacherEmailFilter && teacherEmailFilter.trim()) {
        return (e.creatorEmail || '').toLowerCase().trim() === teacherEmailFilter.trim().toLowerCase();
      }
      return true;
    });
  } else if (isMongoConnected()) {
    let query = { status: 'published' };
    if (teacherEmailFilter && teacherEmailFilter.trim()) {
      query.creatorEmail = teacherEmailFilter.trim().toLowerCase();
    }
    publishedExams = await Exam.find(query).sort({ createdAt: -1 }).lean().exec();
  } else {
    publishedExams = memoryExams.filter((e) => {
      if (e.status !== 'published') return false;
      if (teacherEmailFilter && teacherEmailFilter.trim()) {
        return (e.creatorEmail || '').toLowerCase().trim() === teacherEmailFilter.trim().toLowerCase();
      }
      return true;
    });
  }

  const normalizedStudentEmail = (studentEmail || '').toLowerCase().trim();

  // Retrieve courses in which this student is officially enrolled
  let studentEnrolledCourses = [];
  try {
    studentEnrolledCourses = await dynamoService.listCoursesByStudent(normalizedStudentEmail);
  } catch (err) {
    console.warn('[Student Courses List Warning]', err.message);
  }

  const enrolledCourseIds = new Set(studentEnrolledCourses.map((c) => c.courseId));
  const enrolledCourseCodes = new Set(studentEnrolledCourses.map((c) => c.courseCode));

  // Filter exams: Students must ONLY access quizzes for course sections in which they are enrolled.
  publishedExams = publishedExams.filter((exam) => {
    // Exactly 1 onboarding mock test is open to all students to understand the system
    if (exam.isMockTest || exam.courseCode === 'MOCK-101') return true;

    // Check if quiz is attached to a course section the student is enrolled in
    if (exam.courseId && enrolledCourseIds.has(exam.courseId)) return true;
    if (exam.courseCode && enrolledCourseCodes.has(exam.courseCode)) return true;

    // Fallback: Check explicitly assigned emails
    const assigned = Array.isArray(exam.assignedStudentEmails) ? exam.assignedStudentEmails : [];
    if (assigned.length > 0 && (assigned.includes('*') || assigned.some((e) => e.toLowerCase().trim() === normalizedStudentEmail))) {
      return true;
    }

    return false;
  });

  // Check if student has active or completed attempts
  let studentAttempts = [];
  if (isDynamoDbMode()) {
    studentAttempts = await dynamoService.listStudentSessions(studentId);
  } else if (isMongoConnected()) {
    studentAttempts = await ExamAttempt.find({ student: studentId }).lean().exec();
  } else {
    studentAttempts = memoryAttempts.filter((a) => a.student.toString() === studentId.toString());
  }

  const now = new Date();

  return publishedExams.map((exam) => {
    const examIdStr = (exam._id || exam.examId).toString();
    const attempts = studentAttempts.filter(
      (a) => (a.exam || a.examId || '').toString() === examIdStr
    );
    const activeAttempt = attempts.find((a) => a.status === 'in_progress');
    const completedAttempts = attempts.filter((a) => a.status === 'completed' || a.status === 'timed_out');
    const lastCompletedAttempt = completedAttempts[0] || null;

    const maxAttempts = Number(exam.maxAttempts) || 1;
    const attemptsUsed = completedAttempts.length;
    const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);

    // Schedule evaluation
    const startTimeObj = exam.startTime ? new Date(exam.startTime) : null;
    const endTimeObj = exam.endTime ? new Date(exam.endTime) : null;

    const isUpcoming = startTimeObj && startTimeObj > now;
    const isClosed = endTimeObj && endTimeObj <= now;
    const isOpen = (!startTimeObj || startTimeObj <= now) && (!endTimeObj || endTimeObj > now);

    const hasActiveAttempt = !!activeAttempt;
    const hasAttempted = completedAttempts.length > 0;
    const canAttempt = isOpen && attemptsRemaining > 0 && !hasActiveAttempt;
    const canResume = hasActiveAttempt;

    // Determine LMS quiz status category
    let lmsStatus = 'available_now';
    if (hasActiveAttempt) {
      lmsStatus = 'in_progress';
    } else if (isUpcoming) {
      lmsStatus = 'upcoming';
    } else if (isClosed) {
      lmsStatus = 'closed';
    } else if (attemptsRemaining === 0) {
      lmsStatus = 'completed';
    } else if (isOpen) {
      lmsStatus = 'available_now';
    }

    // Results release status
    const isReleased = isExamResultsReleased(exam);

    return {
      _id: examIdStr,
      examId: examIdStr,
      title: exam.title,
      description: exam.description,
      instructions: exam.instructions || '',
      courseId: exam.courseId || null,
      courseCode: exam.courseCode,
      courseTitle: exam.courseTitle || '',
      slot: exam.slot || 'A1',
      creatorName: exam.creatorName,
      creatorEmail: exam.creatorEmail || '',
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      questionCount: (exam.questions || []).length,
      startTime: exam.startTime || null,
      endTime: exam.endTime || null,
      maxAttempts,
      attemptsUsed,
      attemptsRemaining,
      lmsStatus,
      isUpcoming,
      isOpen,
      isClosed,
      canAttempt,
      canResume,
      hasAttempted,
      isResultsReleased: isReleased,
      resultsPolicy: exam.resultsPolicy || {
        releaseMode: 'immediate',
        showScore: true,
        showCorrectAnswers: true,
        allowReview: true,
        showExplanations: true,
      },
      activeAttemptId: activeAttempt ? (activeAttempt.sessionId || activeAttempt._id) : null,
      completedAttemptId: lastCompletedAttempt ? (lastCompletedAttempt.sessionId || lastCompletedAttempt._id) : null,
      score: (isReleased && exam.resultsPolicy?.showScore !== false && lastCompletedAttempt) ? lastCompletedAttempt.score : null,
      isPassed: (isReleased && exam.resultsPolicy?.showScore !== false && lastCompletedAttempt) ? lastCompletedAttempt.isPassed : null,
    };
  });
};

/**
 * Student: Start examination attempt with strict LMS schedule and attempt limit validation
 */
export const startExamAttempt = async (examId, studentUser) => {
  const exam = await getExamById(examId, false);
  if (!exam) {
    throw new Error('Examination not found');
  }
  if (exam.status !== 'published') {
    throw new Error('This examination is currently not open or is in draft mode');
  }

  const studentEmail = (studentUser.email || '').toLowerCase().trim();
  const isMock = exam.isMockTest || exam.courseCode === 'MOCK-101';

  // 1. Enforce Course Section Enrollment
  if (!isMock) {
    let isEnrolled = false;

    if (exam.courseId) {
      const course = await dynamoService.getCourse(exam.courseId);
      if (course && Array.isArray(course.studentRoster)) {
        isEnrolled = course.studentRoster.some(
          (s) => (s.email || '').toLowerCase().trim() === studentEmail
        );
      }
    } else {
      const assigned = Array.isArray(exam.assignedStudentEmails) ? exam.assignedStudentEmails : [];
      isEnrolled = assigned.length === 0 || assigned.includes('*') || assigned.some((e) => e.toLowerCase().trim() === studentEmail);
    }

    if (!isEnrolled) {
      throw new Error(
        `Access denied: You are not enrolled in ${exam.courseCode || 'this course'} (Slot ${exam.slot || 'section'}). Contact your instructor.`
      );
    }
  }

  // 2. Enforce Scheduled Time Window
  const now = new Date();
  if (exam.startTime && new Date(exam.startTime) > now) {
    throw new Error(
      `This examination is scheduled to commence at ${new Date(exam.startTime).toLocaleString()}. You cannot access questions before the scheduled start time.`
    );
  }
  if (exam.endTime && new Date(exam.endTime) <= now) {
    throw new Error(
      `The closing deadline for this examination (${new Date(exam.endTime).toLocaleString()}) has passed.`
    );
  }

  const studentId = studentUser.id || studentUser._id || studentUser.studentId;

  // 3. Enforce Attempt Limits
  let studentAttempts = [];
  if (isDynamoDbMode()) {
    studentAttempts = await dynamoService.listStudentSessions(studentId);
  } else if (isMongoConnected()) {
    studentAttempts = await ExamAttempt.find({ student: studentId }).lean().exec();
  } else {
    studentAttempts = memoryAttempts.filter((a) => a.student.toString() === studentId.toString());
  }

  const examAttempts = studentAttempts.filter(
    (a) => (a.exam || a.examId || '').toString() === examId.toString()
  );

  const existingAttempt = examAttempts.find((a) => a.status === 'in_progress');
  if (existingAttempt) {
    const sanitized = sanitizeQuestionsForStudent(exam.questions);
    return {
      attempt: existingAttempt,
      exam: {
        ...exam,
        questions: sanitized,
      },
      questions: sanitized,
    };
  }

  const completedAttempts = examAttempts.filter(
    (a) => a.status === 'completed' || a.status === 'timed_out'
  );
  const maxAttempts = Number(exam.maxAttempts) || 1;
  if (completedAttempts.length >= maxAttempts) {
    throw new Error(`Maximum attempts (${maxAttempts}) reached for this examination.`);
  }

  const startTime = new Date();
  const deadlineTime = new Date(startTime.getTime() + exam.durationMinutes * 60 * 1000);

  // Initialize empty answers array
  const initialAnswers = (exam.questions || []).map((q, idx) => ({
    questionId: (q._id || q.questionId || q.id || `q_${idx}`).toString(),
    selectedOptionIndex: null,
    isMarkedForReview: false,
    updatedAt: new Date(),
  }));

  const attemptData = {
    student: studentId,
    studentId: studentId,
    studentName: studentUser.name,
    studentEmail: studentUser.email,
    studentRollNo: studentUser.studentId || 'N/A',
    exam: examId,
    examId: examId,
    examTitle: exam.title,
    courseCode: exam.courseCode,
    slot: exam.slot || 'A1',
    durationMinutes: exam.durationMinutes,
    startTime,
    deadlineTime,
    status: 'in_progress',
    answers: initialAnswers,
    totalMarks: exam.totalMarks,
    passingMarks: exam.passingMarks,
    riskScore: 0,
    riskLevel: 'LOW',
  };

  let newAttempt = null;
  if (isDynamoDbMode()) {
    const sId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    newAttempt = await dynamoService.putSession({
      ...attemptData,
      sessionId: sId,
      _id: sId,
    });
  } else if (isMongoConnected()) {
    newAttempt = await ExamAttempt.create(attemptData);
  } else {
    newAttempt = {
      _id: `attempt_${Date.now()}`,
      ...attemptData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryAttempts.push(newAttempt);
  }

  const sanitizedQuestions = sanitizeQuestionsForStudent(exam.questions);
  return {
    attempt: newAttempt,
    exam: {
      ...exam,
      questions: sanitizedQuestions,
    },
    questions: sanitizedQuestions,
  };
};

/**
 * Student: Auto-save single question answer
 */
export const saveStudentAnswer = async (attemptId, studentId, { questionId, selectedOptionIndex, isMarkedForReview }) => {
  let attempt = null;

  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findOne({ _id: attemptId, student: studentId }).exec();
  } else {
    attempt = memoryAttempts.find(
      (a) => a._id.toString() === attemptId.toString() && a.student.toString() === studentId.toString()
    );
  }

  if (!attempt) {
    throw new Error('Active exam attempt not found');
  }

  const attemptStudentId = (attempt.student || attempt.studentId || '').toString();
  if (studentId && attemptStudentId && attemptStudentId !== studentId.toString()) {
    throw new Error('Unauthorized attempt access');
  }

  if (attempt.status !== 'in_progress') {
    throw new Error('Cannot update answers for an examination that has already been submitted');
  }

  // Check deadline
  if (new Date() > new Date(attempt.deadlineTime)) {
    attempt.status = 'timed_out';
    if (isDynamoDbMode()) await dynamoService.putSession(attempt);
    else if (isMongoConnected()) await attempt.save();
    throw new Error('Examination duration has expired');
  }

  if (!Array.isArray(attempt.answers)) {
    attempt.answers = [];
  }

  const answerIndex = attempt.answers.findIndex(
    (a) => (a.questionId || a._id || '').toString() === questionId.toString()
  );

  if (answerIndex !== -1) {
    if (selectedOptionIndex !== undefined) {
      attempt.answers[answerIndex].selectedOptionIndex = selectedOptionIndex;
    }
    if (isMarkedForReview !== undefined) {
      attempt.answers[answerIndex].isMarkedForReview = isMarkedForReview;
    }
    attempt.answers[answerIndex].updatedAt = new Date().toISOString();
  } else {
    attempt.answers.push({
      questionId: questionId.toString(),
      selectedOptionIndex,
      isMarkedForReview: !!isMarkedForReview,
      updatedAt: new Date().toISOString(),
    });
  }

  if (isDynamoDbMode()) {
    await dynamoService.putSession(attempt);
  } else if (isMongoConnected()) {
    await attempt.save();
  }

  return {
    success: true,
    savedAt: new Date(),
    questionId,
    selectedOptionIndex,
    isMarkedForReview,
  };
};

/**
 * Student: Submit exam attempt, auto-grade, and sanitize results based on teacher visibility policy
 */
export const submitExamAttempt = async (attemptId, studentId, isTimeout = false) => {
  let attempt = null;

  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findOne({ _id: attemptId, student: studentId }).exec();
  } else {
    attempt = memoryAttempts.find(
      (a) => a._id.toString() === attemptId.toString() && a.student.toString() === studentId.toString()
    );
  }

  if (!attempt) {
    throw new Error('Exam attempt not found');
  }

  const attemptStudentId = (attempt.student || attempt.studentId || '').toString();
  if (studentId && attemptStudentId && attemptStudentId !== studentId.toString()) {
    throw new Error('Unauthorized attempt access');
  }

  const exam = await getExamById(attempt.exam || attempt.examId, false);
  if (!exam) {
    throw new Error('Associated examination record not found');
  }

  if (attempt.status !== 'completed' && attempt.status !== 'timed_out') {
    const endTime = new Date();
    let score = 0;
    const questionMap = new Map();
    (exam.questions || []).forEach((q) => questionMap.set((q._id || q.questionId || q.id).toString(), q));

    // Auto-grade each answer
    const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
    const gradedAnswers = answers.map((ans) => {
      const qId = (ans.questionId || ans._id || '').toString();
      const originalQuestion = questionMap.get(qId);
      if (!originalQuestion) return ans;

      const isCorrect =
        ans.selectedOptionIndex !== null &&
        Number(ans.selectedOptionIndex) === Number(originalQuestion.correctOptionIndex);

      const marksAwarded = isCorrect ? (originalQuestion.marks || 1) : 0;
      if (isCorrect) {
        score += marksAwarded;
      }

      return {
        ...(ans.toObject ? ans.toObject() : ans),
        isCorrect,
        marksAwarded,
      };
    });

    const totalMarks = exam.totalMarks || 1;
    const percentage = Math.round((score / totalMarks) * 100);
    const isPassed = score >= (exam.passingMarks || 0);

    attempt.endTime = endTime;
    attempt.status = isTimeout ? 'timed_out' : 'completed';
    attempt.answers = gradedAnswers;
    attempt.score = score;
    attempt.totalMarks = totalMarks;
    attempt.percentage = percentage;
    attempt.isPassed = isPassed;

    // Final Proctoring Summary generation (Section 39)
    attempt.proctoringSummary = generateProctoringSummary(attempt);

    if (isDynamoDbMode()) {
      await dynamoService.putSession(attempt);
    } else if (isMongoConnected()) {
      await attempt.save();
    }
  }

  // Sanitize return object according to teacher's results and answer review policy
  return sanitizeAttemptForStudent(attempt, exam);
};

/**
 * Student: Get all previous exam attempts (sanitized per teacher results policy)
 */
export const getStudentAttempts = async (studentId) => {
  let sessions = [];
  if (isDynamoDbMode()) {
    sessions = await dynamoService.listStudentSessions(studentId);
  } else if (isMongoConnected()) {
    sessions = await ExamAttempt.find({ student: studentId }).sort({ createdAt: -1 }).lean().exec();
  } else {
    sessions = memoryAttempts.filter((a) => a.student.toString() === studentId.toString());
  }

  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Sanitize each attempt using its associated exam's results policy
  const sanitizedAttempts = [];
  for (const s of sessions) {
    const exam = await getExamById(s.exam || s.examId, false);
    sanitizedAttempts.push(sanitizeAttemptForStudent(s, exam));
  }

  return sanitizedAttempts;
};

/**
 * Common: Get specific attempt by ID (students receive policy-sanitized data; teachers receive full forensic review)
 */
export const getAttemptById = async (attemptId, userId, role) => {
  let attempt = null;

  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findById(attemptId).lean().exec();
  } else {
    attempt = memoryAttempts.find((a) => a._id.toString() === attemptId.toString());
  }

  if (!attempt) return null;

  // Authorization check: student can only view their own attempt; teacher can view if creator
  const attemptStudentId = (attempt.student || attempt.studentId || '').toString();
  if (role === 'student' && attemptStudentId !== userId.toString()) {
    throw new Error('Access denied: You cannot view another student attempt');
  }

  const exam = await getExamById(attempt.exam || attempt.examId, false);

  if (role === 'student') {
    return sanitizeAttemptForStudent(attempt, exam);
  }

  return attempt;
};

/**
 * Teacher: Update independent Results and Answer Review visibility policy
 */
export const updateExamResultsPolicy = async (examId, policyData, teacherId) => {
  const current = await getExamById(examId, false);
  if (!current) {
    throw new Error('Examination not found');
  }
  if (teacherId && current.creator && current.creator.toString() !== teacherId.toString()) {
    throw new Error('Unauthorized to modify this examination policy');
  }

  const existingPolicy = current.resultsPolicy || {};
  const updatedPolicy = {
    releaseMode: policyData.releaseMode || existingPolicy.releaseMode || 'immediate',
    releaseDate: policyData.releaseDate !== undefined ? policyData.releaseDate : existingPolicy.releaseDate,
    showScore: policyData.showScore !== undefined ? !!policyData.showScore : (existingPolicy.showScore !== false),
    showCorrectAnswers: policyData.showCorrectAnswers !== undefined ? !!policyData.showCorrectAnswers : (existingPolicy.showCorrectAnswers !== false),
    allowReview: policyData.allowReview !== undefined ? !!policyData.allowReview : (existingPolicy.allowReview !== false),
    showExplanations: policyData.showExplanations !== undefined ? !!policyData.showExplanations : (existingPolicy.showExplanations !== false),
    isResultsReleased: policyData.isResultsReleased !== undefined
      ? !!policyData.isResultsReleased
      : (policyData.releaseMode === 'immediate' || existingPolicy.isResultsReleased),
  };

  return await updateExam(examId, { resultsPolicy: updatedPolicy }, teacherId);
};


/**
 * Teacher: Get exam results & student submissions analytics
 */
export const getExamResultsForTeacher = async (examId, teacherId) => {
  const exam = await getExamById(examId, false);
  if (!exam) {
    throw new Error('Exam not found');
  }

  let attempts = [];
  if (isDynamoDbMode()) {
    attempts = await dynamoService.listSessions(examId);
    attempts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (isMongoConnected()) {
    attempts = await ExamAttempt.find({ exam: examId }).sort({ createdAt: -1 }).lean().exec();
  } else {
    attempts = memoryAttempts
      .filter((a) => a.exam.toString() === examId.toString())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const completedAttempts = attempts.filter((a) => a.status === 'completed' || a.status === 'timed_out');
  const scores = completedAttempts.map((a) => a.score);

  const totalCandidates = attempts.length;
  const passedCandidates = completedAttempts.filter((a) => a.isPassed).length;
  const averageScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
  const passPercentage = completedAttempts.length > 0 ? Math.round((passedCandidates / completedAttempts.length) * 100) : 0;

  return {
    exam: {
      _id: exam._id || exam.examId,
      title: exam.title,
      courseCode: exam.courseCode,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      questionCount: (exam.questions || []).length,
    },
    analytics: {
      totalCandidates,
      completedCount: completedAttempts.length,
      activeCount: attempts.filter((a) => a.status === 'in_progress').length,
      passedCandidates,
      passPercentage,
      averageScore,
      highestScore,
      lowestScore,
    },
    attempts,
  };
};

/**
 * Teacher: Get all candidate attempts across all supervised exams (with forensic evidence)
 */
export const getAllTeacherAttempts = async (teacherId) => {
  let exams = [];
  if (isDynamoDbMode()) {
    exams = await dynamoService.listExams(teacherId);
  } else if (isMongoConnected()) {
    exams = await Exam.find({}).lean().exec();
  } else {
    exams = memoryExams;
  }

  const examMap = new Map();
  exams.forEach((e) => examMap.set((e._id || e.examId).toString(), e));

  let attempts = [];
  if (isDynamoDbMode()) {
    for (const e of exams) {
      const eId = (e._id || e.examId).toString();
      const sessList = await dynamoService.listSessions(eId);
      attempts.push(...sessList);
    }
    attempts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (isMongoConnected()) {
    attempts = await ExamAttempt.find({}).sort({ createdAt: -1 }).lean().exec();
  } else {
    attempts = [...memoryAttempts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  return attempts.map((att) => {
    const matchedExam = examMap.get((att.exam || '').toString());
    const events = Array.isArray(att.proctoringEvents) ? att.proctoringEvents : [];
    const phoneCount = events.filter((e) => e.eventType === 'PHONE_DETECTED').length;
    const multiFaceCount = events.filter((e) => e.eventType === 'MULTIPLE_FACES').length;
    const tabCount = att.tabSwitchCount !== undefined ? att.tabSwitchCount : events.filter((e) => e.eventType === 'TAB_SWITCH').length;

    return {
      _id: att._id,
      student: att.student,
      studentName: att.studentName || 'Aarav Patel',
      studentEmail: att.studentEmail || 'student@adaptive.edu',
      studentRollNo: att.studentRollNo || 'CS-2024-042',
      exam: att.exam,
      examTitle: att.examTitle || matchedExam?.title || 'Examination',
      courseCode: att.courseCode || matchedExam?.courseCode || 'MOCK-101',
      status: att.status || 'completed',
      score: att.score !== undefined && att.score !== null ? att.score : 0,
      totalMarks: att.totalMarks || matchedExam?.totalMarks || 20,
      passingMarks: att.passingMarks || matchedExam?.passingMarks || 10,
      percentage: att.percentage !== undefined && att.percentage !== null ? att.percentage : 0,
      isPassed: att.isPassed !== undefined ? att.isPassed : (att.score >= (att.passingMarks || 10)),
      riskScore: att.riskScore || 0,
      riskLevel: att.riskLevel || 'LOW',
      tabSwitchCount: tabCount,
      fullscreenExitCount: att.fullscreenExitCount || 0,
      faceAbsenceCount: att.faceAbsenceCount || 0,
      phoneDetectedCount: phoneCount,
      multiFaceCount: multiFaceCount,
      proctoringEvents: events,
      answers: att.answers || [],
      startTime: att.startTime,
      endTime: att.endTime,
      createdAt: att.createdAt || new Date(),
    };
  });
};

/**
 * Student: Record real-time proctoring telemetry event & adaptively compute risk score (Sections 30-42)
 */
export const recordProctoringEvent = async (
  attemptId,
  studentId,
  {
    eventType,
    details = '',
    severity = 'warning',
    confidence = null,
    snapshotUrl = null,
    snapshotBase64 = null,
    simulateAnomaly = null,
    simulatePhone = false,
  }
) => {
  let attempt = null;

  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findOne({ _id: attemptId, student: studentId }).exec();
  } else {
    attempt = memoryAttempts.find(
      (a) => (a._id || a.sessionId).toString() === attemptId.toString() && (a.student || a.studentId).toString() === studentId.toString()
    );
  }

  if (!attempt) {
    throw new Error('Active exam attempt not found');
  }

  if (!attempt.proctoringEvents) {
    attempt.proctoringEvents = [];
  }

  // AWS S3: Upload snapshot evidence if image data is attached
  let resolvedSnapshotUrl = snapshotUrl;
  let evidenceS3Key = null;
  let rekognitionMeta = null;
  let evaluatedConfidence = confidence !== null ? Number(confidence) : null;

  if (snapshotBase64) {
    try {
      const s3Key = `evidence/${attemptId}/${Date.now()}_${eventType.toLowerCase()}.jpg`;
      const s3Result = await uploadEvidenceSnapshot(snapshotBase64, s3Key);
      evidenceS3Key = s3Key;
      resolvedSnapshotUrl = s3Result.url;

      // Section 34: Phone / Object detection via Rekognition DetectLabels
      if (eventType === 'PHONE_DETECTED' || simulatePhone || simulateAnomaly === 'PHONE_DETECTED') {
        eventType = 'PHONE_DETECTED';
        evaluatedConfidence = evaluatedConfidence || 95;
        severity = 'critical';
        const labelResult = await detectLabels(snapshotBase64, {
          simulatePhone: simulatePhone || simulateAnomaly === 'PHONE_DETECTED',
        });
        if (labelResult.isPhoneDetected) {
          evaluatedConfidence = labelResult.confidence || evaluatedConfidence;
          details = (details ? details + ' | ' : '') + `Rekognition confirmed mobile device (${evaluatedConfidence}%)`;
          rekognitionMeta = {
            type: 'PHONE_DETECTED',
            confidence: evaluatedConfidence,
            phoneLabels: labelResult.phoneLabels,
          };
        } else {
          details = details || 'Automatic AI Vision: Mobile phone detected in candidate viewport';
        }
      } else {
        // AWS Rekognition: Face detection and anomaly scanning
        const rekResult = await detectFaces(snapshotBase64, { simulateAnomaly });
        rekognitionMeta = {
          faceCount: rekResult.faceCount,
          anomaly: rekResult.anomaly,
          mode: rekResult.mode,
        };

        if (eventType === 'MULTIPLE_FACES' || rekResult.anomaly === 'MULTIPLE_FACES_DETECTED' || (rekResult.faceCount || 0) > 1) {
          eventType = 'MULTIPLE_FACES';
          evaluatedConfidence = evaluatedConfidence || 95;
          details = details || 'Amazon Rekognition / AI Vision flagged multiple faces in webcam arena';
        } else if (eventType === 'NO_FACE_DETECTED' || rekResult.anomaly === 'NO_FACE_DETECTED' || rekResult.faceCount === 0) {
          eventType = 'NO_FACE_DETECTED';
          evaluatedConfidence = evaluatedConfidence || 98;
        } else if (rekResult.anomaly === 'GAZE_LOOKING_AWAY') {
          eventType = 'LOOKING_AWAY';
          evaluatedConfidence = evaluatedConfidence || 88;
        }
      }
    } catch (awsErr) {
      console.warn('AWS S3/Rekognition processing notice:', awsErr.message);
    }
  }

  // Evaluate risk score adaptively using dedicated Proctoring Risk Engine (Sections 30-35)
  const riskEval = evaluateProctoringRisk(attempt, {
    eventType,
    details,
    severity,
    confidence: evaluatedConfidence,
    evidenceS3Key,
    snapshotUrl: resolvedSnapshotUrl,
  });

  // Amazon SNS: Check alert escalation rules and prevent duplicate spam (Section 37)
  const alertCheck = evaluateSnsAlertTrigger(attempt, attempt.riskScore, eventType);
  if (alertCheck.shouldAlert) {
    sendHighRiskProctorAlert({
      studentName: attempt.studentName || 'Candidate',
      examTitle: attempt.examTitle || 'Examination',
      riskScore: attempt.riskScore,
      breachType: eventType,
      details: `${alertCheck.reason} - ${details}`,
    }).catch((err) => console.warn('SNS alert dispatch notice:', err.message));

    attempt.snsAlertsSent = attempt.snsAlertsSent || [];
    attempt.snsAlertsSent.push({
      alertType: alertCheck.alertLevel,
      riskScore: attempt.riskScore,
      sentAt: new Date(),
    });
  }

  // AWS Lambda: Async serverless evaluation of the incident
  invokeIncidentEvaluatorLambda({
    attemptId,
    eventType,
    details,
    currentScore: attempt.riskScore,
    snapshotS3Key: evidenceS3Key || resolvedSnapshotUrl,
  }).catch((err) => console.warn('Lambda evaluator notice:', err.message));

  const newEvent = {
    _id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    eventType,
    timestamp: new Date(),
    confidence: evaluatedConfidence,
    severity: riskEval.severity,
    riskContribution: riskEval.riskDelta,
    riskDelta: riskEval.riskDelta,
    riskScoreAfter: attempt.riskScore,
    details: riskEval.finalDetails || details || `Proctoring event: ${eventType}`,
    evidenceS3Key,
    snapshotUrl: resolvedSnapshotUrl || null,
  };

  attempt.proctoringEvents.push(newEvent);

  if (isDynamoDbMode()) {
    await dynamoService.putFlaggedEvent({
      sessionId: attemptId,
      timestamp: newEvent.timestamp,
      eventId: newEvent._id,
      eventType: newEvent.eventType,
      severity: newEvent.severity,
      details: newEvent.details,
      confidence: newEvent.confidence,
      riskContribution: newEvent.riskContribution,
      riskScoreAfter: newEvent.riskScoreAfter,
      evidenceS3Key: newEvent.evidenceS3Key,
      snapshotUrl: newEvent.snapshotUrl,
    });
    await dynamoService.putRiskScoreRecord({
      sessionId: attemptId,
      timestamp: newEvent.timestamp,
      riskScore: attempt.riskScore || 0,
      riskLevel: attempt.riskLevel || 'LOW',
      strikes: attempt.strikes || 0,
      escalated: Boolean(alertCheck.shouldAlert),
      reasons: [newEvent.details],
    });
    await dynamoService.putSession(attempt);
  } else if (isMongoConnected()) {
    await attempt.save();
  }

  return {
    success: true,
    riskScore: attempt.riskScore,
    riskLevel: attempt.riskLevel,
    event: newEvent,
    totalEvents: attempt.proctoringEvents.length,
    tabSwitchCount: attempt.tabSwitchCount || 0,
    fullscreenExitCount: attempt.fullscreenExitCount || 0,
    faceAbsenceCount: attempt.faceAbsenceCount || 0,
    multipleFaceCount: attempt.multipleFaceCount || 0,
    phoneDetectionCount: attempt.phoneDetectionCount || 0,
    audioAnomalyCount: attempt.audioAnomalyCount || 0,
    recommendedIntervalMs: riskEval.recommendedIntervalMs,
    awsTelemetry: {
      s3SnapshotStored: !!resolvedSnapshotUrl,
      evidenceS3Key,
      rekognitionAnalyzed: !!rekognitionMeta,
      rekognitionDetails: rekognitionMeta,
      snsAlertTriggered: !!alertCheck.shouldAlert,
      alertReason: alertCheck.reason,
    },
  };
};

/**
 * Unified Proctoring Frame Analysis Pipeline
 * - Real-time candidate identity verification via CompareFaces
 * - Accurate face absence detection with Grace (5s), Warning (10s), and Critical (30s) tiers
 * - Multi-person detection with temporal confirmation
 * - Mobile phone / device detection with label and confidence inspection
 * - Centralized backend risk engine computation and SNS alerting
 */
export const analyzeProctoringFrame = async (
  attemptId,
  studentId,
  {
    imageBase64,
    timestamp = Date.now(),
    isSessionStart = false,
    clientMetrics = {},
    clientPhoneDetected = false,
    clientPhoneConfidence = 0,
    simulateAnomaly = null,
    simulatePhone = false,
  }
) => {
  let attempt = null;
  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findOne({ _id: attemptId, student: studentId }).exec();
  } else {
    attempt = memoryAttempts.find(
      (a) => (a._id || a.sessionId).toString() === attemptId.toString() && (a.student || a.studentId).toString() === studentId.toString()
    );
  }

  if (!attempt) {
    throw new Error('Active exam attempt not found or unauthorized');
  }

  if (!attempt.proctoringEvents) {
    attempt.proctoringEvents = [];
  }

  const now = Number(timestamp) || Date.now();
  let candidateIdentityStatus = attempt.identityVerificationStatus || 'IDENTITY_UNAVAILABLE';
  let candidateIdentitySimilarity = attempt.identitySimilarity || 0;
  let identityVerifiedAt = attempt.identityVerifiedAt || null;

  // 1. Candidate Identity Verification (Session Start or Initial Check)
  if ((isSessionStart || !attempt.identityVerificationStatus) && imageBase64) {
    try {
      const refData = await getStudentReferenceImage(studentId);
      if (!refData || !refData.hasReferenceImage) {
        candidateIdentityStatus = 'IDENTITY_UNAVAILABLE';
        candidateIdentitySimilarity = 0;
      } else {
        const refPhoto = refData.referencePhotoBase64 || refData.referencePhotoKey || refData.referencePhotoUrl;
        const compResult = await compareFaces(refPhoto, imageBase64, 80);
        candidateIdentityStatus = compResult.outcome;
        candidateIdentitySimilarity = compResult.similarity || 0;
        identityVerifiedAt = new Date().toISOString();

        if (compResult.outcome === 'IDENTITY_MISMATCH') {
          const s3Key = `flagged/${attemptId}/${Date.now()}_identity_mismatch.jpg`;
          const s3Upload = await uploadEvidenceSnapshot(imageBase64, s3Key).catch(() => null);
          const riskEval = evaluateProctoringRisk(attempt, {
            eventType: 'IDENTITY_MISMATCH',
            details: `Biometric mismatch flagged: ${compResult.similarity}% similarity to enrolled reference photo`,
            severity: 'critical',
            confidence: compResult.confidence || 95,
            evidenceS3Key: s3Key,
            snapshotUrl: s3Upload?.url,
          });

          attempt.proctoringEvents.push({
            eventType: 'IDENTITY_MISMATCH',
            timestamp: new Date(),
            confidence: compResult.confidence || 95,
            severity: 'critical',
            riskContribution: 30,
            riskDelta: riskEval.riskDelta,
            riskScoreAfter: attempt.riskScore,
            details: `Biometric identity mismatch (Similarity: ${compResult.similarity}%)`,
            evidenceS3Key: s3Key,
            snapshotUrl: s3Upload?.url || null,
          });
        }
      }
      attempt.identityVerificationStatus = candidateIdentityStatus;
      attempt.identitySimilarity = candidateIdentitySimilarity;
      attempt.identityVerifiedAt = identityVerifiedAt;
    } catch (idErr) {
      console.warn('Identity verification error:', idErr.message);
      candidateIdentityStatus = 'IDENTITY_UNAVAILABLE';
    }
  }

  // 2. Face Detection & Analysis
  let faceResult = null;
  let faceStatus = 'SINGLE_FACE_DETECTED';
  let faceCount = 1;
  let faceConfidence = 99;
  let isSustainedAbsence = false;
  let absenceDurationMs = 0;

  if (imageBase64) {
    faceResult = await detectFaces(imageBase64, { simulateAnomaly });
  }

  if (!faceResult || faceResult.status === 'ANALYSIS_UNAVAILABLE') {
    faceStatus = 'ANALYSIS_UNAVAILABLE';
    faceCount = 0;
  } else if (faceResult.status === 'NO_FACE_DETECTED') {
    faceStatus = 'NO_FACE_DETECTED';
    faceCount = 0;
    faceConfidence = 95;

    // Temporal Absence Tracking
    if (!attempt.absenceStartTime) {
      attempt.absenceStartTime = now;
    }
    absenceDurationMs = now - attempt.absenceStartTime;

    if (absenceDurationMs >= ABSENCE_THRESHOLDS.CRITICAL_MS) {
      isSustainedAbsence = true;
      if (!attempt.isAbsenceCriticalRecorded) {
        attempt.isAbsenceCriticalRecorded = true;
        const s3Key = `flagged/${attemptId}/${Date.now()}_sustained_absence.jpg`;
        const s3Upload = await uploadEvidenceSnapshot(imageBase64, s3Key).catch(() => null);

        const riskEval = evaluateProctoringRisk(attempt, {
          eventType: 'SUSTAINED_ABSENCE_CRITICAL',
          details: `Candidate absent from camera viewport for ${Math.round(absenceDurationMs / 1000)}s (exceeded 30s threshold)`,
          severity: 'critical',
          confidence: 96,
          evidenceS3Key: s3Key,
          snapshotUrl: s3Upload?.url,
        });

        attempt.proctoringEvents.push({
          eventType: 'SUSTAINED_ABSENCE_CRITICAL',
          timestamp: new Date(),
          confidence: 96,
          severity: 'critical',
          riskContribution: 10,
          riskDelta: riskEval.riskDelta,
          riskScoreAfter: attempt.riskScore,
          details: `Sustained candidate absence confirmed (${Math.round(absenceDurationMs / 1000)}s)`,
          evidenceS3Key: s3Key,
          snapshotUrl: s3Upload?.url || null,
        });
      }
    } else if (absenceDurationMs >= ABSENCE_THRESHOLDS.WARNING_MS) {
      if (!attempt.isAbsenceWarningRecorded) {
        attempt.isAbsenceWarningRecorded = true;
        attempt.proctoringEvents.push({
          eventType: 'SUSTAINED_ABSENCE_WARNING',
          timestamp: new Date(),
          confidence: 95,
          severity: 'warning',
          riskContribution: 0,
          riskDelta: 0,
          riskScoreAfter: attempt.riskScore,
          details: `Candidate not visible in camera viewport for ${Math.round(absenceDurationMs / 1000)}s`,
        });
      }
    }
  } else if (faceResult.status === 'SINGLE_FACE_DETECTED') {
    faceStatus = 'SINGLE_FACE_DETECTED';
    faceCount = 1;
    faceConfidence = faceResult.faces?.[0]?.confidence || 99;

    // Reset absence state upon candidate return
    if (attempt.absenceStartTime) {
      attempt.absenceStartTime = null;
      attempt.isAbsenceWarningRecorded = false;
      attempt.isAbsenceCriticalRecorded = false;
    }
    attempt.lastFaceDetectedTimestamp = now;

    // Check gaze deviation
    if (faceResult.anomaly === 'GAZE_LOOKING_AWAY') {
      attempt.consecutiveLookingAway = (attempt.consecutiveLookingAway || 0) + 1;
      if (attempt.consecutiveLookingAway >= 2 && !attempt.isLookingAwayReported) {
        attempt.isLookingAwayReported = true;
        const riskEval = evaluateProctoringRisk(attempt, {
          eventType: 'LOOKING_AWAY',
          details: 'Continuous gaze looking away from examination monitor',
          severity: 'warning',
          confidence: 88,
        });
        attempt.proctoringEvents.push({
          eventType: 'LOOKING_AWAY',
          timestamp: new Date(),
          confidence: 88,
          severity: 'warning',
          riskContribution: 5,
          riskDelta: riskEval.riskDelta,
          riskScoreAfter: attempt.riskScore,
          details: 'Candidate repeatedly looking away from monitor',
        });
      }
    } else {
      attempt.consecutiveLookingAway = 0;
      attempt.isLookingAwayReported = false;
    }
  } else if (faceResult.status === 'MULTIPLE_FACES') {
    faceStatus = 'MULTIPLE_FACES';
    faceCount = faceResult.faceCount || 2;
    faceConfidence = faceResult.faces?.[0]?.confidence || 94;

    attempt.consecutiveMultiFace = (attempt.consecutiveMultiFace || 0) + 1;
    if (attempt.consecutiveMultiFace >= 2 && !attempt.isMultiFaceReported) {
      attempt.isMultiFaceReported = true;
      const s3Key = `flagged/${attemptId}/${Date.now()}_multiple_faces.jpg`;
      const s3Upload = await uploadEvidenceSnapshot(imageBase64, s3Key).catch(() => null);

      const riskEval = evaluateProctoringRisk(attempt, {
        eventType: 'MULTIPLE_FACES',
        details: `Multiple individuals identified in webcam view (${faceCount} faces detected)`,
        severity: 'critical',
        confidence: faceConfidence,
        evidenceS3Key: s3Key,
        snapshotUrl: s3Upload?.url,
      });

      attempt.proctoringEvents.push({
        eventType: 'MULTIPLE_FACES',
        timestamp: new Date(),
        confidence: faceConfidence,
        severity: 'critical',
        riskContribution: 20,
        riskDelta: riskEval.riskDelta,
        riskScoreAfter: attempt.riskScore,
        details: `Multiple faces detected in examination viewport (${faceCount} people)`,
        evidenceS3Key: s3Key,
        snapshotUrl: s3Upload?.url || null,
      });
    }
  }

  // 3. Phone / Mobile Device Detection
  let phoneDetected = false;
  let phoneConfidence = 0;
  let phoneLabel = null;
  let phoneStatus = 'NOT_DETECTED';

  if (imageBase64) {
    const labelResult = await detectLabels(imageBase64, { simulatePhone });
    const isAwsPhone = labelResult.isPhoneDetected || labelResult.status === 'DETECTED' || labelResult.phoneStatus === 'PHONE_DETECTED';
    const isClientPhone = clientPhoneDetected && (clientPhoneConfidence >= 45);

    if (isAwsPhone) {
      phoneDetected = true;
      phoneConfidence = labelResult.confidence || 95;
      phoneLabel = labelResult.detectedLabel || 'Cell Phone';
      phoneStatus = 'PHONE_DETECTED';
    } else if (isClientPhone) {
      phoneDetected = true;
      phoneConfidence = clientPhoneConfidence;
      phoneLabel = 'Mobile Phone (AI Vision)';
      phoneStatus = 'PHONE_DETECTED';
    } else {
      phoneStatus = 'NOT_DETECTED';
    }
  }

  if (phoneDetected) {
    if (!attempt.isPhoneActiveReported) {
      attempt.isPhoneActiveReported = true;
      const s3Key = `flagged/${attemptId}/${Date.now()}_phone_detected.jpg`;
      const s3Upload = await uploadEvidenceSnapshot(imageBase64, s3Key).catch(() => null);

      const riskEval = evaluateProctoringRisk(attempt, {
        eventType: 'PHONE_DETECTED',
        details: `Prohibited mobile device identified (${phoneLabel}, ${phoneConfidence}% confidence)`,
        severity: 'critical',
        confidence: phoneConfidence,
        evidenceS3Key: s3Key,
        snapshotUrl: s3Upload?.url,
      });

      attempt.proctoringEvents.push({
        eventType: 'PHONE_DETECTED',
        timestamp: new Date(),
        confidence: phoneConfidence,
        severity: 'critical',
        riskContribution: 25,
        riskDelta: riskEval.riskDelta,
        riskScoreAfter: attempt.riskScore,
        details: `Prohibited mobile device confirmed in camera viewport (${phoneConfidence}% confidence)`,
        evidenceS3Key: s3Key,
        snapshotUrl: s3Upload?.url || null,
      });
    }
  } else {
    // Reset phone active state once removed from camera feed
    attempt.isPhoneActiveReported = false;
  }

  // 4. Tab Switches & Fullscreen Exits
  if (clientMetrics.tabSwitchCount && clientMetrics.tabSwitchCount > (attempt.tabSwitchCount || 0)) {
    const delta = clientMetrics.tabSwitchCount - (attempt.tabSwitchCount || 0);
    for (let i = 0; i < delta; i++) {
      const riskEval = evaluateProctoringRisk(attempt, {
        eventType: 'TAB_SWITCH',
        details: 'Candidate navigated away from examination browser window',
        severity: 'warning',
      });
      attempt.proctoringEvents.push({
        eventType: 'TAB_SWITCH',
        timestamp: new Date(),
        severity: 'warning',
        riskContribution: 5,
        riskDelta: riskEval.riskDelta,
        riskScoreAfter: attempt.riskScore,
        details: 'Candidate switched tabs or blurred examination window',
      });
    }
    attempt.tabSwitchCount = clientMetrics.tabSwitchCount;
  }

  // 5. Check SNS Alert Escalation
  let frameBreachEvent = null;
  let breachDetails = '';
  if (phoneDetected) {
    frameBreachEvent = 'PHONE_DETECTED';
    breachDetails = `Prohibited mobile device identified (${phoneLabel || 'Phone'}, ${phoneConfidence}% confidence)`;
  } else if (faceStatus === 'MULTIPLE_FACES' || faceCount > 1) {
    frameBreachEvent = 'MULTIPLE_FACES';
    breachDetails = `Multiple faces (${faceCount}) identified in camera feed`;
  } else if (isSustainedAbsence) {
    frameBreachEvent = 'SUSTAINED_ABSENCE';
    breachDetails = `Candidate absence confirmed (${Math.round(absenceDurationMs / 1000)}s)`;
  } else if (faceStatus === 'FACE_MISMATCH') {
    frameBreachEvent = 'IDENTITY_MISMATCH';
    breachDetails = 'Facial biometric mismatch detected against baseline reference';
  } else if (clientMetrics && clientMetrics.tabSwitchCount > (attempt.tabSwitchCount || 0)) {
    frameBreachEvent = 'TAB_SWITCH';
    breachDetails = `Browser window blur or tab switch detected (count: ${clientMetrics.tabSwitchCount})`;
  }

  const alertCheck = evaluateSnsAlertTrigger(
    attempt,
    attempt.riskScore || 0,
    frameBreachEvent || 'FRAME_EVALUATION'
  );

  if (alertCheck.shouldAlert) {
    sendHighRiskProctorAlert({
      studentName: attempt.studentName || 'Candidate',
      examTitle: attempt.examTitle || 'Examination',
      riskScore: attempt.riskScore,
      breachType: frameBreachEvent || 'HIGH_RISK_ESCALATION',
      details: breachDetails ? `${alertCheck.reason} - ${breachDetails}` : alertCheck.reason,
    }).catch((err) => console.warn('[Amazon SNS Publish Warning]:', err.message));
  }

  // Save latest proctoring snapshot state
  attempt.latestProctoringState = {
    updatedAt: new Date().toISOString(),
    faceStatus,
    faceCount,
    faceConfidence,
    absenceDurationMs,
    isSustainedAbsence,
    phoneStatus,
    phoneDetected,
    phoneConfidence,
    phoneLabel,
    identityStatus: candidateIdentityStatus,
    identitySimilarity: candidateIdentitySimilarity,
    identityVerifiedAt,
    riskScore: attempt.riskScore || 0,
    riskLevel: attempt.riskLevel || 'LOW',
    aiAnalysisMode: faceResult?.mode || 'aws-live',
    aiAnalysisStatus: faceStatus === 'ANALYSIS_UNAVAILABLE' ? 'UNAVAILABLE' : 'CONNECTED',
    recommendedIntervalMs: getRecommendedIntervalMs(attempt.riskScore || 0),
  };

  if (isDynamoDbMode()) {
    await dynamoService.putSession(attempt);
  } else if (isMongoConnected()) {
    await attempt.save();
  }

  return {
    success: true,
    analysis: {
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      camera: 'ACTIVE',
      mode: faceResult?.mode || 'aws-live',
      aiAnalysisStatus: faceStatus === 'ANALYSIS_UNAVAILABLE' ? 'UNAVAILABLE' : 'CONNECTED',
      face: {
        status: faceStatus,
        count: faceCount,
        confidence: faceConfidence,
        absenceDurationMs,
        isSustainedAbsence,
      },
      phone: {
        status: phoneStatus,
        detected: phoneDetected,
        confidence: phoneConfidence,
        label: phoneLabel,
      },
      identity: {
        status: candidateIdentityStatus,
        similarity: candidateIdentitySimilarity,
        verifiedAt: identityVerifiedAt,
      },
      risk: {
        score: attempt.riskScore || 0,
        level: attempt.riskLevel || 'LOW',
        recommendedIntervalMs: getRecommendedIntervalMs(attempt.riskScore || 0),
      },
    },
  };
};

export const getAttemptProctoringStatus = async (attemptId, userId) => {
  let attempt = null;
  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findById(attemptId).lean().exec();
  } else {
    attempt = memoryAttempts.find((a) => (a._id || a.sessionId).toString() === attemptId.toString());
  }

  if (!attempt) {
    throw new Error('Exam attempt not found');
  }

  const attemptStudentId = (attempt.student || attempt.studentId || '').toString();
  if (userId && attemptStudentId && attemptStudentId !== userId.toString()) {
    throw new Error('Access denied');
  }

  return {
    success: true,
    latestState: attempt.latestProctoringState || {
      riskScore: attempt.riskScore || 0,
      riskLevel: attempt.riskLevel || 'LOW',
      faceStatus: 'SINGLE_FACE_DETECTED',
      faceCount: 1,
      phoneStatus: 'NOT_DETECTED',
      identityStatus: attempt.identityVerificationStatus || 'IDENTITY_UNAVAILABLE',
      recommendedIntervalMs: getRecommendedIntervalMs(attempt.riskScore || 0),
    },
  };
};

/**
 * Get proctoring telemetry audit log for an attempt (Teacher or Student)
 * Includes chronological timeline, presigned S3 evidence URLs, and summary (Sections 39 & 40)
 */
export const getAttemptProctoringEvents = async (attemptId, user) => {
  let attempt = null;

  if (isDynamoDbMode()) {
    attempt = await dynamoService.getSession(attemptId);
  } else if (isMongoConnected()) {
    attempt = await ExamAttempt.findById(attemptId).lean().exec();
  } else {
    attempt = memoryAttempts.find((a) => (a._id || a.sessionId).toString() === attemptId.toString());
  }

  if (!attempt) {
    throw new Error('Exam attempt not found');
  }

  const attemptStudentId = (attempt.student || attempt.studentId || '').toString();
  const currentUserId = (user.id || user._id || user.studentId || '').toString();
  if (user.role === 'student' && attemptStudentId && attemptStudentId !== currentUserId) {
    throw new Error('Access denied: You cannot view this attempt telemetry');
  }

  // If in DynamoDB mode, query FlaggedEvents in guaranteed chronological order
  if (isDynamoDbMode()) {
    const tableEvents = await dynamoService.getFlaggedEventsBySession(attemptId);
    if (tableEvents && tableEvents.length > 0) {
      attempt.proctoringEvents = tableEvents;
    }
  }

  // Section 40: Attach short-lived presigned URLs for secure private S3 evidence viewing
  const timelineEvents = await Promise.all(
    (attempt.proctoringEvents || []).map(async (e) => {
      let presignedUrl = e.snapshotUrl;
      const keyOrUrl = e.evidenceS3Key || e.snapshotUrl;
      if (keyOrUrl) {
        try {
          const res = await getPresignedDownloadUrl(keyOrUrl);
          presignedUrl = res.downloadUrl;
        } catch (err) {
          presignedUrl = e.snapshotUrl;
        }
      }
      return {
        ...e,
        presignedSnapshotUrl: presignedUrl,
      };
    })
  );

  // Section 39: Proctoring Summary
  const proctoringSummary = attempt.proctoringSummary || generateProctoringSummary(attempt);

  return {
    attemptId: attempt._id,
    studentName: attempt.studentName,
    studentEmail: attempt.studentEmail,
    studentRollNo: attempt.studentRollNo,
    examTitle: attempt.examTitle,
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    percentage: attempt.percentage,
    isPassed: attempt.isPassed,
    riskScore: attempt.riskScore || 0,
    riskLevel: attempt.riskLevel || 'LOW',
    tabSwitchCount: attempt.tabSwitchCount || 0,
    fullscreenExitCount: attempt.fullscreenExitCount || 0,
    faceAbsenceCount: attempt.faceAbsenceCount || 0,
    multipleFaceCount: attempt.multipleFaceCount || 0,
    phoneDetectionCount: attempt.phoneDetectionCount || 0,
    lookingAwayCount: attempt.lookingAwayCount || 0,
    identityMismatchCount: attempt.identityMismatchCount || 0,
    events: timelineEvents,
    proctoringSummary,
  };
};

