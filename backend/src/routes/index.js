import express from 'express';
import expressToLambda from './apiGateway.adapter.js';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import examRoutes from './exam.routes.js';
import courseRoutes from './course.routes.js';
import awsRoutes from './aws.routes.js';

// Import the 6 AWS Lambda Handlers matching the Architecture Blueprint
import {
  signupHandler,
  enrollmentHandler,
  sessionHandler,
  scoringHandler,
  examsHandler,
  dashboardHandler,
} from '../lambdas/index.js';

const router = express.Router();

// Root API overview & Architecture Manifest
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Adaptive AI-Based Online Examination & Proctoring System API',
    architecture: '100% Serverless AWS Reference Architecture',
    governance: 'IAM (one role per Lambda) · CloudTrail · CloudWatch alarms · AWS Budgets',
    apiGatewayRoutes: {
      signup: 'POST /api/signup',
      enrollment: {
        indexBaselines: 'POST /api/enrollment (IndexFaces x3 baselines -> S3 baselines/ + Rekognition proctorai-faces)',
        verifyCandidate: 'POST /api/enrollment/verify (SearchFacesByImage in proctorai-faces)',
      },
      session: {
        start: 'POST /api/session/start',
        resume: 'GET/POST /api/session/resume',
        autosave: 'POST /api/session/autosave',
        submit: 'POST /api/session/submit',
      },
      scoring: {
        telemetry: 'POST /api/scoring/telemetry (risk score · strikes -> DynamoDB FlaggedEvents & RiskScores)',
        escalation: 'POST /api/scoring/event (SNS email alerts to proctors)',
      },
      exams: {
        list: 'GET /api/exams',
        create: 'POST /api/exams (authoring & roster)',
        getOne: 'GET /api/exams/:id',
        update: 'PUT /api/exams/:id',
        results: 'GET /api/exams/:id/results',
      },
      dashboard: {
        liveRoster: 'GET /api/dashboard (roster · marking · analytics)',
        timeline: 'GET /api/dashboard/timeline',
        endSession: 'POST /api/dashboard/end-session (proctor manual force-end)',
      },
    },
    tables: ['Students', 'Exams', 'ExamSessions', 'FlaggedEvents', 'RiskScores'],
    mediaBucket: 'Amazon S3 (baselines/, flagged/, staging/ [1-day lifecycle])',
  });
});

// 1. Health check
router.use('/health', healthRoutes);

// 2. Lambda: signup (Cognito Post-Confirmation Trigger & API Gateway)
router.post('/signup', expressToLambda(signupHandler));

// 3. Lambda: enrollment (IndexFaces x3 baselines, S3 baselines/, SearchFacesByImage)
router.post('/enrollment', expressToLambda(enrollmentHandler));
router.post('/enrollment/verify', expressToLambda(enrollmentHandler));

// 4. Lambda: session (start, resume, autosave, submit)
router.post('/session/start', expressToLambda(sessionHandler));
router.get('/session/resume', expressToLambda(sessionHandler));
router.post('/session/resume', expressToLambda(sessionHandler));
router.post('/session/autosave', expressToLambda(sessionHandler));
router.post('/session/submit', expressToLambda(sessionHandler));

// 5. Lambda: scoring (risk score, strikes, escalation, SNS email alerts)
router.post('/scoring/telemetry', expressToLambda(scoringHandler));
router.post('/scoring/event', expressToLambda(scoringHandler));

// 6. Examination & LMS Course routes (Teacher authoring & Student arena)
router.use('/courses', courseRoutes);
router.use('/exams', examRoutes);
router.post('/serverless/exams', expressToLambda(examsHandler));
router.get('/serverless/exams', expressToLambda(examsHandler));

// 7. Lambda: dashboard (roster, marking, analytics, end)
router.get('/dashboard', expressToLambda(dashboardHandler));
router.get('/dashboard/timeline', expressToLambda(dashboardHandler));
router.post('/dashboard/end-session', expressToLambda(dashboardHandler));

// Backwards-compatible legacy client routes (auth, AWS helpers)
router.use('/auth', authRoutes);
router.use('/aws', awsRoutes);

export default router;
