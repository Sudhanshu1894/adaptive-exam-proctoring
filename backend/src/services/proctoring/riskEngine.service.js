/**
 * Dedicated Proctoring Risk Engine Service (Sections 30 - 42)
 * 
 * Central source of truth for:
 * 1. Event scoring and frequency-aware penalties
 * 2. Multi-signal escalation and confidence filtering
 * 3. Behavioral correlation within configurable time windows
 * 4. Adaptive polling interval recommendation
 * 5. SNS alert de-duplication rules
 * 6. Final post-exam proctoring summary generation
 */

// Configurable thresholds and intervals from environment variables
export const getEngineConfig = () => ({
  faceConfidenceThreshold: Number(process.env.REKOGNITION_FACE_CONFIDENCE_THRESHOLD || 80),
  objectConfidenceThreshold: Number(process.env.REKOGNITION_OBJECT_CONFIDENCE_THRESHOLD || 80),
  correlationWindowMs: Number(process.env.RISK_CORRELATION_WINDOW_MS || 60000),
  normalIntervalMs: Number(process.env.PROCTORING_NORMAL_INTERVAL_MS || 10000),
  suspiciousIntervalMs: Number(process.env.PROCTORING_SUSPICIOUS_INTERVAL_MS || 5000),
  highRiskIntervalMs: Number(process.env.PROCTORING_HIGH_RISK_INTERVAL_MS || 3000),
});

/**
 * Determine official risk level tier based on 0-100 score (Section 30)
 * 0–19   = LOW
 * 20–49  = MEDIUM
 * 50–79  = HIGH
 * 80–100 = CRITICAL
 */
export const calculateRiskLevel = (score) => {
  if (score <= 19) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 79) return 'HIGH';
  return 'CRITICAL';
};

/**
 * Map candidate risk level to adaptive proctoring polling interval (Section 38)
 */
export const getRecommendedIntervalMs = (score) => {
  const config = getEngineConfig();
  if (score <= 19) return config.normalIntervalMs;
  if (score <= 49) return config.suspiciousIntervalMs;
  return config.highRiskIntervalMs;
};

export const ABSENCE_THRESHOLDS = {
  GRACE_MS: Number(process.env.FACE_ABSENCE_GRACE_MS || 5000),
  WARNING_MS: Number(process.env.FACE_ABSENCE_WARNING_MS || 10000),
  CRITICAL_MS: Number(process.env.FACE_ABSENCE_CRITICAL_MS || 30000),
};

/**
 * Evaluate single event penalty with frequency escalation and deduplication
 * Exact weights:
 * - Sustained candidate absence: +10
 * - Repeated multiple faces: +20
 * - Repeated high-confidence phone detection: +25
 * - Confirmed identity mismatch: +30
 * - Repeated looking away: +5
 * - Repeated prohibited tab switching: +5
 */
