import awsServices from '../services/aws/index.js';
import { setUserConfirmationStatus } from '../services/user.service.js';

const { s3, rekognition, cognito, lambda, sns, getStatus } = awsServices;

/**
 * GET /api/aws/status
 * Returns operational state and Free-Tier configuration of all AWS services
 */
export const getAwsStatusHandler = async (req, res, next) => {
  try {
    const status = getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/s3/presigned-url
 * Generates an Amazon S3 presigned URL for direct candidate upload
 */
export const getS3PresignedUrlHandler = async (req, res, next) => {
  try {
    const { key, contentType = 'image/jpeg', expiresIn = 300 } = req.body;
    if (!key) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing S3 object key (e.g., "snapshots/attempt1/frame_01.jpg")' },
      });
    }

    const result = await s3.getPresignedUploadUrl(key, contentType, expiresIn);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/s3/upload-snapshot
 * Uploads a base64 snapshot to Amazon S3
 */
export const uploadSnapshotHandler = async (req, res, next) => {
  try {
    const { imageBase64, key, contentType = 'image/jpeg' } = req.body;
    if (!imageBase64 || !key) {
      return res.status(400).json({
        success: false,
        error: { message: 'imageBase64 and key are required' },
      });
    }

    const result = await s3.uploadEvidenceSnapshot(imageBase64, key, contentType);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/rekognition/detect-faces
 * Analyzes webcam snapshot using Amazon Rekognition
 */
export const detectFacesHandler = async (req, res, next) => {
  try {
    const { imageBase64, simulateAnomaly } = req.body;
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: { message: 'imageBase64 is required for Amazon Rekognition analysis' },
      });
    }

    const result = await rekognition.detectFaces(imageBase64, { simulateAnomaly });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/rekognition/detect-labels
 * Analyzes frame for objects such as mobile phones using Rekognition DetectLabels
 */
export const detectLabelsHandler = async (req, res, next) => {
  try {
    const { imageBase64, simulatePhone, simulateAnomaly } = req.body;
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: { message: 'imageBase64 is required for Rekognition label/phone detection' },
      });
    }

    const result = await rekognition.detectLabels(imageBase64, {
      simulatePhone: simulatePhone || simulateAnomaly === 'PHONE_DETECTED',
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/rekognition/verify-identity
 * Compares live webcam snapshot with student baseline reference photo
 */
export const verifyCandidateIdentityHandler = async (req, res, next) => {
  try {
    const { livePhotoBase64, referencePhotoBase64, similarityThreshold = 80 } = req.body;
    if (!livePhotoBase64 || !referencePhotoBase64) {
      return res.status(400).json({
        success: false,
        error: { message: 'Both livePhotoBase64 and referencePhotoBase64 are required' },
      });
    }

    const result = await rekognition.compareFaces(
      livePhotoBase64,
      referencePhotoBase64,
      similarityThreshold
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/lambda/evaluate-incident
 * Evaluates a proctoring incident via AWS Lambda, triggering SNS if risk is critical
 */
export const evaluateIncidentWithLambdaHandler = async (req, res, next) => {
  try {
    const {
      attemptId,
      eventType,
      details,
      currentScore = 0,
      studentName = 'Student',
      examTitle = 'Examination',
      snapshotUrl = null,
    } = req.body;

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: { message: 'eventType is required' },
      });
    }

    // 1. Invoke AWS Lambda Incident Evaluator
    const lambdaResult = await lambda.invokeIncidentEvaluatorLambda({
      attemptId,
      eventType,
      details,
      currentScore,
      snapshotUrl,
    });

    // 2. If risk score reaches HIGH threshold, invoke Amazon SNS topic alert
    let snsAlert = null;
    if (lambdaResult?.result?.shouldNotifyInstructor) {
      snsAlert = await sns.sendHighRiskProctorAlert({
        studentName,
        examTitle,
        riskScore: lambdaResult.result.updatedRiskScore,
        breachType: eventType,
        details,
      });
    }

    res.json({
      success: true,
      data: {
        lambda: lambdaResult,
        snsAlert,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/cognito/auth
 * Authenticates candidate via Amazon Cognito
 */
export const cognitoAuthHandler = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email and password are required' },
      });
    }

    const authResult = await cognito.authenticateWithCognito({ email, password });
    res.json({
      success: true,
      data: authResult,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/cognito/confirm
 * Confirms user with 6-digit confirmation code from email
 */
export const cognitoConfirmHandler = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email and 6-digit confirmation code are required.' },
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await cognito.confirmCognitoUser({ email: cleanEmail, code });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { message: result.error || 'Failed to confirm account.' },
      });
    }

    await setUserConfirmationStatus(cleanEmail, true);

    res.json({
      success: true,
      message: 'AWS Cognito account confirmed successfully! You can now sign in.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/cognito/admin-confirm
 * Confirms user directly in Cognito and DB (useful when Cognito email delivery is throttled or lands in spam)
 */
export const cognitoAdminConfirmHandler = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email address is required.' },
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await cognito.adminConfirmCognitoUser({ email: cleanEmail });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { message: result.error || 'Failed to confirm account.' },
      });
    }

    await setUserConfirmationStatus(cleanEmail, true);

    res.json({
      success: true,
      message: 'Account confirmed successfully! You can now sign in.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/aws/cognito/resend-code
 * Resends 6-digit confirmation code to email
 */
export const cognitoResendCodeHandler = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email address is required.' },
      });
    }

    const result = await cognito.resendCognitoCode({ email });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { message: result.error || 'Failed to resend confirmation code.' },
      });
    }

    res.json({
      success: true,
      message: `A new 6-digit confirmation code has been sent to ${result.destination || email}.`,
      destination: result.destination,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getAwsStatusHandler,
  getS3PresignedUrlHandler,
  uploadSnapshotHandler,
  detectFacesHandler,
  verifyCandidateIdentityHandler,
  evaluateIncidentWithLambdaHandler,
  cognitoAuthHandler,
  cognitoConfirmHandler,
  cognitoAdminConfirmHandler,
  cognitoResendCodeHandler,
};
