import * as examService from '../services/exam.service.js';

// ==========================================
// TEACHER CONTROLLERS
// ==========================================

const parseStudentEmails = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((e) => String(e).trim().toLowerCase()).filter((e) => e.length > 0 && e.includes('@'));
  }
  if (typeof input === 'string') {
    return input
      .split(/[,;\n\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes('@'));
  }
  return [];
};

export const createExam = async (req, res, next) => {
  try {
    const {
      title,
      description,
      courseId,
      courseCode,
      slot,
      instructions,
      startTime,
      endTime,
      durationMinutes,
      maxAttempts,
      passingMarks,
      questions,
      proctoringSettings,
      creatorEmail,
      status,
      assignedStudentEmails,
      resultsPolicy,
    } = req.body;

    if (!title || (!courseCode && !courseId) || !durationMinutes) {
      return res.status(400).json({
        success: false,
        error: { message: 'Title, course assignment, and duration in minutes are required.' },
      });
    }

    const exam = await examService.createExam(
      {
        title,
        description,
        courseId: courseId || null,
        courseCode: courseCode || 'GENERAL-101',
        slot: slot || 'A1',
        instructions: instructions || '',
        startTime: startTime || null,
        endTime: endTime || null,
        durationMinutes: Number(durationMinutes),
        maxAttempts: Number(maxAttempts) || 1,
        passingMarks: Number(passingMarks) || 0,
        questions: questions || [],
        proctoringSettings: proctoringSettings || {},
        creatorEmail: creatorEmail ? creatorEmail.trim().toLowerCase() : undefined,
        assignedStudentEmails: parseStudentEmails(assignedStudentEmails),
        status: status || 'draft',
        resultsPolicy: resultsPolicy || undefined,
      },
      req.user
    );

    res.status(201).json({
      success: true,
      message: 'Examination created successfully.',
      data: { exam },
    });
  } catch (error) {
    next(error);
  }
};

export const getTeacherExams = async (req, res, next) => {
  try {
    const teacherId = req.user.id || req.user._id;
    const exams = await examService.getTeacherExams(teacherId);

    res.status(200).json({
      success: true,
      data: { exams },
    });
  } catch (error) {
    next(error);
  }
};

export const getExamDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isTeacher = req.user.role === 'teacher';
    const exam = await examService.getExamById(id, !isTeacher);

    if (!exam) {
      return res.status(404).json({
        success: false,
        error: { message: 'Examination not found.' },
      });
    }

    res.status(200).json({
      success: true,
      data: { exam },
    });
  } catch (error) {
    next(error);
  }
};

export const updateExam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id || req.user._id;

    const payload = { ...req.body };
    if (payload.assignedStudentEmails !== undefined) {
      payload.assignedStudentEmails = parseStudentEmails(payload.assignedStudentEmails);
    }

    const updated = await examService.updateExam(id, payload, teacherId);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { message: 'Examination not found or you are not authorized to edit it.' },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Examination updated successfully.',
      data: { exam: updated },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteExam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id || req.user._id;
    const deleted = await examService.deleteExam(id, teacherId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { message: 'Examination not found or you are not authorized to delete it.' },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Examination deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export const togglePublishStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const teacherId = req.user.id || req.user._id;

    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid status. Must be draft, published, or archived.' },
      });
    }

    const updated = await examService.setExamPublishStatus(id, status, teacherId);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { message: 'Examination not found.' },
      });
    }

    res.status(200).json({
      success: true,
      message: `Examination status updated to '${status}'.`,
      data: { exam: updated },
    });
  } catch (error) {
    next(error);
  }
};

export const getExamAnalytics = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id || req.user._id;
    const results = await examService.getExamResultsForTeacher(id, teacherId);

    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

export const updateResultsPolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id || req.user._id;
    const policyPayload = req.body;

    const updatedExam = await examService.updateExamResultsPolicy(id, policyPayload, teacherId);

    res.status(200).json({
      success: true,
      message: 'Examination results and answer review policy updated successfully.',
      data: { exam: updatedExam },
    });
  } catch (error) {
    next(error);
  }
};