export const computeEventPenalty = (eventType, attempt, options = {}) => {
  // If the incident is already active and continuing, deduplicate to prevent frame-spamming
  if (options.isOngoingIncident) {
    return { penalty: 0, severity: options.severity || 'info', isRepeated: true, isDeduplicated: true };
  }

  let penalty = 0;
  let severity = options.severity || 'warning';
  let isRepeated = false;

  switch (eventType) {
    case 'SUSTAINED_ABSENCE':
    case 'SUSTAINED_ABSENCE_CRITICAL': {
      const absences = (attempt.faceAbsenceCount || 0) + 1;
      attempt.faceAbsenceCount = absences;
      penalty = 10; // Sustained candidate absence: +10
      severity = 'critical';
      break;
    }

    case 'SUSTAINED_ABSENCE_WARNING': {
      penalty = 0; // Warning tier within 10s-30s window without penalty
      severity = 'warning';
      break;
    }

    case 'NO_FACE_DETECTED':
    case 'FACE_NOT_DETECTED': {
      // Single unconfirmed absence frame does not add penalty (handled by temporal absence tracker)
      penalty = 0;
      severity = 'info';
      break;
    }

    case 'MULTIPLE_FACES': {
      const count = (attempt.multipleFaceCount || 0) + 1;
      attempt.multipleFaceCount = count;
      // Repeated multiple faces: +20
      penalty = 20;
      severity = 'critical';
      if (count > 1) {
        isRepeated = true;
      }
      break;
    }

    case 'LOOKING_AWAY':
    case 'GAZE_LOOKING_AWAY': {
      const count = (attempt.lookingAwayCount || 0) + 1;
      attempt.lookingAwayCount = count;
      // Repeated looking away: +5
      penalty = count >= 2 ? 5 : 0;
      severity = count >= 2 ? 'warning' : 'info';
      if (count >= 2) isRepeated = true;
      break;
    }

    case 'PHONE_DETECTED':
    case 'SUSPICIOUS_DEVICE': {
      const count = (attempt.phoneDetectionCount || 0) + 1;
      attempt.phoneDetectionCount = count;
      // Repeated high-confidence phone detection: +25
      penalty = 25;
      severity = 'critical';
      if (count > 1) {
        isRepeated = true;
      }
      break;
    }

    case 'IDENTITY_MISMATCH': {
      const count = (attempt.identityMismatchCount || 0) + 1;
      attempt.identityMismatchCount = count;
      // Confirmed identity mismatch: +30
      penalty = 30;
      severity = 'critical';
      break;
    }

    case 'TAB_SWITCH': {
      const count = (attempt.tabSwitchCount || 0) + 1;
      attempt.tabSwitchCount = count;
      // Repeated prohibited tab switching: +5
      penalty = 5;
      severity = count > 1 ? 'critical' : 'warning';
      if (count > 1) isRepeated = true;
      break;
    }

    case 'FULLSCREEN_EXIT': {
      const count = (attempt.fullscreenExitCount || 0) + 1;
      attempt.fullscreenExitCount = count;
      penalty = 5;
      severity = count > 1 ? 'critical' : 'warning';
      break;
    }

    case 'CAMERA_DISABLED':
    case 'CAMERA_DISCONNECTED': {
      const count = (attempt.cameraDisabledCount || 0) + 1;
      attempt.cameraDisabledCount = count;
      penalty = 10;
      severity = 'critical';
      break;
    }

    case 'COPY_PASTE_ATTEMPT': {
      const count = (attempt.copyPasteCount || 0) + 1;
      attempt.copyPasteCount = count;
      penalty = 5;
      severity = 'warning';
      break;
    }

    default:
      penalty = 0;
      severity = options.severity || 'info';
  }

  return { penalty, severity, isRepeated, isDeduplicated: false };
};

/**
 * Correlate behavioral events occurring within time window (Section 35)
 * Examples:
 * - NO_FACE + LOOKING_AWAY + TAB_SWITCH => compounding suspicion (+15)
 * - MULTIPLE_FACES + PHONE_DETECTED => HIGH/CRITICAL (+25)
 * - IDENTITY_MISMATCH + MULTIPLE_FACES => CRITICAL (+30)
 * - PHONE_DETECTED + LOOKING_AWAY + TAB_SWITCH => HIGH/CRITICAL (+25)
 */
export const checkBehavioralCorrelation = (recentEvents, newEventType, correlationWindowMs) => {
  const now = Date.now();
  const windowEvents = recentEvents.filter(
    (e) => now - new Date(e.timestamp).getTime() <= correlationWindowMs
  );
  const typesInWindow = new Set(windowEvents.map((e) => e.eventType));
  typesInWindow.add(newEventType);

  const matchedCorrelations = [];
  let correlationBonus = 0;

  // Pattern 1: NO_FACE + LOOKING_AWAY + TAB_SWITCH
  if (
    (typesInWindow.has('NO_FACE_DETECTED') || typesInWindow.has('FACE_NOT_DETECTED')) &&
    (typesInWindow.has('LOOKING_AWAY') || typesInWindow.has('GAZE_LOOKING_AWAY')) &&
    typesInWindow.has('TAB_SWITCH')
  ) {
    matchedCorrelations.push({
      pattern: 'ABSENCE_AND_TAB_DEPARTURE',
      description: 'Candidate looked away, left camera view, and switched browser tabs',
      bonus: 15,
      severity: 'critical',
    });
    correlationBonus += 15;
  }

  // Pattern 2: MULTIPLE_FACES + PHONE_DETECTED
  if (
    typesInWindow.has('MULTIPLE_FACES') &&
    (typesInWindow.has('PHONE_DETECTED') || typesInWindow.has('SUSPICIOUS_DEVICE'))
  ) {
    matchedCorrelations.push({
      pattern: 'COLLABORATIVE_DEVICE_USAGE',
      description: 'Multiple faces identified concurrently with mobile device detection',
      bonus: 25,
      severity: 'critical',
    });
    correlationBonus += 25;
  }

  // Pattern 3: IDENTITY_MISMATCH + MULTIPLE_FACES
  if (typesInWindow.has('IDENTITY_MISMATCH') && typesInWindow.has('MULTIPLE_FACES')) {
    matchedCorrelations.push({
      pattern: 'IMPERSONATION_CONCURRENT_ATTENDANCE',
      description: 'Biometric identity mismatch paired with secondary individual in arena',
      bonus: 30,
      severity: 'critical',
    });
    correlationBonus += 30;
  }

  // Pattern 4: PHONE_DETECTED + LOOKING_AWAY + TAB_SWITCH
  if (
    (typesInWindow.has('PHONE_DETECTED') || typesInWindow.has('SUSPICIOUS_DEVICE')) &&
    (typesInWindow.has('LOOKING_AWAY') || typesInWindow.has('GAZE_LOOKING_AWAY')) &&
    typesInWindow.has('TAB_SWITCH')
  ) {
    matchedCorrelations.push({
      pattern: 'EXTERNAL_DEVICE_REFERENCE',
      description: 'Phone detected alongside screen gaze departure and tab navigation',
      bonus: 25,
      severity: 'critical',
    });
    correlationBonus += 25;
  }

  return {
    correlationBonus,
    matchedCorrelations,
  };
};

