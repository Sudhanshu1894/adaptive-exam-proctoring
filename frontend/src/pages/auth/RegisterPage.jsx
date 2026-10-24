import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ShieldCheck,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  GraduationCap,
  Briefcase,
  CheckCircle2,
  KeyRound,
  RotateCw,
  ArrowRight,
  Info,
} from 'lucide-react';

export const RegisterPage = () => {
  const [role, setRole] = useState('student'); // 'student' | 'teacher'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [department, setDepartment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Step 2: Dedicated Verification Step
  const [isVerificationStep, setIsVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [verificationSuccess, setVerificationSuccess] = useState('');

  const { register, confirmAccount, adminConfirmAccount, resendCode } = useAuth();
  const navigate = useNavigate();

  const sanitizeErrorMessage = (rawError) => {
    if (!rawError) return 'An unexpected registration error occurred.';
    if (typeof rawError !== 'string') return rawError.message || 'Error occurred.';

    if (rawError.includes('UsernameExistsException') || rawError.includes('already exists')) {
      return 'An account with this email address already exists. Please sign in or verify your existing account.';
    }
    if (rawError.includes('InvalidPasswordException')) {
      return 'Password must be at least 8 characters long and contain uppercase, lowercase, numbers, and symbols.';
    }
    if (rawError.includes('CodeMismatchException')) {
      return 'Invalid verification code. Please check the code in your email and try again.';
    }
    if (rawError.includes('ExpiredCodeException')) {
      return 'Verification code has expired. Please click Resend Code to receive a new one.';
    }

    return rawError;
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !email.trim() || !password) {
      setFormError('Please fill in all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);
    const result = await register({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      studentId: role === 'student' ? studentId.trim() : null,
      department: department.trim() || null,
    });
    setIsSubmitting(false);

    if (result.success) {
      if (result.isConfirmed) {
        // Already confirmed by directory
        navigate('/login', { replace: true });
      } else {
        // Transition to dedicated verification step
        setIsVerificationStep(true);
      }
    } else {
      setFormError(sanitizeErrorMessage(result.error));
    }
  };

  const handleVerifySubmit = async (e) => {
    e.preventDefault();
    setVerificationError('');
    setVerificationSuccess('');

    if (!verificationCode.trim()) {
      setVerificationError('Please enter the 6-digit confirmation code.');
      return;
    }

    setVerificationLoading(true);
    const res = await confirmAccount(email.trim(), verificationCode.trim());
    setVerificationLoading(false);

    if (res.success) {
      setVerificationSuccess('Account confirmed successfully! Redirecting to sign in...');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
    } else {
      setVerificationError(sanitizeErrorMessage(res.error));
    }
  };

  const handleResendCode = async () => {
    setVerificationError('');
    setVerificationSuccess('');

    setVerificationLoading(true);
    const res = await resendCode(email.trim());
    setVerificationLoading(false);

    if (res.success) {
      setVerificationSuccess('A fresh verification code has been dispatched to your email.');
    } else {
      setVerificationError(sanitizeErrorMessage(res.error));
    }
  };

  const handleInstantVerify = async () => {
    setVerificationError('');
    setVerificationSuccess('');
    setVerificationLoading(true);
    const res = await adminConfirmAccount(email.trim());
    setVerificationLoading(false);

    if (res.success) {
      setVerificationSuccess('Account confirmed successfully! Redirecting to sign in...');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
    } else {
      setVerificationError(sanitizeErrorMessage(res.error || 'Direct verification failed.'));
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 bg-[#F8FAFC]">
      <div className="w-full max-w-md space-y-6">

        {/* Page Title & Subtitle */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2563EB] text-white shadow-xs mx-auto">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#172033]">
            {isVerificationStep ? 'Verify Your Email' : 'Create an Account'}
          </h1>
          <p className="text-sm text-[#64748B]">
            {isVerificationStep
              ? `Enter the 6-digit code sent to ${email}`
              : 'Join the AdaptiveExam assessment platform'}
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">

          {!isVerificationStep ? (
            <>
              {/* Account Type Toggle */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#64748B] block">
                  Account Type
                </label>
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setRole('student')}
                    className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      role === 'student'
                        ? 'bg-[#2563EB] text-white shadow-xs'
                        : 'text-[#64748B] hover:text-[#172033]'
                    }`}
                  >
                    <GraduationCap className="w-4 h-4" />
                    <span>Student</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('teacher')}
                    className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      role === 'teacher'
                        ? 'bg-[#2563EB] text-white shadow-xs'
                        : 'text-[#64748B] hover:text-[#172033]'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    <span>Teacher</span>
                  </button>
                </div>
              </div>

              {/* Informational Note for Teachers */}
              {role === 'teacher' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Teacher accounts undergo institutional role verification before access to examination creation is activated.
                  </span>
                </div>
              )}

              {/* Error Alert */}
              {formError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span className="flex-1">{formError}</span>
                </div>
              )}

              {/* Registration Form */}
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#172033] block">
                    Full name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-[#172033] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB] text-sm transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#172033] block">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@university.edu"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-[#172033] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB] text-sm transition-all"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#172033] block">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-[#172033] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB] text-sm transition-all"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#172033] block">
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-[#172033] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB] text-sm transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-sm shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <span>Create Account</span>
                  )}
                </button>
              </form>

              {/* Link back to Sign In */}
              <div className="text-center pt-2 text-xs sm:text-sm text-[#64748B] border-t border-[#E2E8F0]">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="text-[#2563EB] hover:text-blue-700 font-semibold hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </>
          ) : (
            /* Dedicated Verification Screen */
            <div className="space-y-5">
              <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-start gap-2.5">
                <KeyRound className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
                <span>
                  A 6-digit confirmation code was sent to <strong className="text-[#172033]">{email}</strong>. Enter it below to confirm your account.
                </span>
              </div>

              {verificationSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>{verificationSuccess}</span>
                </div>
              )}

              {verificationError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{verificationError}</span>
                </div>
              )}

              <form onSubmit={handleVerifySubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#172033] block">
                    6-digit confirmation code
                  </label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-base text-[#172033] font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={verificationLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-sm shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {verificationLoading ? 'Confirming...' : 'Confirm Email'}
                </button>
              </form>

              {/* Spam folder notification & Direct Verification fallback */}
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-2 text-xs text-amber-900">
                <p className="flex items-start gap-1.5 leading-relaxed">
                  <span className="font-bold">Notice:</span> AWS confirmation emails are dispatched from <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px] font-mono">no-reply@verificationemail.com</code>. Please check your <strong>Spam / Junk</strong> folder if you do not see the OTP.
                </p>
                <div className="pt-1 border-t border-amber-200/50 flex items-center justify-between">
                  <span className="text-[11px] text-amber-800">Didn't receive email code?</span>
                  <button
                    type="button"
                    onClick={handleInstantVerify}
                    disabled={verificationLoading}
                    className="text-[#2563EB] hover:underline font-semibold text-[11px] disabled:opacity-50"
                  >
                    Direct Instant Verification
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] text-xs">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={verificationLoading}
                  className="text-[#2563EB] hover:underline flex items-center gap-1 font-medium disabled:opacity-50 cursor-pointer"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${verificationLoading ? 'animate-spin' : ''}`} />
                  <span>Resend Code</span>
                </button>

                <Link
                  to="/login"
                  className="text-[#64748B] hover:text-[#172033] hover:underline"
                >
                  Back to Sign In
                </Link>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default RegisterPage;
