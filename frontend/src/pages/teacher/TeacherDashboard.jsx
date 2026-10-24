import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  BookOpen,
  Plus,
  Users,
  ShieldAlert,
  Clock,
  Search,
  Filter,
  BarChart3,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Activity,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  X,
  PlusCircle,
  MinusCircle,
  Eye,
  Check,
  Briefcase,
  ExternalLink,
  Upload,
  Download,
  FileSpreadsheet,
  Lock,
  Unlock,
  EyeOff,
  Calendar,
  AlertCircle,
  HelpCircle,
  Layers,
  Settings,
  Send,
  UserPlus,
  CheckSquare,
  Square,
  Sliders,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/common/StatusBadge';
import {
  apiGetTeacherExams,
  apiGetAllTeacherAttempts,
  apiCreateExam,
  apiTogglePublishExam,
  apiDeleteExam,
  apiGetExamAnalytics,
  apiGetAttemptProctoringEvents,
  apiGetTeacherCourses,
  apiCreateCourse,
  apiEnrollStudentInCourse,
  apiBulkEnrollStudents,
  apiRemoveStudentFromCourse,
  apiUpdateExamResultsPolicy,
} from '../../services/api';

export const TeacherDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [exams, setExams] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sub-route path detection
  const path = location.pathname;
  const isCoursesView = path === '/teacher/courses';
  const isCreateExamView = path === '/teacher/create-exam';
  const isExamsView = path === '/teacher/exams';
  const isResultsView = path === '/teacher/results';
  const isReportsView = path === '/teacher/reports';
  const isProfileView = path === '/teacher/profile';
  const isOverview = !isCoursesView && !isCreateExamView && !isExamsView && !isResultsView && !isReportsView && !isProfileView;

  // Proctoring Report Audit Modal State
  const [selectedAuditAttempt, setSelectedAuditAttempt] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);

  // Results Policy Configuration Modal State
  const [selectedPolicyExam, setSelectedPolicyExam] = useState(null);
  const [policyForm, setPolicyForm] = useState({
    releaseMode: 'immediate',
    releaseDate: '',
    showScore: true,
    showCorrectAnswers: true,
    allowReview: true,
    showExplanations: true,
    isResultsReleased: true,
  });
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [policySuccessMsg, setPolicySuccessMsg] = useState('');

  // Course Management Modals & State
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [newCourseForm, setNewCourseForm] = useState({
    courseCode: '',
    title: '',
    slot: 'A1',
    description: '',
  });
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);

  // Single Student Enrollment Modal
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newStudentForm, setNewStudentForm] = useState({
    rollNo: '',
    email: '',
  });
  const [isEnrollingStudent, setIsEnrollingStudent] = useState(false);
  const [enrollmentMsg, setEnrollmentMsg] = useState(null);

  // Bulk CSV Enrollment Modal
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [parsedBulkStudents, setParsedBulkStudents] = useState([]);
  const [bulkErrors, setBulkErrors] = useState([]);
  const [isBulkEnrolling, setIsBulkEnrolling] = useState(false);
  const [bulkResultMsg, setBulkResultMsg] = useState(null);

  // Enrollment table search and filter
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState('all');

  // Exam creation form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState('');
  const [newExamForm, setNewExamForm] = useState({
    title: '',
    courseId: '',
    courseCode: '',
    slot: 'A1',
    instructions: '1. Please ensure your webcam and microphone remain active throughout the examination.\n2. Switching browser tabs or windows will trigger automated risk escalation.\n3. Keep your face centered in the camera frame.',
    startTime: '',
    endTime: '',
    durationMinutes: 45,
    maxAttempts: 1,
    passingMarks: 10,
    status: 'published',
    resultsPolicy: {
      releaseMode: 'immediate',
      releaseDate: '',
      showScore: true,
      showCorrectAnswers: true,
      allowReview: true,
      showExplanations: true,
      isResultsReleased: true,
    },
    questions: [
      {
        text: 'What is the primary function of an operating system kernel?',
        options: [
          'Direct hardware abstraction and resource scheduling',
          'Rendering graphic web pages in browser engines',
          'Formatting text documents into PDF files',
          'Managing electrical power to wall sockets',
        ],
        correctOptionIndex: 0,
        marks: 5,
        explanation: 'The kernel resides at the core of the OS and manages CPU scheduling, memory management, and hardware communication.',
      },
    ],
  });

  const fetchTeacherData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [examsRes, attemptsRes, coursesRes] = await Promise.all([
        apiGetTeacherExams().catch(() => ({ data: { exams: [] } })),
        apiGetAllTeacherAttempts().catch(() => ({ data: { attempts: [] } })),
        apiGetTeacherCourses().catch(() => ({ data: { courses: [] } })),
      ]);

      if (examsRes.data?.exams) {
        setExams(examsRes.data.exams);
      }
      if (attemptsRes.data?.attempts) {
        setAttempts(attemptsRes.data.attempts);
      }
      if (coursesRes.data?.courses) {
        const loadedCourses = coursesRes.data.courses;
        setCourses(loadedCourses);
        if (loadedCourses.length > 0 && !selectedCourseId) {
          setSelectedCourseId(loadedCourses[0].courseId);
          // Set default course for exam creation form if empty
          setNewExamForm((prev) => ({
            ...prev,
            courseId: loadedCourses[0].courseId,
            courseCode: loadedCourses[0].courseCode,
            slot: loadedCourses[0].slot || 'A1',
          }));
        }
      }
    } catch (err) {
      setError(err.message || 'Unable to load teacher workspace data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeacherData();
  }, []);

  // Publish / Draft Toggle
  const handleTogglePublish = async (examId, currentStatus) => {
    const nextStatus = currentStatus === 'published' ? 'draft' : 'published';
    try {
      const res = await apiTogglePublishExam(examId, nextStatus);
      if (res.success) {
        setExams((prev) =>
          prev.map((e) => (e._id === examId ? { ...e, status: nextStatus } : e))
        );
      }
    } catch (err) {
      console.error('Failed to update exam status:', err);
    }
  };

  // Delete Exam
  const handleDeleteExam = async (examId) => {
    if (!window.confirm('Are you sure you want to delete this examination?')) return;
    try {
      const res = await apiDeleteExam(examId);
      if (res.success) {
        setExams((prev) => prev.filter((e) => e._id !== examId));
      }
    } catch (err) {
      console.error('Failed to delete exam:', err);
    }
  };

  // Open Results Policy Modal
  const handleOpenPolicyModal = (examItem) => {
    setSelectedPolicyExam(examItem);
    const existing = examItem.resultsPolicy || {};
    setPolicyForm({
      releaseMode: existing.releaseMode || 'immediate',
      releaseDate: existing.releaseDate ? existing.releaseDate.slice(0, 16) : '',
      showScore: existing.showScore !== false,
      showCorrectAnswers: existing.showCorrectAnswers !== false,
      allowReview: existing.allowReview !== false,
      showExplanations: existing.showExplanations !== false,
      isResultsReleased: existing.isResultsReleased !== false,
    });
    setPolicySuccessMsg('');
  };

  // Save Results Policy
  const handleSavePolicySubmit = async (e) => {
    e.preventDefault();
    if (!selectedPolicyExam) return;
    setIsSavingPolicy(true);
    setPolicySuccessMsg('');

    try {
      const payload = {
        ...policyForm,
        releaseDate: policyForm.releaseDate ? new Date(policyForm.releaseDate).toISOString() : null,
      };
      const res = await apiUpdateExamResultsPolicy(selectedPolicyExam._id, payload);
      if (res.success && res.data?.exam) {
        setPolicySuccessMsg('Results and answer review visibility policy updated successfully!');
        setExams((prev) =>
          prev.map((ex) => (ex._id === selectedPolicyExam._id ? res.data.exam : ex))
        );
        setTimeout(() => {
          setSelectedPolicyExam(null);
        }, 1200);
      }
    } catch (err) {
      alert(err.message || 'Failed to update results policy');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // Open Proctoring Audit Modal
  const handleOpenAuditModal = async (attemptItem) => {
    setSelectedAuditAttempt(attemptItem);
    setIsAuditLoading(true);
    setAuditEvents([]);

    try {
      const res = await apiGetAttemptProctoringEvents(attemptItem._id);
      if (res.data?.events) {
        setAuditEvents(res.data.events);
      }
    } catch (err) {
      console.error('Failed to load telemetry events:', err);
    } finally {
      setIsAuditLoading(false);
    }
  };

  // Create Course & Slot
  const handleCreateCourseSubmit = async (e) => {
    e.preventDefault();
    setIsCreatingCourse(true);
    try {
      const res = await apiCreateCourse(newCourseForm);
      if (res.success && res.data?.course) {
        const created = res.data.course;
        setCourses((prev) => [...prev, created]);
        setSelectedCourseId(created.courseId);
        setShowCreateCourseModal(false);
        setNewCourseForm({ courseCode: '', title: '', slot: 'A1', description: '' });
      }
    } catch (err) {
      alert(err.message || 'Failed to create course');
    } finally {
      setIsCreatingCourse(false);
    }
  };

  // Add Single Student
  const handleAddStudentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCourseId) return;
    setIsEnrollingStudent(true);
    setEnrollmentMsg(null);

    try {
      const res = await apiEnrollStudentInCourse(selectedCourseId, newStudentForm);
      if (res.success && res.data?.course) {
        const updatedCourse = res.data.course;
        setCourses((prev) =>
          prev.map((c) => (c.courseId === selectedCourseId ? updatedCourse : c))
        );
        setEnrollmentMsg({
          type: res.data.isNewlyVerified ? 'success' : 'warning',
          text: res.message || 'Student enrolled successfully!',
        });
        setNewStudentForm({ rollNo: '', email: '' });
        setTimeout(() => {
          setShowAddStudentModal(false);
          setEnrollmentMsg(null);
        }, 1500);
      }
    } catch (err) {
      setEnrollmentMsg({ type: 'error', text: err.message || 'Failed to enroll student.' });
    } finally {
      setIsEnrollingStudent(false);
    }
  };

  // Parse CSV File for Bulk Enrollment
  const handleCsvFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setBulkErrors([]);
    setParsedBulkStudents([]);
    setBulkResultMsg(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;

      const lines = text.split(/\r\n|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 0) return;

      // Detect header row
      const firstLine = lines[0].toLowerCase();
      let startIndex = 0;
      let rollColIdx = 0;
      let emailColIdx = 1;

      if (firstLine.includes('roll') || firstLine.includes('reg') || firstLine.includes('email') || firstLine.includes('gmail')) {
        startIndex = 1;
        const headers = firstLine.split(/[,;\t]/).map((h) => h.trim());
        const foundEmail = headers.findIndex((h) => h.includes('email') || h.includes('gmail'));
        const foundRoll = headers.findIndex((h) => h.includes('roll') || h.includes('reg') || h.includes('id') || h.includes('number'));
        if (foundRoll !== -1) rollColIdx = foundRoll;
        if (foundEmail !== -1) emailColIdx = foundEmail;
      }

      const parsed = [];
      const errors = [];
      const seenRolls = new Set();
      const seenEmails = new Set();

      const activeCourse = courses.find((c) => c.courseId === selectedCourseId);
      const existingRoster = activeCourse?.studentRoster || [];
      const existingRolls = new Set(existingRoster.map((s) => s.rollNo?.toUpperCase()));
      const existingEmails = new Set(existingRoster.map((s) => s.email?.toLowerCase()));

      for (let i = startIndex; i < lines.length; i++) {
        const rowNum = i + 1;
        const parts = lines[i].split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
        const rollNo = (parts[rollColIdx] || '').toUpperCase();
        const email = (parts[emailColIdx] || '').toLowerCase();

        let rowError = null;
        if (!rollNo) {
          rowError = 'Missing registration number';
        } else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          rowError = 'Invalid email address';
        } else if (existingRolls.has(rollNo)) {
          rowError = `Registration #${rollNo} already enrolled in this course`;
        } else if (existingEmails.has(email)) {
          rowError = `Email ${email} already enrolled in this course`;
        } else if (seenRolls.has(rollNo)) {
          rowError = `Duplicate registration #${rollNo} in CSV file`;
        } else if (seenEmails.has(email)) {
          rowError = `Duplicate email ${email} in CSV file`;
        }

        if (rowError) {
          errors.push({ row: rowNum, rollNo, email, reason: rowError });
        } else {
          seenRolls.add(rollNo);
          seenEmails.add(email);
          parsed.push({ row: rowNum, rollNo, email });
        }
      }

      setParsedBulkStudents(parsed);
      setBulkErrors(errors);
    };
    reader.readAsText(file);
  };

  // Submit Bulk CSV Enrollment
  const handleBulkEnrollSubmit = async () => {
    if (!selectedCourseId || parsedBulkStudents.length === 0) return;
    setIsBulkEnrolling(true);
    setBulkResultMsg(null);

    try {
      const records = parsedBulkStudents.map((s) => ({ rollNo: s.rollNo, email: s.email }));
      const res = await apiBulkEnrollStudents(selectedCourseId, records);
      if (res.success && res.data) {
        const updatedCourse = res.data.course || {
          ...activeCourse,
          studentRoster: res.data.roster,
        };
        setCourses((prev) =>
          prev.map((c) => (c.courseId === selectedCourseId ? updatedCourse : c))
        );
        setBulkResultMsg({
          type: 'success',
          text: `Enrolled ${res.data.enrolledCount} verified students, ${res.data.pendingCount} pending verification invitations, ${res.data.skippedCount} skipped.`,
        });
        setTimeout(() => {
          setShowBulkUploadModal(false);
          setParsedBulkStudents([]);
          setCsvFile(null);
          setBulkResultMsg(null);
        }, 2200);
      }
    } catch (err) {
      setBulkResultMsg({ type: 'error', text: err.message || 'Bulk enrollment failed.' });
    } finally {
      setIsBulkEnrolling(false);
    }
  };

  // Remove Student Enrollment
  const handleRemoveStudent = async (identifier) => {
    if (!selectedCourseId) return;
    if (!window.confirm(`Are you sure you want to remove student enrollment (${identifier})?`)) return;

    try {
      const res = await apiRemoveStudentFromCourse(selectedCourseId, identifier);
      if (res.success && res.data?.course) {
        const updated = res.data.course;
        setCourses((prev) =>
          prev.map((c) => (c.courseId === selectedCourseId ? updated : c))
        );
      }
    } catch (err) {
      alert(err.message || 'Failed to remove student.');
    }
  };

  // Question Management in Create Exam Form
  const handleAddQuestion = () => {
    setNewExamForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          text: '',
          options: ['', '', '', ''],
          correctOptionIndex: 0,
          marks: 5,
          explanation: '',
        },
      ],
    }));
  };

  const handleRemoveQuestion = (idx) => {
    if (newExamForm.questions.length <= 1) return;
    setNewExamForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== idx),
    }));
  };

  const handleQuestionChange = (qIndex, field, value) => {
    setNewExamForm((prev) => {
      const qs = [...prev.questions];
      qs[qIndex] = { ...qs[qIndex], [field]: value };
      return { ...prev, questions: qs };
    });
  };

  const handleOptionChange = (qIndex, optIndex, value) => {
    setNewExamForm((prev) => {
      const qs = [...prev.questions];
      const opts = [...qs[qIndex].options];
      opts[optIndex] = value;
      qs[qIndex] = { ...qs[qIndex], options: opts };
      return { ...prev, questions: qs };
    });
  };

  // Create Exam Form Submission
  const handleCreateExamSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormSuccess('');

    try {
      const selectedCourse = courses.find((c) => c.courseId === newExamForm.courseId);

      const res = await apiCreateExam({
        ...newExamForm,
        courseCode: selectedCourse ? selectedCourse.courseCode : newExamForm.courseCode,
        courseTitle: selectedCourse ? selectedCourse.title : '',
        slot: selectedCourse ? selectedCourse.slot : newExamForm.slot,
        creatorEmail: user?.email || 'teacher@university.edu',
        startTime: newExamForm.startTime ? new Date(newExamForm.startTime).toISOString() : null,
        endTime: newExamForm.endTime ? new Date(newExamForm.endTime).toISOString() : null,
        resultsPolicy: {
          ...newExamForm.resultsPolicy,
          releaseDate: newExamForm.resultsPolicy.releaseDate ? new Date(newExamForm.resultsPolicy.releaseDate).toISOString() : null,
        },
      });

      if (res.success && res.data?.exam) {
        setFormSuccess('Examination scheduled and published successfully!');
        setExams((prev) => [res.data.exam, ...prev]);
        setTimeout(() => {
          navigate('/teacher/exams');
        }, 1200);
      }
    } catch (err) {
      alert(err.message || 'Failed to create exam');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Computed metrics
  const totalExams = exams.length;
  const activeExams = exams.filter((e) => e.status === 'published').length;
  const totalAttempts = attempts.length;
  const reviewFlagsCount = attempts.filter((a) => (a.riskScore || 0) >= 30).length;

  const activeCourse = courses.find((c) => c.courseId === selectedCourseId) || courses[0] || null;
  const activeRoster = activeCourse?.studentRoster || [];

  // Filtered roster for table
  const filteredRoster = activeRoster.filter((student) => {
    const matchesSearch =
      (student.rollNo || '').toLowerCase().includes(enrollmentSearch.toLowerCase()) ||
      (student.email || '').toLowerCase().includes(enrollmentSearch.toLowerCase()) ||
      (student.studentName || '').toLowerCase().includes(enrollmentSearch.toLowerCase());

    if (!matchesSearch) return false;

    if (enrollmentStatusFilter === 'enrolled') {
      return student.status === 'enrolled' || student.verifiedIdentity;
    }
    if (enrollmentStatusFilter === 'pending_verification') {
      return student.status === 'pending_verification' && !student.verifiedIdentity;
    }
    return true;
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Top Welcome Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2563EB] border border-blue-200 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5" />
              Instructor Portal
            </span>
            <span className="text-xs text-[#64748B]">
              Assigned Courses: {courses.length} sections
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#172033] tracking-tight">
            Teacher Workspace
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B]">
            Manage courses and slots, enroll verified students, author scheduled assessments, and control results release.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchTeacherData}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#172033] font-semibold text-xs border border-[#E2E8F0] shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#2563EB]' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>

          <Link
            to="/teacher/create-exam"
            className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-xs shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Exam</span>
          </Link>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-2 overflow-x-auto text-xs font-semibold">
        <Link
          to="/teacher"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isOverview
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Dashboard Overview
        </Link>
        <Link
          to="/teacher/courses"
          className={`px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1.5 ${
            isCoursesView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Courses & Students ({courses.length})</span>
        </Link>
        <Link
          to="/teacher/exams"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isExamsView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          My Exams ({exams.length})
        </Link>
        <Link
          to="/teacher/create-exam"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isCreateExamView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Create Exam
        </Link>
        <Link
          to="/teacher/results"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isResultsView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Student Results ({attempts.length})
        </Link>
        <Link
          to="/teacher/reports"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isReportsView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Proctoring Reports ({reviewFlagsCount} flagged)
        </Link>
        <Link
          to="/teacher/profile"
          className={`px-3.5 py-2 rounded-xl transition-colors ${
            isProfileView
              ? 'bg-[#2563EB] text-white shadow-xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-white'
          }`}
        >
          Profile
        </Link>
      </div>

      {/* OVERVIEW TAB */}
      {isOverview && (
        <div className="space-y-8">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-1">
              <span className="text-xs font-semibold text-[#64748B]">Assigned Courses</span>
              <div className="text-2xl font-bold text-[#172033]">{courses.length}</div>
              <p className="text-[11px] text-blue-600 font-medium">Distinct slots & sections</p>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-1">
              <span className="text-xs font-semibold text-[#64748B]">Total Assessments</span>
              <div className="text-2xl font-bold text-[#172033]">{totalExams}</div>
              <p className="text-[11px] text-emerald-600 font-medium">{activeExams} active & published</p>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-1">
              <span className="text-xs font-semibold text-[#64748B]">Candidate Attempts</span>
              <div className="text-2xl font-bold text-[#172033]">{totalAttempts}</div>
              <p className="text-[11px] text-[#64748B]">Recorded in DynamoDB</p>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs space-y-1">
              <span className="text-xs font-semibold text-[#64748B]">Flagged Proctored Sessions</span>
              <div className="text-2xl font-bold text-[#172033]">{reviewFlagsCount}</div>
              <p className="text-[11px] text-amber-600 font-medium">Requires instructor audit</p>
            </div>
          </div>

          {/* Quick Courses Section */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#172033]">Assigned Course Sections & Slots</h2>
                <p className="text-xs text-[#64748B]">Only courses assigned to you are displayed below.</p>
              </div>
              <Link
                to="/teacher/courses"
                className="text-xs font-semibold text-[#2563EB] hover:underline flex items-center gap-1"
              >
                <span>Manage Enrollments</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {courses.map((course) => (
                <div
                  key={course.courseId}
                  className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white hover:shadow-xs transition-all space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#2563EB]">
                        Slot {course.slot}
                      </span>
                      <h3 className="font-bold text-sm text-[#172033] mt-2">{course.title}</h3>
                      <p className="text-xs text-[#64748B] font-mono">{course.courseCode}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-[#64748B]">
                    <span>{(course.studentRoster || []).length} Enrolled</span>
                    <Link
                      to="/teacher/courses"
                      onClick={() => setSelectedCourseId(course.courseId)}
                      className="text-[#2563EB] font-semibold hover:underline"
                    >
                      Roster →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1. COURSES & STUDENT ENROLLMENT MANAGEMENT TAB */}
      {isCoursesView && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-[#172033]">Course Sections & Student Enrollment</h2>
              <p className="text-xs text-[#64748B]">
                View only your assigned courses and slots. Manage enrollment rosters, verify identities, and upload CSV batches.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCreateCourseModal(true)}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#172033] font-semibold text-xs border border-[#E2E8F0] shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#2563EB]" />
                <span>New Course & Slot</span>
              </button>
            </div>
          </div>

          {/* Assigned Course & Slot Selector Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {courses.map((course) => {
              const isSelected = course.courseId === selectedCourseId;
              const roster = course.studentRoster || [];
              const verifiedCount = roster.filter((s) => s.status === 'enrolled' || s.verifiedIdentity).length;
              const pendingCount = roster.filter((s) => s.status === 'pending_verification' && !s.verifiedIdentity).length;

              return (
                <div
                  key={course.courseId}
                  onClick={() => setSelectedCourseId(course.courseId)}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/60 border-[#2563EB] shadow-xs ring-2 ring-blue-500/20'
                      : 'bg-white border-[#E2E8F0] hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-blue-100 text-[#2563EB]">
                      Slot {course.slot}
                    </span>
                    <span className="text-xs font-mono font-bold text-[#64748B]">{course.courseCode}</span>
                  </div>
                  <h3 className="text-base font-extrabold text-[#172033] mt-2 line-clamp-1">{course.title}</h3>
                  <p className="text-xs text-[#64748B] mt-1 line-clamp-2">{course.description || 'Assigned academic slot curriculum.'}</p>

                  <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs font-semibold">
                    <span className="text-[#172033]">{roster.length} Students</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        {verifiedCount} Verified
                      </span>
                      {pendingCount > 0 && (
                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                          {pendingCount} Pending
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Course Section Student Roster Interface */}
          {activeCourse ? (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden space-y-4 p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-md bg-blue-100 text-[#2563EB]">
                      Slot {activeCourse.slot}
                    </span>
                    <h3 className="text-lg font-bold text-[#172033]">{activeCourse.title}</h3>
                  </div>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    Course Code: <span className="font-mono font-semibold">{activeCourse.courseCode}</span> • Instructor: {activeCourse.teacherEmail}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowAddStudentModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-blue-50 text-[#2563EB] hover:bg-blue-100 font-semibold text-xs border border-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Student</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowBulkUploadModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#2563EB] text-white hover:bg-blue-700 font-semibold text-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Bulk Upload CSV</span>
                  </button>
                </div>
              </div>

              {/* Search & Filter Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={enrollmentSearch}
                    onChange={(e) => setEnrollmentSearch(e.target.value)}
                    placeholder="Search by registration # or email..."
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#64748B] font-semibold flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5" /> Filter:
                  </span>
                  <select
                    value={enrollmentStatusFilter}
                    onChange={(e) => setEnrollmentStatusFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white text-xs font-semibold text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  >
                    <option value="all">All ({activeRoster.length})</option>
                    <option value="enrolled">Verified Enrolled</option>
                    <option value="pending_verification">Pending Identity Verification</option>
                  </select>
                </div>
              </div>

              {/* Roster Table */}
              {filteredRoster.length === 0 ? (
                <div className="py-12 text-center space-y-2 border border-dashed border-[#E2E8F0] rounded-xl bg-[#F8FAFC]">
                  <Users className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold text-[#172033]">No student enrollments found</p>
                  <p className="text-[11px] text-[#64748B]">Add a student using registration number and Gmail, or upload a CSV file.</p>
                </div>
              ) : (
                <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-semibold">
                      <tr>
                        <th className="py-3 px-4">Registration #</th>
                        <th className="py-3 px-4">Student Gmail / Email</th>
                        <th className="py-3 px-4">Identity Status</th>
                        <th className="py-3 px-4">Enrolled Date</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {filteredRoster.map((student, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#172033]">
                            {student.rollNo}
                          </td>
                          <td className="py-3 px-4 text-[#172033]">
                            <div>{student.email}</div>
                            {student.studentName && (
                              <span className="text-[10px] text-[#64748B]">{student.studentName}</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {student.status === 'enrolled' || student.verifiedIdentity ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span>Verified Student</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Account not yet created with this email. Invitation is pending.">
                                <Clock className="w-3 h-3 text-amber-600" />
                                <span>Pending Verification</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#64748B]">
                            {student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveStudent(student.email)}
                              className="text-rose-500 hover:text-rose-700 p-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Remove enrollment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 2. MY EXAMS TAB */}
      {isExamsView && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[#172033]">Active & Scheduled Assessments</h2>
              <p className="text-xs text-[#64748B]">
                Manage examination lifecycles, configure results visibility policies, and monitor candidate participation.
              </p>
            </div>
            <Link
              to="/teacher/create-exam"
              className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-xs shadow-xs flex items-center gap-1.5 transition-colors self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Exam</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {exams.map((exam) => {
              const policy = exam.resultsPolicy || {};
              return (
                <div
                  key={exam._id}
                  className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-[#2563EB] border border-blue-200">
                        {exam.courseCode} {exam.slot ? `• Slot ${exam.slot}` : ''}
                      </span>
                      <StatusBadge status={exam.status || 'draft'} size="sm" />
                    </div>

                    <div>
                      <h3 className="font-bold text-base text-[#172033] line-clamp-1">{exam.title}</h3>
                      <p className="text-xs text-[#64748B] line-clamp-2 mt-1">
                        {exam.description || 'Adaptive assessment with real-time biometric and behavioural telemetry.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-[#64748B] pt-2 border-t border-[#E2E8F0]">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{exam.durationMinutes} mins</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
                        <span>{exam.totalMarks || 10} marks</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{exam.startTime ? new Date(exam.startTime).toLocaleDateString() : 'Immediate'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-slate-400" />
                        <span>Max Attempts: {exam.maxAttempts || 1}</span>
                      </div>
                    </div>

                    {/* Results Policy Summary Pill */}
                    <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] space-y-1">
                      <div className="flex items-center justify-between font-semibold text-[#172033]">
                        <span>Results Release:</span>
                        <span className="uppercase text-[10px] text-[#2563EB] font-bold">
                          {policy.releaseMode || 'Immediate'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[#64748B]">
                        <span>Score: {policy.showScore !== false ? 'Shown' : 'Hidden'}</span>
                        <span>•</span>
                        <span>Answers: {policy.showCorrectAnswers !== false ? 'Shown' : 'Hidden'}</span>
                        <span>•</span>
                        <span>Review: {policy.allowReview !== false ? 'Allowed' : 'Off'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenPolicyModal(exam)}
                      className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-[11px] font-semibold text-[#172033] flex items-center gap-1 cursor-pointer"
                      title="Configure scores, correct answers, and review release policy"
                    >
                      <Sliders className="w-3 h-3 text-[#2563EB]" />
                      <span>Results Policy</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleTogglePublish(exam._id, exam.status)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                          exam.status === 'published'
                            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                        }`}
                      >
                        {exam.status === 'published' ? 'Unpublish' : 'Publish'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteExam(exam._id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Delete Exam"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. CREATE EXAM TAB */}
      {isCreateExamView && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs max-w-4xl space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-[#172033]">Create & Schedule Examination</h2>
            <p className="text-xs text-[#64748B]">
              Configure course assignment, slot timing, attempt limits, and independent results release policy.
            </p>
          </div>

          {formSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{formSuccess}</span>
            </div>
          )}

          <form onSubmit={handleCreateExamSubmit} className="space-y-6">
            {/* Section A: Course & Slot Association */}
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-[#2563EB]" />
                Course & Slot Assignment
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Select Assigned Course & Slot</label>
                  <select
                    value={newExamForm.courseId}
                    onChange={(e) => {
                      const cId = e.target.value;
                      const match = courses.find((c) => c.courseId === cId);
                      setNewExamForm({
                        ...newExamForm,
                        courseId: cId,
                        courseCode: match ? match.courseCode : newExamForm.courseCode,
                        slot: match ? match.slot : newExamForm.slot,
                      });
                    }}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  >
                    {courses.map((c) => (
                      <option key={c.courseId} value={c.courseId}>
                        {c.title} ({c.courseCode} - Slot {c.slot})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Examination Title</label>
                  <input
                    type="text"
                    value={newExamForm.title}
                    onChange={(e) => setNewExamForm({ ...newExamForm, title: e.target.value })}
                    placeholder="e.g. Midterm Evaluation - Heuristic Search Algorithms"
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#172033]">Examination Instructions</label>
                <textarea
                  value={newExamForm.instructions}
                  onChange={(e) => setNewExamForm({ ...newExamForm, instructions: e.target.value })}
                  placeholder="Specific student guidelines, permitted materials, and integrity expectations..."
                  rows="3"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
            </div>

            {/* Section B: Schedule & Attempt Limits */}
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#2563EB]" />
                Scheduling & Attempt Controls
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Start Date & Time</label>
                  <input
                    type="datetime-local"
                    value={newExamForm.startTime}
                    onChange={(e) => setNewExamForm({ ...newExamForm, startTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                  <span className="text-[10px] text-[#64748B]">Leave blank to open immediately</span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Test Duration (Minutes)</label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={newExamForm.durationMinutes}
                    onChange={(e) => setNewExamForm({ ...newExamForm, durationMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Optional Closing Date & Time</label>
                  <input
                    type="datetime-local"
                    value={newExamForm.endTime}
                    onChange={(e) => setNewExamForm({ ...newExamForm, endTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                  <span className="text-[10px] text-[#64748B]">Optional deadline for submissions</span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Maximum Attempts</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newExamForm.maxAttempts}
                    onChange={(e) => setNewExamForm({ ...newExamForm, maxAttempts: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Section C: Independent Results and Answer Review Visibility Controls */}
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#2563EB]" />
                Results & Answer Review Controls
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#172033]">Results Release Mode</label>
                  <select
                    value={newExamForm.resultsPolicy.releaseMode}
                    onChange={(e) =>
                      setNewExamForm({
                        ...newExamForm,
                        resultsPolicy: {
                          ...newExamForm.resultsPolicy,
                          releaseMode: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  >
                    <option value="immediate">Release Immediately upon Submission</option>
                    <option value="scheduled">Release on Specific Date & Time</option>
                    <option value="manual">Manual Release by Instructor</option>
                  </select>
                </div>

                {newExamForm.resultsPolicy.releaseMode === 'scheduled' && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#172033]">Scheduled Release Date & Time</label>
                    <input
                      type="datetime-local"
                      value={newExamForm.resultsPolicy.releaseDate}
                      onChange={(e) =>
                        setNewExamForm({
                          ...newExamForm,
                          resultsPolicy: {
                            ...newExamForm.resultsPolicy,
                            releaseDate: e.target.value,
                          },
                        })
                      }
                      className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Independent Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={newExamForm.resultsPolicy.showScore}
                    onChange={(e) =>
                      setNewExamForm({
                        ...newExamForm,
                        resultsPolicy: {
                          ...newExamForm.resultsPolicy,
                          showScore: e.target.checked,
                        },
                      })
                    }
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[#172033] block">Show Scores & Marks</span>
                    <span className="text-[11px] text-[#64748B] block">Allows students to see their total and earned marks.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={newExamForm.resultsPolicy.showCorrectAnswers}
                    onChange={(e) =>
                      setNewExamForm({
                        ...newExamForm,
                        resultsPolicy: {
                          ...newExamForm.resultsPolicy,
                          showCorrectAnswers: e.target.checked,
                        },
                      })
                    }
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[#172033] block">Show Correct Answers</span>
                    <span className="text-[11px] text-[#64748B] block">Reveals correct choices in answer review.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={newExamForm.resultsPolicy.allowReview}
                    onChange={(e) =>
                      setNewExamForm({
                        ...newExamForm,
                        resultsPolicy: {
                          ...newExamForm.resultsPolicy,
                          allowReview: e.target.checked,
                        },
                      })
                    }
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[#172033] block">Allow Answer Review</span>
                    <span className="text-[11px] text-[#64748B] block">Enables candidates to review question responses.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={newExamForm.resultsPolicy.showExplanations}
                    onChange={(e) =>
                      setNewExamForm({
                        ...newExamForm,
                        resultsPolicy: {
                          ...newExamForm.resultsPolicy,
                          showExplanations: e.target.checked,
                        },
                      })
                    }
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[#172033] block">Show Explanations</span>
                    <span className="text-[11px] text-[#64748B] block">Displays instructor rationale for answers.</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Questions Authoring Section */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#172033]">Question Items ({newExamForm.questions.length})</h3>
                  <p className="text-[11px] text-[#64748B]">Add items, select the correct option, and provide optional rationale.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="px-3 py-1.5 rounded-xl bg-blue-50 text-[#2563EB] hover:bg-blue-100 font-semibold text-xs border border-blue-200 flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add Question</span>
                </button>
              </div>

              <div className="space-y-4">
                {newExamForm.questions.map((q, qIdx) => (
                  <div key={qIdx} className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#172033]">Question #{qIdx + 1}</span>
                      {newExamForm.questions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(qIdx)}
                          className="text-xs text-rose-500 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
                        >
                          <MinusCircle className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>

                    <input
                      type="text"
                      value={q.text}
                      onChange={(e) => handleQuestionChange(qIdx, 'text', e.target.value)}
                      placeholder="Enter question text here..."
                      className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      required
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {q.options.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct_${qIdx}`}
                            checked={q.correctOptionIndex === optIdx}
                            onChange={() => handleQuestionChange(qIdx, 'correctOptionIndex', optIdx)}
                            className="text-[#2563EB] focus:ring-[#2563EB]"
                            title="Mark as correct answer"
                          />
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => handleOptionChange(qIdx, optIdx, e.target.value)}
                            placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-xs text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                            required
                          />
                        </div>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={q.explanation || ''}
                      onChange={(e) => handleQuestionChange(qIdx, 'explanation', e.target.value)}
                      placeholder="Explanation / solution rationale (optional)..."
                      className="w-full px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-[11px] text-[#64748B] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2E8F0] flex justify-end gap-3">
              <Link
                to="/teacher/exams"
                className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
              >
                {isSubmitting ? 'Saving Examination...' : 'Publish Examination'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. STUDENT RESULTS TAB */}
      {isResultsView && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-[#172033]">Candidate Results & Submissions</h2>
            <p className="text-xs text-[#64748B]">All completed student examination submissions across your course roster.</p>
          </div>

          {attempts.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 text-center space-y-2">
              <p className="text-xs text-[#64748B]">No candidate submissions recorded yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4">Course Section</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Passing Result</th>
                    <th className="py-3 px-4">Proctoring Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {attempts.map((att) => (
                    <tr key={att._id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[#172033]">
                        <div>{att.student?.name || att.studentName || 'Student Candidate'}</div>
                        <span className="text-[11px] text-[#64748B] font-normal">{att.student?.email || att.studentEmail || 'candidate@gmail.com'}</span>
                      </td>
                      <td className="py-3.5 px-4 text-[#172033]">
                        <span className="font-semibold block">{att.exam?.title || att.examTitle || 'Examination'}</span>
                        <span className="text-[11px] text-[#64748B]">{att.courseCode || 'CSE-101'} {att.slot ? `(Slot ${att.slot})` : ''}</span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-[#172033]">
                        {att.score} / {att.totalMarks || att.exam?.totalMarks || 20}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                          att.isPassed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {att.isPassed ? 'Passed' : 'Failed'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={att.riskLevel || 'LOW'} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 5. PROCTORING REPORTS TAB */}
      {isReportsView && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-[#172033]">Proctoring Reports & Risk Review</h2>
            <p className="text-xs text-[#64748B]">
              Objective biometric telemetry logs, facial verification evidence, and calibrated risk indicators to support manual instructor reviews.
            </p>
          </div>

          {attempts.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 text-center space-y-2">
              <p className="text-xs text-[#64748B]">No proctoring reports available yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-3 px-4">Candidate</th>
                    <th className="py-3 px-4">Examination</th>
                    <th className="py-3 px-4">Risk Level</th>
                    <th className="py-3 px-4">Current Risk Score</th>
                    <th className="py-3 px-4 text-right">Audit Forensics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {attempts.map((att) => (
                    <tr key={att._id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[#172033]">
                        {att.student?.name || att.studentName || 'Student Candidate'}
                        <span className="block text-[11px] text-[#64748B] font-normal">{att.student?.email || att.studentEmail}</span>
                      </td>
                      <td className="py-3.5 px-4 text-[#172033]">
                        {att.exam?.title || att.examTitle || 'Examination'}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={att.riskLevel || 'LOW'} size="sm" />
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-[#172033]">
                        {att.riskScore || att.currentRiskScore || 0} / 100
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenAuditModal(att)}
                          className="px-3 py-1.5 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 font-semibold text-xs border border-blue-200 transition-colors cursor-pointer"
                        >
                          View Telemetry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 6. PROFILE TAB */}
      {isProfileView && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs max-w-2xl space-y-4">
          <h2 className="text-xl font-bold text-[#172033]">Instructor Profile</h2>
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 text-xs">
            <div><span className="font-bold text-[#172033]">Name:</span> {user?.name || 'Academic Instructor'}</div>
            <div><span className="font-bold text-[#172033]">Email:</span> {user?.email}</div>
            <div><span className="font-bold text-[#172033]">Role:</span> Certified Academic Instructor</div>
            <div><span className="font-bold text-[#172033]">Active Courses:</span> {courses.map((c) => `${c.courseCode} (${c.slot})`).join(', ')}</div>
          </div>
        </div>
      )}

      {/* MODAL 1: Create Course & Slot */}
      {showCreateCourseModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-md w-full space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-[#172033]">Assign New Course Section & Slot</h3>
              <button
                type="button"
                onClick={() => setShowCreateCourseModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCourseSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[#172033]">Course Title</label>
                <input
                  type="text"
                  value={newCourseForm.title}
                  onChange={(e) => setNewCourseForm({ ...newCourseForm, title: e.target.value })}
                  placeholder="e.g. Distributed Database Engineering"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[#172033]">Course Code</label>
                  <input
                    type="text"
                    value={newCourseForm.courseCode}
                    onChange={(e) => setNewCourseForm({ ...newCourseForm, courseCode: e.target.value })}
                    placeholder="e.g. CSE-501"
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] uppercase focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[#172033]">Assigned Slot</label>
                  <select
                    value={newCourseForm.slot}
                    onChange={(e) => setNewCourseForm({ ...newCourseForm, slot: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  >
                    <option value="A1">Slot A1</option>
                    <option value="A2">Slot A2</option>
                    <option value="B1">Slot B1</option>
                    <option value="B2">Slot B2</option>
                    <option value="C1">Slot C1</option>
                    <option value="C2">Slot C2</option>
                    <option value="D1">Slot D1</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#172033]">Description (Optional)</label>
                <textarea
                  value={newCourseForm.description}
                  onChange={(e) => setNewCourseForm({ ...newCourseForm, description: e.target.value })}
                  placeholder="Course topics, slot timing, and lab schedule..."
                  rows="2"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateCourseModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCourse}
                  className="px-5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold cursor-pointer"
                >
                  {isCreatingCourse ? 'Assigning...' : 'Assign Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add Single Student */}
      {showAddStudentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[#172033]">Enroll Student Candidate</h3>
                <p className="text-[11px] text-[#64748B]">Course: {activeCourse?.title} (Slot {activeCourse?.slot})</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddStudentModal(false);
                  setEnrollmentMsg(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {enrollmentMsg && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                enrollmentMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                enrollmentMsg.type === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {enrollmentMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{enrollmentMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleAddStudentSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[#172033]">Student Registration # (Roll Number)</label>
                <input
                  type="text"
                  value={newStudentForm.rollNo}
                  onChange={(e) => setNewStudentForm({ ...newStudentForm, rollNo: e.target.value })}
                  placeholder="e.g. 21BCE1042"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#172033]">Student Gmail / Email Address</label>
                <input
                  type="email"
                  value={newStudentForm.email}
                  onChange={(e) => setNewStudentForm({ ...newStudentForm, email: e.target.value })}
                  placeholder="student@gmail.com"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
                <span className="text-[10px] text-[#64748B]">
                  System checks against verified candidate profiles. If not yet registered, an invitation is recorded.
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEnrollingStudent}
                  className="px-5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold cursor-pointer"
                >
                  {isEnrollingStudent ? 'Enrolling...' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Bulk Upload CSV */}
      {showBulkUploadModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[#172033]">Bulk Enroll Students via CSV</h3>
                <p className="text-[11px] text-[#64748B]">Course: {activeCourse?.title} (Slot {activeCourse?.slot})</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBulkUploadModal(false);
                  setParsedBulkStudents([]);
                  setCsvFile(null);
                  setBulkResultMsg(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {bulkResultMsg && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                bulkResultMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {bulkResultMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{bulkResultMsg.text}</span>
              </div>
            )}

            {/* CSV File Input */}
            <div className="p-6 rounded-2xl border-2 border-dashed border-[#E2E8F0] bg-[#F8FAFC] text-center space-y-2">
              <Upload className="w-8 h-8 text-[#2563EB] mx-auto" />
              <div>
                <label className="text-xs font-bold text-[#2563EB] hover:underline cursor-pointer">
                  <span>Click to select CSV file</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFileChange}
                    className="hidden"
                  />
                </label>
                <p className="text-[11px] text-[#64748B] mt-1">Expected columns: RollNumber (Registration #), Gmail / Email</p>
              </div>
              {csvFile && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-100 text-[#2563EB] text-xs font-semibold">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>

            {/* Validation / Error Summary */}
            {bulkErrors.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-xs text-amber-800">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>{bulkErrors.length} Invalid / Duplicate rows detected (will be skipped):</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 text-[11px] max-h-24 overflow-y-auto">
                  {bulkErrors.map((err, idx) => (
                    <li key={idx}>Row {err.row}: {err.rollNo || 'Empty'} ({err.email || 'Empty'}) — {err.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Live Preview Table */}
            {parsedBulkStudents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-[#172033]">
                  <span>Valid Candidates Ready to Enroll ({parsedBulkStudents.length})</span>
                  <span className="text-emerald-600 text-[11px]">Ready for batch import</span>
                </div>
                <div className="border border-[#E2E8F0] rounded-xl overflow-hidden max-h-48 overflow-y-auto text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] sticky top-0">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Registration #</th>
                        <th className="py-2 px-3">Gmail / Email</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {parsedBulkStudents.map((s, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-3 text-[#64748B]">{s.row}</td>
                          <td className="py-1.5 px-3 font-mono font-bold text-[#172033]">{s.rollNo}</td>
                          <td className="py-1.5 px-3 text-[#172033]">{s.email}</td>
                          <td className="py-1.5 px-3 text-emerald-600 font-semibold">Valid</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowBulkUploadModal(false)}
                className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkEnrollSubmit}
                disabled={isBulkEnrolling || parsedBulkStudents.length === 0}
                className="px-5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold cursor-pointer"
              >
                {isBulkEnrolling ? 'Enrolling Batch...' : `Enroll ${parsedBulkStudents.length} Students`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Results & Answer Review Visibility Policy */}
      {selectedPolicyExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-lg w-full space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[#172033]">Results & Answer Review Controls</h3>
                <p className="text-xs text-[#64748B]">{selectedPolicyExam.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPolicyExam(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {policySuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{policySuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleSavePolicySubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[#172033]">Results Release Mode</label>
                <select
                  value={policyForm.releaseMode}
                  onChange={(e) => setPolicyForm({ ...policyForm, releaseMode: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  <option value="immediate">Release Immediately upon Submission</option>
                  <option value="scheduled">Release on Specific Date & Time</option>
                  <option value="manual">Manual Instructor Release (Hidden until explicitly released)</option>
                </select>
              </div>

              {policyForm.releaseMode === 'scheduled' && (
                <div className="space-y-1">
                  <label className="font-semibold text-[#172033]">Scheduled Release Date & Time</label>
                  <input
                    type="datetime-local"
                    value={policyForm.releaseDate}
                    onChange={(e) => setPolicyForm({ ...policyForm, releaseDate: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>
              )}

              {policyForm.releaseMode === 'manual' && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-[#172033] block">Manual Release Toggle</span>
                    <span className="text-[11px] text-[#64748B] block">
                      Currently: {policyForm.isResultsReleased ? 'Results are RELEASED to students' : 'Results are HIDDEN from students'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPolicyForm({ ...policyForm, isResultsReleased: !policyForm.isResultsReleased })}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs ${
                      policyForm.isResultsReleased
                        ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {policyForm.isResultsReleased ? 'Hide Results' : 'Release Now'}
                  </button>
                </div>
              )}

              {/* Independent Toggles */}
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] cursor-pointer hover:bg-white">
                  <input
                    type="checkbox"
                    checked={policyForm.showScore}
                    onChange={(e) => setPolicyForm({ ...policyForm, showScore: e.target.checked })}
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="font-bold text-[#172033] block">Show Scores</span>
                    <span className="text-[11px] text-[#64748B]">When unchecked, students cannot see numerical marks.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] cursor-pointer hover:bg-white">
                  <input
                    type="checkbox"
                    checked={policyForm.showCorrectAnswers}
                    onChange={(e) => setPolicyForm({ ...policyForm, showCorrectAnswers: e.target.checked })}
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="font-bold text-[#172033] block">Show Correct Answers</span>
                    <span className="text-[11px] text-[#64748B]">When unchecked, correct options are masked from API responses.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] cursor-pointer hover:bg-white">
                  <input
                    type="checkbox"
                    checked={policyForm.allowReview}
                    onChange={(e) => setPolicyForm({ ...policyForm, allowReview: e.target.checked })}
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="font-bold text-[#172033] block">Allow Answer Review</span>
                    <span className="text-[11px] text-[#64748B]">When unchecked, question-by-question review is blocked.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] cursor-pointer hover:bg-white">
                  <input
                    type="checkbox"
                    checked={policyForm.showExplanations}
                    onChange={(e) => setPolicyForm({ ...policyForm, showExplanations: e.target.checked })}
                    className="w-4 h-4 text-[#2563EB] rounded focus:ring-[#2563EB]"
                  />
                  <div>
                    <span className="font-bold text-[#172033] block">Show Explanations</span>
                    <span className="text-[11px] text-[#64748B]">When unchecked, solution rationales are omitted.</span>
                  </div>
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPolicyExam(null)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPolicy}
                  className="px-5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold cursor-pointer"
                >
                  {isSavingPolicy ? 'Saving Policy...' : 'Save Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Proctoring Telemetry Forensic Audit */}
      {selectedAuditAttempt && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xl max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div>
                <h3 className="font-bold text-base text-[#172033]">Candidate Biometric Telemetry Audit</h3>
                <p className="text-xs text-[#64748B]">
                  Session: {selectedAuditAttempt.sessionId || selectedAuditAttempt._id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuditAttempt(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isAuditLoading ? (
              <div className="py-12 text-center text-xs text-[#64748B] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#2563EB]" />
                <span>Retrieving telemetry events from DynamoDB...</span>
              </div>
            ) : auditEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#64748B]">
                No anomalous flagged events recorded for this session. Candidate maintained baseline compliance.
              </div>
            ) : (
              <div className="space-y-3">
                {auditEvents.map((evt, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#172033] uppercase text-[11px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200">
                        {evt.eventType || 'PROCTORING_ALERT'}
                      </span>
                      <span className="text-[11px] text-[#64748B]">
                        {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : 'N/A'}
                      </span>
                    </div>
                    <p className="text-[#172033]">{evt.details || 'Biometric anomaly detected during candidate frame analysis.'}</p>
                    <div className="flex items-center gap-3 text-[11px] text-[#64748B]">
                      <span>Confidence: {evt.confidence || 95}%</span>
                      <span>Severity: {evt.severity || 'HIGH'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