/**
 * Central evaluation of an incoming telemetry event (Section 31 & 32)
 * Backend is strictly the source of truth.
 */
export const evaluateProctoringRisk = (attempt, eventData) => {
  const config = getEngineConfig();
  const { eventType, details = '', confidence = null, evidenceS3Key = null, snapshotUrl = null } = eventData;

  // Filter low-confidence events for Rekognition vision events (Section 33)
  if (confidence !== null && confidence !== undefined) {
    const isVisionEvent = [
      'PHONE_DETECTED',
      'MULTIPLE_FACES',
      'NO_FACE_DETECTED',
      'LOOKING_AWAY',
      'IDENTITY_MISMATCH',
    ].includes(eventType);

    const requiredThreshold =
      eventType === 'PHONE_DETECTED'
        ? config.objectConfidenceThreshold
        : config.faceConfidenceThreshold;

    if (isVisionEvent && confidence < requiredThreshold) {
      // Confidence below threshold: record soft telemetry without penalizing risk score
      return {
        isPenalized: false,
        riskDelta: 0,
        riskScore: attempt.riskScore || 0,
        riskLevel: attempt.riskLevel || 'LOW',
        severity: 'info',
        recommendedIntervalMs: getRecommendedIntervalMs(attempt.riskScore || 0),
        reason: `Confidence (${confidence}%) below threshold (${requiredThreshold}%)`,
      };
    }
  }

  // 1. Compute Base Event Penalty with frequency escalation
  const { penalty, severity } = computeEventPenalty(eventType, attempt, eventData);

  // 2. Behavioral Correlation within window (Section 35)
  const recentEvents = attempt.proctoringEvents || [];
  const { correlationBonus, matchedCorrelations } = checkBehavioralCorrelation(
    recentEvents,
    eventType,
    config.correlationWindowMs
  );

  const totalDelta = penalty + correlationBonus;
  const currentScore = attempt.riskScore || 0;
  const newScore = Math.min(100, Math.max(0, currentScore + totalDelta));

  attempt.riskScore = newScore;
  attempt.riskLevel = calculateRiskLevel(newScore);

  let finalSeverity = severity;
  if (matchedCorrelations.length > 0 || newScore >= 80) {
    finalSeverity = 'critical';
  } else if (newScore >= 50 && finalSeverity === 'info') {
    finalSeverity = 'warning';
  }

  let finalDetails = details;
  if (matchedCorrelations.length > 0) {
    const corrNotes = matchedCorrelations.map((c) => c.description).join('; ');
    finalDetails = finalDetails ? `${finalDetails} [Correlation: ${corrNotes}]` : corrNotes;
  }

  return {
    isPenalized: true,
    riskDelta: totalDelta,
    basePenalty: penalty,
    correlationBonus,
    matchedCorrelations,
    riskScore: newScore,
    riskLevel: attempt.riskLevel,
    severity: finalSeverity,
    recommendedIntervalMs: getRecommendedIntervalMs(newScore),
    finalDetails,
  };
};

/**
 * De-duplicate and evaluate SNS alert trigger (Section 37)
 * - Risk < 50: No alert
 * - Risk >= 50: Warning notification (once per bracket)
 * - Risk >= 80: Critical proctoring alert (once per bracket)
 * - Severe single events: Identity mismatch, repeated multiple faces, phone detected
 */
