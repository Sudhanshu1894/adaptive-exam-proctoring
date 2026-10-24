import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 35000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to automatically attach JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('adaptive_exam_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for consistent error handling
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const customError = {
      message: error.response?.data?.error?.message || error.response?.data?.message || error.message || 'An unexpected network error occurred',
      statusCode: error.response?.status || 500,
      details: error.response?.data || null,
      isNetworkError: !error.response,
    };
    return Promise.reject(customError);
  }
);

/**
 * Health check endpoints
 */
export const checkHealth = async () => apiClient.get('/health');
export const checkPing = async () => apiClient.get('/health/ping');

/**
 * Amazon Cognito & User Authentication Endpoints
 */
export const apiLogin = async (credentials) => apiClient.post('/auth/login', credentials);
export const apiRegister = async (userData) => apiClient.post('/auth/register', userData);
export const apiSyncCognitoSession = async (payload) => apiClient.post('/auth/cognito/sync', payload);
export const apiExchangeCognitoCode = async ({ code, redirectUri }) => apiClient.post('/auth/cognito/exchange-code', { code, redirectUri });
export const apiValidateCognitoSession = async (intendedRole) => apiClient.post('/auth/cognito-session', { intendedRole });
export const apiGetMe = async () => apiClient.get('/auth/me');
export const apiLogout = async () => apiClient.post('/auth/logout');
export const apiGetDemoCredentials = async () => apiClient.get('/auth/demo-credentials');
export const apiCognitoAuth = async (credentials) => apiClient.post('/aws/cognito/auth', credentials);
export const apiCognitoConfirm = async ({ email, code }) => apiClient.post('/aws/cognito/confirm', { email, code });
export const apiCognitoResendCode = async ({ email }) => apiClient.post('/aws/cognito/resend-code', { email });
export const apiSwitchRole = async (targetRole) => apiClient.post('/auth/switch-role', { targetRole });

/**
 * AWS Lambda: enrollment (IndexFaces x3 baselines, S3 baselines/, SearchFacesByImage)
 */
export const apiEnrollStudent = async (studentId, baselineImages = []) => {
  return apiClient.post('/enrollment', { studentId, baselineImages });
};

export const apiVerifyStudentFace = async (studentId, liveImage) => {
  return apiClient.post('/enrollment/verify', { studentId, liveImage });
};

/**
 * AWS Lambda: session (start, resume, autosave, submit)
 */
export const apiStartSession = async (studentId, examId) => {
  return apiClient.post('/session/start', { studentId, examId });
};

export const apiResumeSession = async (sessionId) => {
  return apiClient.post('/session/resume', { sessionId });
};

export const apiAutosaveSession = async (sessionId, questionId, selectedOptionIndex, isMarkedForReview) => {
  return apiClient.post('/session/autosave', {
    sessionId,
    questionId,
    selectedOptionIndex,
    isMarkedForReview,
  });
};

export const apiSubmitSession = async (sessionId) => {
  return apiClient.post('/session/submit', { sessionId });
};

/**
 * AWS Lambda: scoring (telemetry, strikes, escalation, SNS email alerts)
 */
export const apiSendScoringTelemetry = async ({
  sessionId,
  eventType,
  details = '',
  confidence = 95,
  evidenceBase64 = null,
}) => {
  return apiClient.post('/scoring/telemetry', {
    sessionId,
    eventType,
    details,
    confidence,
    evidenceBase64,
  });
};

/**
 * AWS Lambda: exams (authoring, roster, status, results)
 */
export const apiGetExams = async () => apiClient.get('/exams');
export const apiCreateExamServerless = async (examData) => apiClient.post('/exams', examData);
export const apiGetExamByIdServerless = async (examId) => apiClient.get(`/exams/${examId}`);
export const apiGetExamResultsServerless = async (examId) => apiClient.get(`/exams/${examId}/results`);

/**
 * AWS Lambda: dashboard (roster, marking, analytics, end)
 */
export const apiGetLiveDashboard = async (examId = null) => {
  const query = examId ? `?examId=${encodeURIComponent(examId)}` : '';
  return apiClient.get(`/dashboard${query}`);
};

export const apiGetDashboardTimeline = async (sessionId) => {
  return apiClient.get(`/dashboard/timeline?sessionId=${encodeURIComponent(sessionId)}`);
};

export const apiEndSessionByProctor = async (sessionId, proctorReason) => {
  return apiClient.post('/dashboard/end-session', { sessionId, proctorReason });
};

/**
 * Backwards-Compatible Legacy Aliases
 */
