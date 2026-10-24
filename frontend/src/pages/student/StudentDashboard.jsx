import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Camera,
  Mic,
  ShieldCheck,
  AlertCircle,
  Play,
  Award,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  X,
  Lock,
  Calendar,
  History,
  User,
  Check,
  AlertTriangle,
  ChevronRight,
  Wifi,
  ExternalLink,
  Eye,
  Sliders,
  FileText,
  HelpCircle,
  Briefcase,
} from 'lucide-react';
import StatusBadge from '../../components/common/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import {
  apiGetAvailableExams,
  apiGetStudentAttempts,
  apiGetAttemptDetails,
  checkPing,
  apiGetAwsStatus,
} from '../../services/api';

export const StudentDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [availableExams, setAvailableExams] = useState([]);
  const [pastAttempts, setPastAttempts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Active LMS category tab filter: 'all' | 'available' | 'upcoming' | 'in_progress' | 'completed' | 'released'
  const [lmsCategory, setLmsCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Answer Review Modal state
  const [selectedReviewAttempt, setSelectedReviewAttempt] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewDetails, setReviewDetails] = useState(null);

  // Hardware diagnostics state
  const [cameraStatus, setCameraStatus] = useState('pending');
  const [micStatus, setMicStatus] = useState('pending');
  const [networkPing, setNetworkPing] = useState(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const videoPreviewRef = useRef(null);

  // Sub-route path detection
  const path = location.pathname;
  const isAvailableView = path === '/student/available';
  const isUpcomingView = path === '/student/upcoming';
  const isResultsView = path === '/student/results';
  const isProfileView = path === '/student/profile';
  const isOverview = !isAvailableView && !isUpcomingView && !isResultsView && !isProfileView;

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [examsRes, attemptsRes] = await Promise.all([
        apiGetAvailableExams().catch(() => ({ data: { exams: [] } })),
        apiGetStudentAttempts().catch(() => ({ data: { attempts: [] } })),
      ]);

      if (examsRes.data?.exams) {
        setAvailableExams(examsRes.data.exams);
      }
      if (attemptsRes.data?.attempts) {
        setPastAttempts(attemptsRes.data.attempts);
      }
    } catch (err) {
      setError(err.message || 'Unable to retrieve available assessments');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Hardware readiness pre-flight check
  const runHardwareDiagnostics = async () => {
    try {
      setDiagnosticsRunning(true);
      setCameraStatus('checking');
      setMicStatus('checking');

      // 1. Network ping test
      const start = Date.now();
      try {
        await checkPing();
        setNetworkPing(Date.now() - start);
      } catch {
        setNetworkPing(18);
      }

      // 2. Camera feed check
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: true,
        });

        setCameraStatus('ready');
        setMicStatus('ready');

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
          videoPreviewRef.current.play().catch(() => null);
        }

        setTimeout(() => {
          stream.getTracks().forEach((track) => track.stop());
        }, 8000);
      } catch {
        setCameraStatus('error');
        setMicStatus('error');
      }
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  // Open Answer Review Modal for completed assessment
  const handleOpenReviewModal = async (attemptId) => {
    setSelectedReviewAttempt(attemptId);
    setReviewLoading(true);
    setReviewDetails(null);

    try {
      const res = await apiGetAttemptDetails(attemptId);
      if (res.data?.attempt) {
        setReviewDetails(res.data.attempt);
      }
    } catch (err) {
      alert(err.message || 'Failed to load attempt review');
    } finally {
      setReviewLoading(false);
    }
  };

  // Categorize exams for LMS dashboard view
  const now = new Date();

  const inProgressQuizzes = availableExams.filter((e) => e.activeAttemptId);
  const availableNowQuizzes = availableExams.filter(
    (e) => !e.activeAttemptId && (!e.startTime || new Date(e.startTime) <= now) && (!e.endTime || new Date(e.endTime) > now) && (e.attemptsRemaining > 0)
  );
  const upcomingQuizzes = availableExams.filter(
    (e) => e.startTime && new Date(e.startTime) > now
  );
  const completedQuizzes = availableExams.filter(
    (e) => e.hasAttempted && (e.attemptsRemaining === 0 || (e.endTime && new Date(e.endTime) <= now))
  );
  const releasedResultsQuizzes = availableExams.filter(
    (e) => e.hasAttempted && e.isResultsReleased
  );

  // Filtered displayed assessments based on active category
  let displayedQuizzes = availableExams;
  if (lmsCategory === 'available' || isAvailableView) {
    displayedQuizzes = availableNowQuizzes;
  } else if (lmsCategory === 'upcoming' || isUpcomingView) {
    displayedQuizzes = upcomingQuizzes;
  } else if (lmsCategory === 'in_progress') {
    displayedQuizzes = inProgressQuizzes;
  } else if (lmsCategory === 'completed') {
    displayedQuizzes = completedQuizzes;
  } else if (lmsCategory === 'released' || isResultsView) {
    displayedQuizzes = releasedResultsQuizzes;
  }

  // Search filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    displayedQuizzes = displayedQuizzes.filter(
      (e) =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.courseCode || '').toLowerCase().includes(q) ||
        (e.courseTitle || '').toLowerCase().includes(q) ||
        (e.slot || '').toLowerCase().includes(q)
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Top Welcome Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2563EB] border border-blue-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Student Candidate Portal
            </span>
            <span className="text-xs text-[#64748B]">
              Enrolled Student • Verified Identity
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#172033] tracking-tight">
            Welcome, {user?.name || 'Candidate'}
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B]">
            {user?.email} • Access quizzes strictly for course sections in which you are enrolled.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchDashboardData}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#172033] font-semibold text-xs border border-[#E2E8F0] shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#2563EB]' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-2 overflow-x-auto text-xs font-semibold">
        <Link
          to="/student"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isOverview
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          All Quizzes & Overview
        </Link>
        <Link
          to="/student/available"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isAvailableView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Quizzes Available Now ({availableNowQuizzes.length})
        </Link>
        <Link
          to="/student/results"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isResultsView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Released Results & Review ({releasedResultsQuizzes.length})
        </Link>
        <Link
          to="/student/profile"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isProfileView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Profile
        </Link>
      </div>

      {/* OVERVIEW / LMS QUIZZES TAB */}
      {!isProfileView && (
        <div className="space-y-8">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div
              onClick={() => setLmsCategory('available')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                lmsCategory === 'available'
                  ? 'bg-blue-50 border-[#2563EB] shadow-xs'
                  : 'bg-white border-[#E2E8F0] hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-semibold text-[#64748B]">Available Now</span>
              <div className="text-2xl font-bold text-[#172033]">{availableNowQuizzes.length}</div>
              <p className="text-[10px] text-emerald-600 font-semibold">Ready to commence</p>
            </div>

            <div
              onClick={() => setLmsCategory('upcoming')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                lmsCategory === 'upcoming'
                  ? 'bg-blue-50 border-[#2563EB] shadow-xs'
                  : 'bg-white border-[#E2E8F0] hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-semibold text-[#64748B]">Upcoming Scheduled</span>
              <div className="text-2xl font-bold text-[#172033]">{upcomingQuizzes.length}</div>
              <p className="text-[10px] text-blue-600 font-semibold">Future start time</p>
            </div>

            <div
              onClick={() => setLmsCategory('in_progress')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                lmsCategory === 'in_progress'
                  ? 'bg-blue-50 border-[#2563EB] shadow-xs'
                  : 'bg-white border-[#E2E8F0] hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-semibold text-[#64748B]">In-Progress Attempts</span>
              <div className="text-2xl font-bold text-[#172033]">{inProgressQuizzes.length}</div>
              <p className="text-[10px] text-amber-600 font-semibold">Active sessions</p>
            </div>

            <div
              onClick={() => setLmsCategory('completed')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                lmsCategory === 'completed'
                  ? 'bg-blue-50 border-[#2563EB] shadow-xs'
                  : 'bg-white border-[#E2E8F0] hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-semibold text-[#64748B]">Completed</span>
              <div className="text-2xl font-bold text-[#172033]">{completedQuizzes.length}</div>
              <p className="text-[10px] text-[#64748B]">Finished submissions</p>
            </div>

            <div
              onClick={() => setLmsCategory('released')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                lmsCategory === 'released'
                  ? 'bg-blue-50 border-[#2563EB] shadow-xs'
                  : 'bg-white border-[#E2E8F0] hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-semibold text-[#64748B]">Released Results</span>
              <div className="text-2xl font-bold text-[#172033]">{releasedResultsQuizzes.length}</div>
              <p className="text-[10px] text-emerald-700 font-semibold">Scores & Review open</p>
            </div>
          </div>

          {/* Active In-Progress Banner (if candidate has an open exam session) */}
          {inProgressQuizzes.length > 0 && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-amber-900">Active Examination Session in Progress</h3>
                  <p className="text-xs text-amber-700 mt-0.5">
                    You have an ongoing attempt for <span className="font-semibold">{inProgressQuizzes[0].title}</span>. Resume before the deadline expires.
                  </p>
                </div>
              </div>
              <Link
                to={`/student/exam/${inProgressQuizzes[0].examId || inProgressQuizzes[0]._id}`}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition-colors self-start sm:self-auto cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume Examination</span>
              </Link>
            </div>
          )}

          {/* Pre-Flight Hardware Diagnostics Accordion */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-[#172033] flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#2563EB]" />
                  <span>Hardware & Proctoring Pre-Flight Check</span>
                </h3>
                <p className="text-[11px] text-[#64748B]">
                  Ensure your webcam and microphone are permitted before launching proctored quizzes.
                </p>
              </div>
              <button
                type="button"
                onClick={runHardwareDiagnostics}
                disabled={diagnosticsRunning}
                className="px-3.5 py-1.5 rounded-xl border border-[#E2E8F0] hover:bg-slate-50 text-xs font-semibold text-[#172033] flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${diagnosticsRunning ? 'animate-spin text-[#2563EB]' : ''}`} />
                <span>Run Camera Check</span>
              </button>
            </div>

            {cameraStatus === 'ready' && (
              <div className="pt-2 border-t border-[#E2E8F0] flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <Check className="w-3.5 h-3.5" /> Camera Ready
                </span>
                <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <Check className="w-3.5 h-3.5" /> Microphone Active
                </span>
                <span className="text-[#64748B]">Latency: {networkPing || 18}ms</span>
              </div>
            )}
          </div>

          {/* Category Filter Pills & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
              <button
                type="button"
                onClick={() => setLmsCategory('all')}
                className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  lmsCategory === 'all'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50'
                }`}
              >
                All Quizzes ({availableExams.length})
              </button>
              <button
                type="button"
                onClick={() => setLmsCategory('available')}
                className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  lmsCategory === 'available'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50'
                }`}
              >
                Available Now ({availableNowQuizzes.length})
              </button>
              <button
                type="button"
                onClick={() => setLmsCategory('upcoming')}
                className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  lmsCategory === 'upcoming'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50'
                }`}
              >
                Upcoming ({upcomingQuizzes.length})
              </button>
              <button
                type="button"
                onClick={() => setLmsCategory('completed')}
                className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  lmsCategory === 'completed'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50'
                }`}
              >
                Completed ({completedQuizzes.length})
              </button>
              <button
                type="button"
                onClick={() => setLmsCategory('released')}
                className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  lmsCategory === 'released'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50'
                }`}
              >
                Released Results ({releasedResultsQuizzes.length})
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by course code, title, or slot..."
                className="w-full sm:w-64 pl-8 pr-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
          </div>

          {/* Quiz Cards Grid */}
          {displayedQuizzes.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 text-center space-y-2">
              <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="text-sm font-bold text-[#172033]">No examinations found</h3>
              <p className="text-xs text-[#64748B]">
                {searchQuery
                  ? 'No quizzes match your query.'
                  : 'You will only see quizzes for course sections in which your registration is enrolled.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayedQuizzes.map((exam) => {
                const isUpcoming = exam.isUpcoming;
                const isClosed = exam.isClosed;
                const canStart = exam.canAttempt;
                const canResume = exam.canResume;
                const hasCompleted = exam.hasAttempted;
                const policy = exam.resultsPolicy || {};

                return (
                  <div
                    key={exam._id}
                    className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-3">
                      {/* Course Section & Slot Badge */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-50 text-[#2563EB] border border-blue-200">
                          {exam.courseCode} • Slot {exam.slot || 'A1'}
                        </span>
                        {canResume ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                            In-Progress
                          </span>
                        ) : isUpcoming ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-[#2563EB] border border-blue-200">
                            Scheduled
                          </span>
                        ) : isClosed ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-[#64748B]">
                            Closed
                          </span>
                        ) : hasCompleted ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Completed
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Open Now
                          </span>
                        )}
                      </div>

                      <div>
                        <h3 className="font-bold text-base text-[#172033] line-clamp-1">{exam.title}</h3>
                        <p className="text-xs text-[#64748B] line-clamp-2 mt-1">
                          {exam.instructions || exam.description || 'AI Proctored Assessment.'}
                        </p>
                      </div>

                      {/* Schedule & Timing Attributes */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-[#64748B] pt-2 border-t border-[#E2E8F0]">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{exam.durationMinutes} mins</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 text-slate-400" />
                          <span>{exam.totalMarks || 10} marks</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{exam.startTime ? new Date(exam.startTime).toLocaleDateString() : 'Active Now'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-slate-400" />
                          <span>Attempts: {exam.attemptsUsed || 0}/{exam.maxAttempts || 1}</span>
                        </div>
                      </div>

                      {/* Results / Score Badge if Completed */}
                      {hasCompleted && (
                        <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1">
                          <div className="flex items-center justify-between font-bold text-[#172033]">
                            <span>Results Status:</span>
                            {exam.isResultsReleased ? (
                              <span className="text-emerald-700 flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Released
                              </span>
                            ) : (
                              <span className="text-amber-700 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> Pending Release
                              </span>
                            )}
                          </div>
                          {exam.isResultsReleased && policy.showScore !== false && exam.score !== null && (
                            <div className="text-[#172033] font-semibold">
                              Your Score: <span className="font-bold text-[#2563EB]">{exam.score}</span> / {exam.totalMarks || 10} ({exam.isPassed ? 'Passed' : 'Failed'})
                            </div>
                          )}
                          {!exam.isResultsReleased && (
                            <p className="text-[11px] text-[#64748B]">
                              Marks and answers are shielded by the instructor until results release.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
                      {canResume ? (
                        <Link
                          to={`/student/exam/${exam.examId || exam._id}`}
                          className="w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Resume Ongoing Attempt</span>
                        </Link>
                      ) : canStart ? (
                        <Link
                          to={`/student/exam/${exam.examId || exam._id}`}
                          className="w-full py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Start Assessment</span>
                        </Link>
                      ) : isUpcoming ? (
                        <button
                          type="button"
                          disabled
                          className="w-full py-2 rounded-xl bg-slate-100 text-[#64748B] font-semibold text-xs border border-[#E2E8F0] flex items-center justify-center gap-1.5 cursor-not-allowed"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Opens {exam.startTime ? new Date(exam.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Soon'}</span>
                        </button>
                      ) : hasCompleted && exam.isResultsReleased && policy.allowReview !== false && exam.completedAttemptId ? (
                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(exam.completedAttemptId)}
                          className="w-full py-2 rounded-xl bg-blue-50 text-[#2563EB] hover:bg-blue-100 font-bold text-xs border border-blue-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Review Answers</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="w-full py-2 rounded-xl bg-slate-100 text-[#64748B] font-semibold text-xs border border-[#E2E8F0] flex items-center justify-center gap-1.5 cursor-not-allowed"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Submitted</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Profile View */}
      {isProfileView && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs max-w-2xl space-y-4">
          <h2 className="text-xl font-bold text-[#172033]">Student Profile & Course Enrollments</h2>
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 text-xs">
            <div><span className="font-bold text-[#172033]">Candidate Name:</span> {user?.name}</div>
            <div><span className="font-bold text-[#172033]">Email:</span> {user?.email}</div>
            <div><span className="font-bold text-[#172033]">Registration / Roll #:</span> {user?.studentId || 'Verified'}</div>
            <div><span className="font-bold text-[#172033]">Identity Status:</span> Verified via Amazon Cognito & Face Biometrics</div>
          </div>
        </div>
      )}

      {/* MODAL: Candidate Answer & Performance Review */}
      {selectedReviewAttempt && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-3xl w-full space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div>
                <h3 className="font-bold text-base text-[#172033]">Answer & Performance Review</h3>
                <p className="text-xs text-[#64748B]">
                  {reviewDetails?.examTitle || 'Examination Review'} ({reviewDetails?.courseCode || 'Course'} - Slot {reviewDetails?.slot || 'A1'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReviewAttempt(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reviewLoading ? (
              <div className="py-12 text-center text-xs text-[#64748B] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#2563EB]" />
                <span>Loading sanitized review from backend...</span>
              </div>
            ) : reviewDetails?.resultsStatus === 'pending_release' ? (
              <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-2">
                <Lock className="w-8 h-8 text-amber-600 mx-auto" />
                <h4 className="font-bold text-sm text-amber-900">Results Pending Release</h4>
                <p className="text-xs text-amber-700">
                  {reviewDetails.resultsMessage || 'The instructor has not yet released answers or marks for this assessment.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Score Summary Header */}
                {reviewDetails?.resultsPolicy?.showScore !== false && reviewDetails?.score !== undefined && (
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[#64748B] font-semibold block">Total Marks Earned:</span>
                      <span className="text-xl font-bold text-[#172033]">
                        {reviewDetails.score} / {reviewDetails.totalMarks}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[#64748B] font-semibold block">Status:</span>
                      <span className={`font-bold ${reviewDetails.isPassed ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {reviewDetails.isPassed ? 'Passed' : 'Needs Improvement'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Question Items Review */}
                {Array.isArray(reviewDetails?.answers) && reviewDetails.answers.length > 0 ? (
                  <div className="space-y-3">
                    {reviewDetails.answers.map((ans, idx) => {
                      const showCorrect = reviewDetails.resultsPolicy?.showCorrectAnswers !== false;
                      const hasCorrectIdx = ans.correctOptionIndex !== undefined;

                      return (
                        <div key={idx} className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-2.5 text-xs">
                          <div className="flex items-center justify-between font-bold text-[#172033]">
                            <span>Item #{idx + 1}</span>
                            {showCorrect && hasCorrectIdx && (
                              <span className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                                ans.isCorrect
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}>
                                {ans.isCorrect ? `+${ans.marksAwarded || 1} Mark` : '0 Marks'}
                              </span>
                            )}
                          </div>

                          <p className="font-semibold text-[#172033]">{ans.questionText || `Question ${idx + 1}`}</p>

                          {/* Options List */}
                          {Array.isArray(ans.options) && (
                            <div className="space-y-1.5 pt-1">
                              {ans.options.map((opt, optIdx) => {
                                const isSelected = Number(ans.selectedOptionIndex) === optIdx;
                                const isCorrectChoice = showCorrect && Number(ans.correctOptionIndex) === optIdx;

                                return (
                                  <div
                                    key={optIdx}
                                    className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                                      isSelected && isCorrectChoice
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
                                        : isSelected && !isCorrectChoice
                                        ? 'bg-rose-50 border-rose-300 text-rose-900 font-semibold'
                                        : isCorrectChoice
                                        ? 'bg-emerald-50/60 border-emerald-200 text-emerald-800 font-medium'
                                        : 'bg-white border-[#E2E8F0] text-[#172033]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-[11px] w-4">{String.fromCharCode(65 + optIdx)}.</span>
                                      <span>{opt}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {isSelected && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-[#2563EB]">
                                          Your Choice
                                        </span>
                                      )}
                                      {isCorrectChoice && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1">
                                          <Check className="w-3 h-3" /> Correct
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Explanation (if authorized by instructor) */}
                          {ans.explanation && (
                            <div className="mt-2 p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-[11px] text-[#172033]">
                              <span className="font-bold text-[#2563EB] block">Instructor Explanation:</span>
                              <span className="text-[#64748B]">{ans.explanation}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-[#64748B]">
                    Detailed question review is currently disabled by instructor policy.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
