import express from 'express';
import {
  getAwsStatusHandler,
  getS3PresignedUrlHandler,
  uploadSnapshotHandler,
  detectFacesHandler,
  detectLabelsHandler,
  verifyCandidateIdentityHandler,
  evaluateIncidentWithLambdaHandler,
  cognitoAuthHandler,
  cognitoConfirmHandler,
  cognitoAdminConfirmHandler,
  cognitoResendCodeHandler,
} from '../controllers/aws.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// System diagnostics & Free Tier capability check
router.get('/status', getAwsStatusHandler);

// Amazon S3: Presigned upload URL & direct snapshot upload
router.post('/s3/presigned-url', protect, getS3PresignedUrlHandler);
router.post('/s3/upload-snapshot', protect, uploadSnapshotHandler);

// Amazon Rekognition: Face detection, label/phone detection & candidate identity verification
router.post('/rekognition/detect-faces', protect, detectFacesHandler);
router.post('/rekognition/detect-labels', protect, detectLabelsHandler);
router.post('/rekognition/verify-identity', protect, verifyCandidateIdentityHandler);

// AWS Lambda & SNS: Serverless incident evaluation & proctor alert dispatch
router.post('/lambda/evaluate-incident', protect, evaluateIncidentWithLambdaHandler);

// Amazon Cognito: Identity exchange & Account confirmation
router.post('/cognito/auth', cognitoAuthHandler);
router.post('/cognito/confirm', cognitoConfirmHandler);
router.post('/cognito/admin-confirm', cognitoAdminConfirmHandler);
router.post('/cognito/resend-code', cognitoResendCodeHandler);

export default router;