export const apiGetTeacherExams = async () => apiClient.get('/exams/teacher');
export const apiGetAllTeacherAttempts = async () => apiClient.get('/exams/teacher/attempts');
export const apiCreateExam = async (examData) => apiClient.post('/exams/teacher', examData);
export const apiUpdateExam = async (id, examData) => apiClient.put(`/exams/teacher/${id}`, examData);
export const apiDeleteExam = async (id) => apiClient.delete(`/exams/teacher/${id}`);
export const apiTogglePublishExam = async (id, status) => apiClient.patch(`/exams/teacher/${id}/publish`, { status });
export const apiGetExamAnalytics = async (id) => apiClient.get(`/exams/teacher/${id}/analytics`);
export const apiUpdateExamResultsPolicy = async (id, policy) => apiClient.patch(`/exams/teacher/${id}/results-policy`, policy);

/**
 * LMS Courses & Student Enrollment Management
 */
export const apiGetTeacherCourses = async () => apiClient.get('/courses/teacher');
export const apiCreateCourse = async (courseData) => apiClient.post('/courses', courseData);
export const apiGetCourseDetails = async (courseId) => apiClient.get(`/courses/${courseId}`);
export const apiEnrollStudentInCourse = async (courseId, { rollNo, email }) =>
  apiClient.post(`/courses/${courseId}/students`, { rollNo, email });
export const apiBulkEnrollStudents = async (courseId, students) =>
  apiClient.post(`/courses/${courseId}/students/bulk`, { students });
export const apiRemoveStudentFromCourse = async (courseId, identifier) =>
  apiClient.delete(`/courses/${courseId}/students/${encodeURIComponent(identifier)}`);

export const apiGetAvailableExams = async (teacherEmail = '') => {
  const query = teacherEmail ? `?teacherEmail=${encodeURIComponent(teacherEmail)}` : '';
  return apiClient.get(`/exams/student/available${query}`);
};
export const apiStartExamAttempt = async (examId) => apiClient.post('/exams/student/start', { examId });
export const apiSaveAttemptAnswer = async (attemptId, answerPayload) => apiClient.patch(`/exams/student/attempt/${attemptId}/answer`, answerPayload);
export const apiSubmitAttempt = async (attemptId, options = {}) => apiClient.post(`/exams/student/attempt/${attemptId}/submit`, options);
export const apiGetStudentAttempts = async () => apiClient.get('/exams/student/attempts');
export const apiGetAttemptDetails = async (attemptId) => apiClient.get(`/exams/student/attempt/${attemptId}`);
export const apiRecordProctoringEvent = async (attemptId, eventPayload) => apiClient.post(`/exams/student/attempt/${attemptId}/proctor-event`, eventPayload);
export const apiGetAttemptProctoringEvents = async (attemptId) => apiClient.get(`/exams/attempt/${attemptId}/proctor-events`);

export const apiGetAwsStatus = async () => apiClient.get('/aws/status');
export const apiGetS3PresignedUrl = async (key, contentType = 'image/jpeg') => apiClient.post('/aws/s3/presigned-url', { key, contentType });
export const apiUploadSnapshotToS3 = async (imageBase64, key) => apiClient.post('/aws/s3/upload-snapshot', { imageBase64, key });
export const apiRekognitionDetectFaces = async (imageBase64, simulateAnomaly = null) => apiClient.post('/aws/rekognition/detect-faces', { imageBase64, simulateAnomaly });
export const apiRekognitionDetectLabels = async (imageBase64, options = {}) => apiClient.post('/aws/rekognition/detect-labels', { imageBase64, ...options });
export const apiRekognitionVerifyIdentity = async (livePhotoBase64, referencePhotoBase64) => apiClient.post('/aws/rekognition/verify-identity', { livePhotoBase64, referencePhotoBase64 });
export const apiLambdaEvaluateIncident = async (incidentPayload) => apiClient.post('/aws/lambda/evaluate-incident', incidentPayload);

/**
 * Real-Time Proctoring Pipeline & Candidate Enrollment
 */
export const apiEnrollReferencePhoto = async (imageBase64) =>
  apiClient.post('/exams/student/enroll-reference', { imageBase64 }, { timeout: 45000 });
export const apiGetReferenceStatus = async () => apiClient.get('/exams/student/reference-status');
export const apiAnalyzeProctoringFrame = async (attemptId, payload) => apiClient.post(`/exams/student/attempt/${attemptId}/proctor-frame`, payload);
export const apiGetAttemptProctoringStatus = async (attemptId) => apiClient.get(`/exams/student/attempt/${attemptId}/proctor-status`);

export const apiConfirmCognitoAccount = async (email, code) => apiClient.post('/aws/cognito/confirm', { email, code });
export const apiAdminConfirmCognitoAccount = async (email) => apiClient.post('/aws/cognito/admin-confirm', { email });
export const apiResendCognitoCode = async (email) => apiClient.post('/aws/cognito/resend-code', { email });

export default apiClient;