export const evaluateSnsAlertTrigger = (attempt, newScore, eventType) => {
  const severeEvents = [
    'IDENTITY_MISMATCH',
    'PHONE_DETECTED',
    'MULTIPLE_FACES',
    'SUSTAINED_ABSENCE',
    'SUSTAINED_ABSENCE_CRITICAL',
    'TAB_SWITCH',
  ];
  const isSevereEvent = severeEvents.includes(eventType);
  const now = Date.now();

  attempt.lastAlertTimestamp = attempt.lastAlertTimestamp || 0;
  attempt.alertedEvents = attempt.alertedEvents || new Set();

  const timeSinceLastAlert = now - attempt.lastAlertTimestamp;
  const isNewBreachType = isSevereEvent && !attempt.alertedEvents.has(eventType);

  // Severe single event trigger (immediate if new breach type or at least 15s elapsed)
  if (isSevereEvent && (isNewBreachType || timeSinceLastAlert >= 15000)) {
    attempt.lastAlertTimestamp = now;
    if (attempt.alertedEvents.add) attempt.alertedEvents.add(eventType);
    attempt.lastSnsAlertLevel = newScore >= 70 ? 'CRITICAL' : 'WARNING';
    return {
      shouldAlert: true,
      alertLevel: attempt.lastSnsAlertLevel,
      reason: `Proctoring alert: ${eventType.replace(/_/g, ' ')} detected during exam`,
    };
  }

  // Critical escalation bracket (>= 70)
  if (newScore >= 70) {
    if (attempt.lastSnsAlertLevel !== 'CRITICAL' || timeSinceLastAlert >= 30000) {
      attempt.lastAlertTimestamp = now;
      attempt.lastSnsAlertLevel = 'CRITICAL';
      return {
        shouldAlert: true,
        alertLevel: 'CRITICAL',
        reason: `Session risk escalated to CRITICAL tier (${newScore}/100)`,
      };
    }
    return { shouldAlert: false, reason: 'Duplicate CRITICAL alert prevented' };
  }

  // Warning escalation bracket (>= 25)
  if (newScore >= 25) {
    if (timeSinceLastAlert >= 30000 || (!attempt.lastSnsAlertLevel)) {
      attempt.lastAlertTimestamp = now;
      attempt.lastSnsAlertLevel = 'WARNING';
      return {
        shouldAlert: true,
        alertLevel: 'WARNING',
        reason: `Session risk entered HIGH tier (${newScore}/100)`,
      };
    }
    return { shouldAlert: false, reason: 'Duplicate WARNING alert prevented' };
  }

  return { shouldAlert: false, reason: 'Score below alert threshold (<25)' };
};

/**
 * Generate comprehensive Proctoring Summary at Exam Completion (Section 39)
 */
export const generateProctoringSummary = (attempt) => {
  const events = attempt.proctoringEvents || [];
  const score = attempt.riskScore || 0;
  const level = attempt.riskLevel || calculateRiskLevel(score);

  const eventBreakdown = {};
  let criticalEvents = 0;

  events.forEach((e) => {
    eventBreakdown[e.eventType] = (eventBreakdown[e.eventType] || 0) + 1;
    if (e.severity === 'critical') {
      criticalEvents++;
    }
  });

  const identityMismatch = !!eventBreakdown['IDENTITY_MISMATCH'];
  const identityVerification = identityMismatch ? 'MISMATCH_FLAGGED' : 'VERIFIED';

  // Final Disposition (Section 39):
  // Non-punitive: "REVIEW_REQUIRED" guides instructor audit rather than blind auto-accusation
  let finalStatus = 'CLEAR';
  if (score >= 80 || (eventBreakdown['PHONE_DETECTED'] || 0) >= 2 || (eventBreakdown['MULTIPLE_FACES'] || 0) >= 2) {
    finalStatus = 'CRITICAL';
  } else if (score >= 50 || eventBreakdown['PHONE_DETECTED'] || eventBreakdown['MULTIPLE_FACES']) {
    finalStatus = 'HIGH_RISK';
  } else if (score >= 20 || criticalEvents > 0 || identityMismatch || (attempt.tabSwitchCount || 0) >= 2) {
    finalStatus = 'REVIEW_REQUIRED';
  } else {
    finalStatus = 'CLEAR';
  }

  return {
    attemptId: attempt._id ? attempt._id.toString() : null,
    riskScore: score,
    riskLevel: level,
    totalEvents: events.length,
    criticalEvents,
    eventBreakdown,
    identityVerification,
    finalStatus,
  };
};

export default {
  getEngineConfig,
  calculateRiskLevel,
  getRecommendedIntervalMs,
  computeEventPenalty,
  checkBehavioralCorrelation,
  evaluateProctoringRisk,
  evaluateSnsAlertTrigger,
  generateProctoringSummary,
};
