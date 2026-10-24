import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flag,
  RotateCcw,
  Send,
  Maximize2,
  Camera,
  Mic,
  Check,
  X,
  Award,
  AlertCircle,
  ScanFace,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  apiStartExamAttempt,
  apiSaveAttemptAnswer,
  apiSubmitAttempt,
  apiRekognitionDetectFaces,
  apiUploadSnapshotToS3,
  apiEnrollReferencePhoto,
  apiGetReferenceStatus,
} from '../../services/api';
import useProctoringEngine from '../../hooks/useProctoringEngine';

export const ExamArena = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  // Arena session state
  const [attempt, setAttempt] = useState(null);
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answersState, setAnswersState] = useState({}); // { [questionId]: { selectedOptionIndex, isMarkedForReview } }
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving' | 'saved' | 'error'

  // Pre-flight Entrance Gate & Identity Enrollment
  const [hasEnteredArena, setHasEnteredArena] = useState(false);
  const preflightVideoRef = useRef(null);
  const preflightStreamRef = useRef(null);
  const [isPreflightCameraActive, setIsPreflightCameraActive] = useState(false);
  const [preflightStatus, setPreflightStatus] = useState('idle'); // 'idle' | 'scanning' | 'verified' | 'unavailable' | 'error'
  const [referenceStatus, setReferenceStatus] = useState(null);
  const [isEnrollingReference, setIsEnrollingReference] = useState(false);
  const [enrollmentMsg, setEnrollmentMsg] = useState(null);

  // Time management
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Submission & Results
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [examResult, setExamResult] = useState(null);

  // Granular Section 7 Proctoring Engine Hook
  const {
    videoRef,
    isCameraActive,
    cameraStatus,
    cameraError,
    startCamera,
    isMicActive,
    audioLevel,
    isFullscreen,
    requestFullscreen,
    faceStatus,
    faceCount,
    absenceDurationMs,
    phoneStatus,
    phoneConfidence,
    identityStatus,
    identitySimilarity,
    aiAnalysisStatus,
    aiAnalysisMode,
    riskScore,
    riskLevel,
    lastAnalysisTime,
    isAnalyzing,
    events,
    latestAlert,
    dismissAlert,
    triggerManualAnalysis,
  } = useProctoringEngine({
    attemptId: attempt?._id,
    enabled: hasEnteredArena && !examResult,
  });

  // Start attempt on mount
  useEffect(() => {
    const initializeAttempt = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const res = await apiStartExamAttempt(examId);

        if (res.success && res.data) {
          const { attempt: att, exam: ex } = res.data;
          const qList = res.data.questions || ex?.questions || [];
          setAttempt(att);
          setExam(ex);
          setQuestions(qList);

          // Initialize answers map
          const initialMap = {};
          if (att.answers && Array.isArray(att.answers)) {
            att.answers.forEach((ans) => {
              initialMap[ans.questionId] = {
                selectedOptionIndex: ans.selectedOptionIndex,
                isMarkedForReview: ans.isMarkedForReview,
              };
            });
          }
          setAnswersState(initialMap);

          // Calculate remaining seconds
          const durationSec = (ex.durationMinutes || 45) * 60;
          if (att.startedAt) {
            const elapsedSec = Math.floor((Date.now() - new Date(att.startedAt).getTime()) / 1000);
            const remaining = Math.max(0, durationSec - elapsedSec);
            setRemainingSeconds(remaining);
          } else {
            setRemainingSeconds(durationSec);
          }
        }
      } catch (err) {
        setLoadError(err.message || 'Unable to initialize examination session.');
      } finally {
        setIsLoading(false);
      }
    };

    if (examId) {
      initializeAttempt();
    }
  }, [examId]);

  // Check Candidate Reference Enrollment Status on mount
  useEffect(() => {
    const checkReference = async () => {
      try {
        const res = await apiGetReferenceStatus();
        if (res && res.data) {
          setReferenceStatus(res.data);
        }
      } catch {
        setReferenceStatus({ hasReferenceImage: false });
      }
    };
    checkReference();
  }, []);

  // Pre-flight camera check
  const startPreflightCamera = async () => {
    try {
      setPreflightStatus('scanning');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });

      preflightStreamRef.current = stream;
      setIsPreflightCameraActive(true);

      if (preflightVideoRef.current) {
        preflightVideoRef.current.srcObject = stream;
      }

      setPreflightStatus('verified');
    } catch {
      setPreflightStatus('unavailable');
    }
  };

  // Enroll Candidate Face Photo for Rekognition CompareFaces
  const handleEnrollReference = async () => {
    if (!preflightVideoRef.current || preflightVideoRef.current.videoWidth === 0) {
      setEnrollmentMsg({ type: 'error', text: 'Please activate camera feed before capturing reference photo.' });
      return;
    }
    try {
      setIsEnrollingReference(true);
      setEnrollmentMsg(null);

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(preflightVideoRef.current, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);

      const res = await apiEnrollReferencePhoto(imageBase64);
      if (res && res.success) {
        setReferenceStatus({ hasReferenceImage: true, enrolledAt: new Date() });
        setEnrollmentMsg({
          type: 'success',
          text: '✓ Candidate face identity enrolled and validated by Amazon Rekognition.',
        });
      } else {
        setEnrollmentMsg({
          type: 'error',
          text: res?.message || 'Face enrollment failed. Ensure a single face is clearly visible.',
        });
      }
    } catch (err) {
      setEnrollmentMsg({
        type: 'error',
        text: err?.message || 'Enrollment failed. Ensure exactly 1 front-facing face is visible.',
      });
    } finally {
      setIsEnrollingReference(false);
    }
  };

  const handleEnterArena = () => {
    if (preflightStreamRef.current) {
      preflightStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    setHasEnteredArena(true);
    requestFullscreen();
  };

  // Timer countdown
  useEffect(() => {
    if (!hasEnteredArena || examResult || remainingSeconds <= 0) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoSubmitOnTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [hasEnteredArena, examResult, remainingSeconds]);

  const handleAutoSubmitOnTimeout = async () => {
    try {
      if (!attempt) return;
      setIsSubmitting(true);
      const res = await apiSubmitAttempt(attempt._id, { isTimeout: true });
      if (res.data?.attempt) {
        setExamResult(res.data.attempt);
      }
    } catch (err) {
      console.error('Auto-submit timeout error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format timer MM:SS
  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  // Save student answer
  const handleSelectOption = async (optionIdx) => {
    if (!attempt || !questions[currentQIndex]) return;

    const q = questions[currentQIndex];
    const qId = (q._id || q.id || q.questionId).toString();
    const prev = answersState[qId] || {};

    const nextState = {
      ...answersState,
      [qId]: {
        ...prev,
        selectedOptionIndex: optionIdx,
      },
    };

    setAnswersState(nextState);
    setSaveStatus('saving');

    try {
      await apiSaveAttemptAnswer(attempt._id, {
        questionId: qId,
        selectedOptionIndex: optionIdx,
        isMarkedForReview: prev.isMarkedForReview || false,
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  };

  // Toggle Mark for Review
  const handleToggleReview = async () => {
    if (!attempt || !questions[currentQIndex]) return;

    const q = questions[currentQIndex];
    const qId = (q._id || q.id || q.questionId).toString();
    const prev = answersState[qId] || { selectedOptionIndex: null, isMarkedForReview: false };
    const newReview = !prev.isMarkedForReview;

    setAnswersState({
      ...answersState,
      [qId]: {
        ...prev,
        isMarkedForReview: newReview,
      },
    });

    try {
      await apiSaveAttemptAnswer(attempt._id, {
        questionId: qId,
        selectedOptionIndex: prev.selectedOptionIndex,
        isMarkedForReview: newReview,
      });
    } catch (err) {
      console.error('Failed to toggle review flag:', err);
    }
  };

  // Clear answer
  const handleClearAnswer = async () => {
    if (!attempt || !questions[currentQIndex]) return;

    const q = questions[currentQIndex];
    const qId = (q._id || q.id || q.questionId).toString();
    const prev = answersState[qId] || {};

    setAnswersState({
      ...answersState,
      [qId]: {
        ...prev,
        selectedOptionIndex: null,
      },
    });

    try {
      await apiSaveAttemptAnswer(attempt._id, {
        questionId: qId,
        selectedOptionIndex: null,
        isMarkedForReview: prev.isMarkedForReview || false,
      });
    } catch (err) {
      console.error('Failed to clear answer:', err);
    }
  };

  // Final submit handler
  const handleFinalSubmit = async () => {
    if (!attempt) return;
    setIsSubmitting(true);

    try {
      const res = await apiSubmitAttempt(attempt._id, { isTimeout: false });
      if (res.data?.attempt) {
        setExamResult(res.data.attempt);
        setIsSubmitModalOpen(false);
      }
    } catch (err) {
      console.error('Failed to submit exam:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center space-y-4">
        <div className="w-8 h-8 rounded-full border-3 border-[#2563EB] border-t-transparent animate-spin" />
        <p className="text-xs font-semibold text-[#64748B]">Preparing examination session...</p>
      </div>
    );
  }

  // Error State
  if (loadError) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-4 shadow-xs">
        <div className="h-12 w-12 rounded-2xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-[#172033]">Unable to Enter Examination</h2>
        <p className="text-xs text-[#64748B] leading-relaxed">{loadError}</p>
        <button
          onClick={() => navigate('/student')}
          className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-semibold shadow-xs"
        >
          Return to Student Portal
        </button>
      </div>
    );
  }

  // Genuinely Empty Exam State (Issue 2 Requirement)
  if (!isLoading && !loadError && questions.length === 0) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-4 shadow-xs">
        <div className="h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-[#172033]">Exam Not Ready</h2>
        <p className="text-xs text-[#64748B] leading-relaxed">
          This exam is not ready yet. Please contact your teacher.
        </p>
        <button
          type="button"
          onClick={() => navigate('/student')}
          className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          Return to Student Dashboard
        </button>
      </div>
    );
  }

  // Pre-flight Entrance Screen
  if (!hasEnteredArena) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-6 shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-[#2563EB] border border-blue-200 text-xs font-semibold">
            <span>{exam?.courseCode || 'ASSESSMENT'}</span>
            <span>•</span>
            <span>Slot {exam?.slot || 'A1'}</span>
            <span>•</span>
            <span>Proctored Assessment</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#172033] tracking-tight">{exam?.title}</h1>
          <p className="text-xs text-[#64748B] max-w-lg mx-auto leading-relaxed">
            Please test your camera device before starting the assessment. Your proctored session will operate securely in fullscreen mode.
          </p>
        </div>

        {/* Exam Instructions if provided by teacher */}
        {exam?.instructions && (
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 text-left space-y-1 text-xs">
            <span className="font-bold text-[#2563EB] flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> Instructor Instructions
            </span>
            <p className="text-[#172033] whitespace-pre-line leading-relaxed">{exam.instructions}</p>
          </div>
        )}

        {/* Exam Quick Specs */}
        <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <div>
            <span className="text-[11px] text-[#64748B] block font-medium">Duration</span>
            <span className="text-sm font-bold text-[#172033]">{exam?.durationMinutes} mins</span>
          </div>
          <div>
            <span className="text-[11px] text-[#64748B] block font-medium">Questions</span>
            <span className="text-sm font-bold text-[#2563EB]">{questions.length} Items</span>
          </div>
          <div>
            <span className="text-[11px] text-[#64748B] block font-medium">Passing Marks</span>
            <span className="text-sm font-bold text-emerald-600">
              {exam?.passingMarks} / {exam?.totalMarks || 20}
            </span>
          </div>
        </div>

        {/* Camera Preview & Identity Enrollment */}
        <div className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#172033] flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-[#2563EB]" />
              <span>Camera & Identity Verification Gate</span>
            </span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              preflightStatus === 'verified'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : preflightStatus === 'unavailable'
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-blue-50 text-[#2563EB] border-blue-200'
            }`}>
              {preflightStatus === 'verified' ? 'Camera Active' : preflightStatus === 'unavailable' ? 'Proctoring Unavailable' : 'Ready to Test'}
            </span>
          </div>

          <div className="relative aspect-video max-w-sm mx-auto bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
            <video
              ref={preflightVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${isPreflightCameraActive ? 'block' : 'hidden'}`}
            />
            {!isPreflightCameraActive && (
              <div className="text-center p-4 space-y-2">
                <Camera className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-400">Click below to activate camera preview</p>
              </div>
            )}
          </div>

          {!isPreflightCameraActive ? (
            <button
              type="button"
              onClick={startPreflightCamera}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#172033] font-semibold text-xs border border-[#E2E8F0] transition-colors cursor-pointer"
            >
              Activate Camera Feed
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              {/* Identity Reference Photo Section */}
              <div className="p-3 rounded-lg bg-white border border-[#E2E8F0] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#172033] flex items-center gap-1.5">
                    <ScanFace className="w-4 h-4 text-[#2563EB]" />
                    <span>Candidate Reference Identity</span>
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    referenceStatus?.hasReferenceImage
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    {referenceStatus?.hasReferenceImage ? 'Enrolled' : 'Not Enrolled'}
                  </span>
                </div>

                <p className="text-[11px] text-[#64748B]">
                  {referenceStatus?.hasReferenceImage
                    ? 'Your face identity is enrolled. Amazon Rekognition CompareFaces will verify candidate identity at session start.'
                    : 'To enable AI Candidate Identity Verification, capture a reference face photo now. Exactly 1 front-facing face must be clearly visible.'}
                </p>

                {enrollmentMsg && (
                  <div className={`p-2 rounded-lg text-xs font-medium border ${
                    enrollmentMsg.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    {enrollmentMsg.text}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleEnrollReference}
                  disabled={isEnrollingReference}
                  className="w-full py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#2563EB] font-semibold text-xs border border-blue-200 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ScanFace className={`w-3.5 h-3.5 ${isEnrollingReference ? 'animate-spin' : ''}`} />
                  <span>
                    {isEnrollingReference
                      ? 'Enrolling with Amazon Rekognition...'
                      : referenceStatus?.hasReferenceImage
                      ? 'Update Reference Face Photo'
                      : 'Capture & Enroll Reference Photo'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleEnterArena}
          className="w-full py-3 px-6 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-bold text-sm shadow-xs transition-colors cursor-pointer"
        >
          Begin Examination Now
        </button>
      </div>
    );
  }

  // Examination Results Screen
  if (examResult) {
    const isPendingRelease = examResult.resultsStatus === 'pending_release';
    const hasScore = examResult.score !== undefined && examResult.score !== null;
    const isPassed = hasScore ? (examResult.isPassed ?? (examResult.score >= (exam?.passingMarks || 10))) : true;

    return (
      <div className="max-w-lg mx-auto my-12 bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center space-y-6 shadow-sm">
        <div className={`h-14 w-14 rounded-2xl mx-auto flex items-center justify-center ${
          isPendingRelease ? 'bg-blue-50 text-[#2563EB]' : isPassed ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
        }`}>
          {isPendingRelease ? <Clock className="w-8 h-8" /> : isPassed ? <CheckCircle2 className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
        </div>

        <div className="space-y-1">
          <h2 className="text-2xl font-extrabold text-[#172033]">
            {isPendingRelease ? 'Examination Submitted Successfully' : isPassed ? 'Assessment Completed' : 'Examination Submitted'}
          </h2>
          <p className="text-xs text-[#64748B]">
            {isPendingRelease
              ? (examResult.resultsMessage || 'Your answers have been cryptographically recorded. Results are pending release by your instructor.')
              : 'Your examination responses have been recorded and evaluated.'}
          </p>
        </div>

        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
          {hasScore ? (
            <>
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E2E8F0]">
                <span className="text-[#64748B]">Score Achieved:</span>
                <span className="font-bold text-[#172033] text-sm">
                  {examResult.score} / {exam?.totalMarks || 20} pts
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E2E8F0]">
                <span className="text-[#64748B]">Assessment Result:</span>
                <span className={`font-bold ${isPassed ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {isPassed ? 'Passed' : 'Needs Review'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E2E8F0]">
              <span className="text-[#64748B]">Results Visibility:</span>
              <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                Shielded (Pending Instructor Release)
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#64748B]">Proctoring Risk Level:</span>
            <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Low (Normal Session)
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/student')}
          className="w-full py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
        >
          Return to Student Dashboard
        </button>
      </div>
    );
  }

  // Active Exam Arena Question
  const currentQuestion = questions[currentQIndex] || null;
  const currentQId = currentQuestion ? (currentQuestion._id || currentQuestion.id || currentQuestion.questionId)?.toString() : null;
  const currentAnswer = currentQId ? (answersState[currentQId] || answersState[currentQuestion?._id] || answersState[currentQuestion?.id]) : null;
  const totalQuestions = questions.length;
  const answeredCount = Object.values(answersState).filter((a) => a.selectedOptionIndex !== null && a.selectedOptionIndex !== undefined).length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#172033] flex flex-col">
      {/* Top Fixed Exam Control Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E2E8F0] shadow-xs px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          
          {/* Exam Title & Course Code */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-[#2563EB] border border-blue-200">
              {exam?.courseCode || 'EXAM'}
            </span>
            <h2 className="text-sm sm:text-base font-bold text-[#172033] truncate max-w-xs sm:max-w-md">
              {exam?.title}
            </h2>
          </div>

          {/* Center: Proctoring Status Indicator */}
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 rounded-full bg-slate-50 border border-[#E2E8F0] text-xs">
            <span className="relative flex h-2 w-2">
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                riskLevel === 'CRITICAL' || riskLevel === 'HIGH'
                  ? 'bg-rose-500 animate-ping'
                  : riskLevel === 'MEDIUM'
                  ? 'bg-amber-400 animate-pulse'
                  : isCameraActive
                  ? 'bg-emerald-500'
                  : 'bg-slate-400'
              }`}></span>
            </span>
            <span className={`text-xs font-semibold ${isCameraActive ? 'text-[#172033]' : 'text-[#64748B]'}`}>
              Camera: {isCameraActive ? 'Active' : 'Offline'}
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-[11px] text-[#64748B]">
              AI: {aiAnalysisStatus === 'CONNECTED' ? 'Connected' : aiAnalysisStatus === 'ANALYZING' ? 'Analyzing...' : aiAnalysisStatus === 'ANALYSIS_DELAYED' ? 'Delayed' : 'Unavailable'}
            </span>
            <span className="text-slate-300">•</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
              riskLevel === 'CRITICAL'
                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                : riskLevel === 'HIGH'
                ? 'bg-orange-100 text-orange-800 border border-orange-200'
                : riskLevel === 'MEDIUM'
                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
            }`}>
              Risk: {riskLevel} ({riskScore}/100)
            </span>
          </div>

          {/* Right: Timer & Submit Button */}
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-bold border ${
              remainingSeconds < 300
                ? 'bg-rose-50 border-rose-200 text-rose-700 animate-pulse'
                : 'bg-slate-50 border-[#E2E8F0] text-[#172033]'
            }`}>
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>{formatTime(remainingSeconds)}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
            >
              <span>Submit Exam</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Examination Workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Main Question & Answer Card */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* Proctoring Warning / Incident Toast Banner */}
          {latestAlert && (
            <div className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold shadow-xs animate-in fade-in slide-in-from-top-2 duration-200 ${
              latestAlert.severity === 'critical'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{latestAlert.message}</span>
              </div>
              <button
                type="button"
                onClick={dismissAlert}
                className="text-xs opacity-70 hover:opacity-100 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
            
            {/* Question Header & Meta */}
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]">
              <span className="text-xs font-bold text-[#2563EB] bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                Question {currentQIndex + 1} of {totalQuestions}
              </span>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#64748B]">
                  Points: <strong className="text-[#172033]">{currentQuestion?.marks || 1}</strong>
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-[11px] text-[#64748B]">
                  {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Auto-save'}
                </span>
              </div>
            </div>

            {/* Question Text */}
            <div className="text-base sm:text-lg font-medium text-[#172033] leading-relaxed">
              {currentQuestion?.text}
            </div>

            {/* MCQ Options List */}
            <div className="space-y-3 pt-2">
              {currentQuestion?.options?.map((optionText, idx) => {
                const isSelected = currentAnswer?.selectedOptionIndex === idx;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full p-4 rounded-xl text-left text-xs sm:text-sm font-medium transition-all flex items-center justify-between border cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/70 border-2 border-[#2563EB] text-[#172033]'
                        : 'bg-white border-[#E2E8F0] text-[#172033] hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isSelected
                          ? 'bg-[#2563EB] text-white'
                          : 'border border-slate-300 text-[#64748B]'
                      }`}>
                        {String.fromCharCode(65 + idx)}
                      </div>
                      <span>{optionText}</span>
                    </div>

                    {isSelected && <Check className="w-4 h-4 text-[#2563EB] flex-shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Bottom Actions: Clear Choice & Mark for Review */}
            <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0] text-xs">
              <button
                type="button"
                onClick={handleToggleReview}
                className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-medium transition-colors ${
                  currentAnswer?.isMarkedForReview
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                <span>{currentAnswer?.isMarkedForReview ? 'Marked for Review' : 'Mark for Review'}</span>
              </button>

              <button
                type="button"
                onClick={handleClearAnswer}
                disabled={currentAnswer?.selectedOptionIndex === null || currentAnswer?.selectedOptionIndex === undefined}
                className="text-xs text-[#64748B] hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear choice
              </button>
            </div>

          </div>

          {/* Prev / Next Pagination Controls */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentQIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentQIndex === 0}
              className="px-4 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs font-semibold text-[#172033] hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1.5 shadow-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentQIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
              disabled={currentQIndex === totalQuestions - 1}
              className="px-4 py-2 rounded-xl bg-[#2563EB] text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5 shadow-xs"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Column: Question Palette & Camera HUD */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Section 7: Real-Time AI Proctoring Telemetry HUD */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <span className="text-xs font-bold text-[#172033] flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-[#2563EB]" />
                <span>AI Proctoring HUD</span>
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                aiAnalysisMode === 'aws-live'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                {aiAnalysisMode === 'aws-live' ? 'AWS-LIVE' : 'MOCK'}
              </span>
            </div>

            {/* Live Video Viewport */}
            <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
              />
              
              {/* Overlay badges on video */}
              {isCameraActive && (
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-xs text-white text-[10px] font-mono px-2 py-0.5 rounded-md border border-white/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>REC</span>
                </div>
              )}

              {isCameraActive && isAnalyzing && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-blue-600/80 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  <span>Analyzing</span>
                </div>
              )}

              {!isCameraActive && (
                <div className="text-center p-4 space-y-2.5 z-10">
                  <Camera className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-300 max-w-[200px] leading-relaxed">
                    {cameraStatus === 'Permission Denied'
                      ? 'Camera permission denied. Click below to retry.'
                      : 'Webcam feed is currently inactive.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => startCamera && startCamera()}
                    className="px-3.5 py-1.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    Enable Camera
                  </button>
                </div>
              )}
            </div>

            {/* Section 7 Granular Diagnostics Grid */}
            <div className="space-y-2 text-xs pt-1">
              {/* Camera */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[#64748B] font-medium">Camera</span>
                <span className={`font-semibold flex items-center gap-1.5 ${isCameraActive ? 'text-emerald-700' : 'text-rose-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCameraActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {isCameraActive ? 'Active' : cameraStatus || 'Offline'}
                </span>
              </div>

              {/* Face Count & Presence */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[#64748B] font-medium">Face</span>
                <span className={`font-semibold ${
                  faceStatus === 'SINGLE_FACE_DETECTED'
                    ? 'text-emerald-700'
                    : faceStatus === 'MULTIPLE_FACES'
                    ? 'text-rose-600'
                    : faceStatus === 'NO_FACE_DETECTED'
                    ? 'text-amber-700'
                    : 'text-slate-500'
                }`}>
                  {faceStatus === 'SINGLE_FACE_DETECTED'
                    ? '1 detected'
                    : faceStatus === 'MULTIPLE_FACES'
                    ? `${faceCount} detected`
                    : faceStatus === 'NO_FACE_DETECTED'
                    ? `No face (${Math.round((absenceDurationMs || 0) / 1000)}s)`
                    : 'AI analysis unavailable'}
                </span>
              </div>

              {/* Phone / Object Analysis */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[#64748B] font-medium">Phone</span>
                <span className={`font-semibold ${
                  phoneStatus === 'PHONE_DETECTED' || phoneStatus === 'DETECTED'
                    ? 'text-rose-600 font-bold'
                    : 'text-emerald-700'
                }`}>
                  {phoneStatus === 'PHONE_DETECTED' || phoneStatus === 'DETECTED'
                    ? `🚨 Detected (${phoneConfidence}%)`
                    : 'Not detected in latest frame'}
                </span>
              </div>

              {/* Candidate Identity Verification */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[#64748B] font-medium">Identity</span>
                <span className={`font-semibold ${
                  identityStatus === 'IDENTITY_MATCH'
                    ? 'text-emerald-700'
                    : identityStatus === 'IDENTITY_MISMATCH'
                    ? 'text-rose-600'
                    : identityStatus === 'IDENTITY_REVIEW_REQUIRED'
                    ? 'text-amber-700'
                    : 'text-slate-500'
                }`}>
                  {identityStatus === 'IDENTITY_MATCH'
                    ? `Verified at start ${identitySimilarity ? `(${identitySimilarity}%)` : ''}`
                    : identityStatus === 'IDENTITY_MISMATCH'
                    ? 'Mismatch detected'
                    : identityStatus === 'IDENTITY_REVIEW_REQUIRED'
                    ? 'Review required'
                    : 'Identity unavailable'}
                </span>
              </div>

              {/* AWS Analysis Connectivity */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[#64748B] font-medium">AI Analysis</span>
                <span className={`font-semibold ${
                  aiAnalysisStatus === 'CONNECTED'
                    ? 'text-emerald-700'
                    : aiAnalysisStatus === 'ANALYZING'
                    ? 'text-blue-600'
                    : aiAnalysisStatus === 'ANALYSIS_DELAYED'
                    ? 'text-amber-700'
                    : 'text-rose-600'
                }`}>
                  {aiAnalysisStatus === 'CONNECTED'
                    ? 'Connected'
                    : aiAnalysisStatus === 'ANALYZING'
                    ? 'Analyzing...'
                    : aiAnalysisStatus === 'ANALYSIS_DELAYED'
                    ? 'Analysis delayed'
                    : 'AI analysis unavailable'}
                </span>
              </div>

              {/* Authoritative Risk Level */}
              <div className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-medium">Current Risk</span>
                  <span className={`font-bold ${
                    riskLevel === 'CRITICAL' ? 'text-rose-600' :
                    riskLevel === 'HIGH' ? 'text-orange-600' :
                    riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {riskLevel} — {riskScore}/100
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      riskLevel === 'CRITICAL' ? 'bg-rose-600' :
                      riskLevel === 'HIGH' ? 'bg-orange-500' :
                      riskLevel === 'MEDIUM' ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(5, riskScore))}%` }}
                  />
                </div>
              </div>

              {/* Last Analysis Timestamp */}
              <div className="flex items-center justify-between text-[11px] text-[#64748B] px-1 pt-1">
                <span>Last analysis:</span>
                <span className="font-mono">
                  {lastAnalysisTime ? new Date(lastAnalysisTime).toLocaleTimeString() : 'Pending first scan'}
                </span>
              </div>

              {/* Manual Instant Trigger for Verification */}
              <button
                type="button"
                onClick={() => triggerManualAnalysis && triggerManualAnalysis()}
                disabled={isAnalyzing || !isCameraActive}
                className="w-full mt-2 py-1.5 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-[11px] font-semibold text-[#2563EB] transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? 'Analyzing Frame...' : 'Test AI Analysis Now'}</span>
              </button>
            </div>
          </div>

          {/* Question Navigation Palette */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <span className="text-xs font-bold text-[#172033]">Question Palette</span>
              <span className="text-xs text-[#64748B]">{answeredCount} of {totalQuestions} answered</span>
            </div>

            {/* Grid of Numbers */}
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const qId = (q._id || q.id || q.questionId)?.toString();
                const ans = answersState[qId] || answersState[q._id] || answersState[q.id];
                const isSelected = ans?.selectedOptionIndex !== null && ans?.selectedOptionIndex !== undefined;
                const isReview = ans?.isMarkedForReview;
                const isCurrent = idx === currentQIndex;

                let pillColor = 'bg-slate-100 text-slate-700 border-slate-200';
                if (isSelected) {
                  pillColor = 'bg-[#2563EB] text-white border-[#2563EB] font-bold';
                }
                if (isReview) {
                  pillColor = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
                }

                return (
                  <button
                    key={q._id}
                    type="button"
                    onClick={() => setCurrentQIndex(idx)}
                    className={`h-9 rounded-xl text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${pillColor} ${
                      isCurrent ? 'ring-2 ring-offset-1 ring-blue-600' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2E8F0] text-[11px] text-[#64748B]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#2563EB]"></span>
                <span>Answered</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-200"></span>
                <span>Review</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-200"></span>
                <span>Unvisited</span>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Confirmation Modal Before Final Submission */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#172033]">Confirm Exam Submission</h3>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#64748B] leading-relaxed">
              Are you sure you want to finish and submit your examination? Once submitted, your answers cannot be altered.
            </p>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1">
              <div className="flex justify-between text-[#172033]">
                <span>Total Questions:</span>
                <span className="font-bold">{totalQuestions}</span>
              </div>
              <div className="flex justify-between text-[#2563EB]">
                <span>Answered Questions:</span>
                <span className="font-bold">{answeredCount}</span>
              </div>
              <div className="flex justify-between text-[#64748B]">
                <span>Unanswered Questions:</span>
                <span>{totalQuestions - answeredCount}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] text-xs font-semibold hover:bg-slate-50"
              >
                Return to Exam
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
              >
                {isSubmitting ? 'Submitting...' : 'Yes, Submit Final Exam'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ExamArena;