export const getAllTeacherAttemptsHandler = async (req, res, next) => {
  try {
    const teacherId = req.user.id || req.user._id;
    const attempts = await examService.getAllTeacherAttempts(teacherId);

    res.status(200).json({
      success: true,
      data: { attempts },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// STUDENT CONTROLLERS
// ==========================================

export const getAvailableExams = async (req, res, next) => {
  try {
    const studentId = req.user.id || req.user._id;
    const studentEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';
    const teacherEmail = req.query.teacherEmail || req.query.email || null;
    const exams = await examService.getAvailableExamsForStudent(studentId, teacherEmail, studentEmail);

    res.status(200).json({
      success: true,
      data: { exams },
    });
  } catch (error) {
    next(error);
  }
};

export const startAttempt = async (req, res, next) => {
  try {
    const { examId } = req.body;
    if (!examId) {
      return res.status(400).json({
        success: false,
        error: { message: 'examId is required to start an attempt.' },
      });
    }

    const result = await examService.startExamAttempt(examId, req.user);

    res.status(200).json({
      success: true,
      message: 'Examination session initiated.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const saveAnswer = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { questionId, selectedOptionIndex, isMarkedForReview } = req.body;
    const studentId = req.user.id || req.user._id;

    if (!questionId) {
      return res.status(400).json({
        success: false,
        error: { message: 'questionId is required.' },
      });
    }

    const result = await examService.saveStudentAnswer(attemptId, studentId, {
      questionId,
      selectedOptionIndex,
      isMarkedForReview,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const submitAttempt = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { isTimeout } = req.body;
    const studentId = req.user.id || req.user._id;

    const result = await examService.submitExamAttempt(attemptId, studentId, !!isTimeout);

    res.status(200).json({
      success: true,
      message: 'Examination submitted successfully.',
      data: { attempt: result },
    });
  } catch (error) {
    next(error);
  }
};

export const getMyAttempts = async (req, res, next) => {
  try {
    const studentId = req.user.id || req.user._id;
    const attempts = await examService.getStudentAttempts(studentId);

    res.status(200).json({
      success: true,
      data: { attempts },
    });
  } catch (error) {
    next(error);
  }
};

export const getAttemptDetails = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const userId = req.user.id || req.user._id;
    const attempt = await examService.getAttemptById(attemptId, userId, req.user.role);

    if (!attempt) {
      return res.status(404).json({
        success: false,
        error: { message: 'Examination attempt not found.' },
      });
    }

    res.status(200).json({
      success: true,
      data: { attempt },
    });
  } catch (error) {
    next(error);
  }
};

export const recordProctoringEvent = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { eventType, details, severity, snapshotUrl, snapshotBase64 } = req.body;
    const studentId = req.user.id || req.user._id;

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: { message: 'eventType is required.' },
      });
    }

    const result = await examService.recordProctoringEvent(attemptId, studentId, {
      eventType,
      details,
      severity,
      snapshotUrl,
      snapshotBase64,
    });

    res.status(200).json({
      success: true,
      message: 'Proctoring telemetry recorded.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getAttemptProctoringEvents = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const result = await examService.getAttemptProctoringEvents(attemptId, req.user);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const enrollReferenceImage = async (req, res, next) => {
  try {
    const { imageBase64 } = req.body;
    const studentId = req.user.id || req.user._id || req.user.studentId;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: { message: 'imageBase64 photo data is required for candidate identity enrollment.' },
      });
    }

    const { enrollStudentReferenceImage } = await import('../services/user.service.js');
    const result = await enrollStudentReferenceImage(studentId, imageBase64);

    res.status(200).json({
      success: true,
      message: 'Candidate face identity enrolled successfully.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getReferenceStatus = async (req, res, next) => {
  try {
    const studentId = req.user.id || req.user._id || req.user.studentId;
    const { getStudentReferenceImage } = await import('../services/user.service.js');
    const result = await getStudentReferenceImage(studentId);

    res.status(200).json({
      success: true,
      data: result || { hasReferenceImage: false },
    });
  } catch (error) {
    next(error);
  }
};

export const analyzeProctoringFrame = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user.id || req.user._id;
    const {
      imageBase64,
      timestamp,
      isSessionStart,
      clientMetrics,
      clientPhoneDetected,
      clientPhoneConfidence,
      simulateAnomaly,
      simulatePhone,
    } = req.body;

    const result = await examService.analyzeProctoringFrame(attemptId, studentId, {
      imageBase64,
      timestamp,
      isSessionStart,
      clientMetrics,
      clientPhoneDetected,
      clientPhoneConfidence,
      simulateAnomaly,
      simulatePhone,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getAttemptProctoringStatus = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const studentId = req.user.id || req.user._id;
    const result = await examService.getAttemptProctoringStatus(attemptId, studentId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

