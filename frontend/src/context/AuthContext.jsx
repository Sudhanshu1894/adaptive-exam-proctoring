import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  signInCognito,
  signUpCognito,
  confirmSignUpCognito,
  resendConfirmationCodeCognito,
  forgotPasswordCognito,
  confirmNewPasswordCognito,
  signOutCognito,
} from '../services/cognitoAuth.service';
import {
  apiGetMe,
  apiLogin,
  apiRegister,
  apiValidateCognitoSession,
  apiExchangeCognitoCode,
  apiConfirmCognitoAccount,
  apiAdminConfirmCognitoAccount,
} from '../services/api';

const AuthContext = createContext(null);

// Global in-memory set of redeemed authorization codes across re-renders/StrictMode
const redeemedAuthCodes = new Set();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('adaptive_exam_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize and validate existing session on mount
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      // 1. Check for incoming Authorization Code from AWS Cognito Hosted UI (?code=...)
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const errorParam = urlParams.get('error');

        // Immediately scrub the code/error from the browser address bar to prevent reload re-submission
        if (code || errorParam) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (code && !redeemedAuthCodes.has(code)) {
          const redemptionKey = `cognito_code_redeemed_${code}`;
          if (!sessionStorage.getItem(redemptionKey)) {
            redeemedAuthCodes.add(code);
            sessionStorage.setItem(redemptionKey, 'true');

            try {
              setIsLoading(true);
              const res = await apiExchangeCognitoCode({
                code,
                redirectUri: window.location.origin + '/',
              });

              if (isMounted && res.success && res.data?.token) {
                const receivedToken = res.data.token;
                const receivedUser = res.data.user;
                localStorage.setItem('adaptive_exam_token', receivedToken);
                setToken(receivedToken);
                setUser(receivedUser);
                setIsLoading(false);
                return;
              }
            } catch (exchangeErr) {
              // Dev-only diagnostic logging without exposing sensitive data
              if (import.meta.env.DEV) {
                console.info('[Cognito Auth Code Exchange Diagnostic]:', exchangeErr.message || 'Authorization code was already consumed or expired.');
              }
            }
          }
        }
      }

      // 2. Validate existing token from storage
      const storedToken = localStorage.getItem('adaptive_exam_token');
      if (storedToken) {
        try {
          const res = await apiGetMe();
          if (isMounted && res.success && res.data?.user) {
            setUser(res.data.user);
          } else {
            handleLogoutClean();
          }
        } catch {
          handleLogoutClean();
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogoutClean = () => {
    localStorage.removeItem('adaptive_exam_token');
    setToken(null);
    setUser(null);
  };

  /**
   * Seamless AWS Cognito + Institutional RBAC Login
   * Strategy 1: Attempts direct SRP authentication via Amazon Cognito User Pool.
   * Strategy 2: If user belongs to directory / institutional credentials, validates via backend API.
   * Role enforcement: Verifies that user's authorized role matches the intended workspace.
   */
  const login = async (email, password, intendedRole = 'student') => {
    setError(null);
    setIsLoading(true);

    const cleanEmail = (email || '').trim().toLowerCase();

    try {
      // 1. Direct AWS Cognito User Pool Authentication (SRP protocol)
      let directCognitoToken = null;
      let isAccountUnconfirmed = false;

      try {
        const cognitoResult = await signInCognito({ email: cleanEmail, password });
        if (cognitoResult.success && cognitoResult.idToken) {
          directCognitoToken = cognitoResult.idToken;
        } else if (cognitoResult.isUnconfirmed) {
          isAccountUnconfirmed = true;
        }
      } catch (cognitoDirectErr) {
        if (import.meta.env.DEV) {
          console.info('[Cognito SRP Check Note]: Falling back to institutional credentials handler');
        }
      }

      // Handle unconfirmed email
      if (isAccountUnconfirmed) {
        setIsLoading(false);
        const unconfirmedMsg = 'Your account has not been confirmed yet. Please verify your email with the 6-digit confirmation code.';
        setError(unconfirmedMsg);
        return {
          success: false,
          isUnconfirmed: true,
          email: cleanEmail,
          error: unconfirmedMsg,
        };
      }

      // If direct Cognito sign-in succeeded, validate role against backend
      if (directCognitoToken) {
        localStorage.setItem('adaptive_exam_token', directCognitoToken);
        setToken(directCognitoToken);

        try {
          const sessionRes = await apiValidateCognitoSession(intendedRole);
          if (sessionRes.success && sessionRes.data?.user) {
            const authUser = sessionRes.data.user;
            setUser(authUser);
            setIsLoading(false);
            return {
              success: true,
              user: authUser,
              role: authUser.role,
            };
          }
        } catch (roleErr) {
          handleLogoutClean();
          signOutCognito();
          setIsLoading(false);
          const roleErrorMsg =
            roleErr.response?.data?.error?.message ||
            roleErr.message ||
            `Access restricted: You do not have permissions for the ${intendedRole} workspace.`;
          setError(roleErrorMsg);
          return {
            success: false,
            isRoleMismatch: true,
            error: roleErrorMsg,
          };
        }
      }

      // 2. Institutional Directory / Backend Synchronized Login
      try {
        const apiRes = await apiLogin({ email: cleanEmail, password, role: intendedRole });
        if (apiRes.success && apiRes.data?.token) {
          const userObj = apiRes.data.user;
          const userToken = apiRes.data.token;

          // Check role alignment
          if (intendedRole === 'teacher' && userObj.role !== 'teacher' && userObj.role !== 'proctor') {
            handleLogoutClean();
            setIsLoading(false);
            const roleMismatchMsg = 'Access Denied: This account is registered as a student. Please sign in to the Student Arena.';
            setError(roleMismatchMsg);
            return { success: false, isRoleMismatch: true, error: roleMismatchMsg };
          }

          localStorage.setItem('adaptive_exam_token', userToken);
          setToken(userToken);
          setUser(userObj);
          setIsLoading(false);

          return {
            success: true,
            user: userObj,
            role: userObj.role,
          };
        }
      } catch (backendErr) {
        handleLogoutClean();
        setIsLoading(false);
        const isUnconfirmed =
          backendErr.response?.data?.isUnconfirmed === true ||
          backendErr.response?.data?.error?.code === 'UserNotConfirmedException';
        const backendMsg =
          backendErr.response?.data?.error?.message ||
          backendErr.message ||
          "We couldn't sign you in. Please check your email and password and try again.";
        setError(backendMsg);
        return {
          success: false,
          isUnconfirmed,
          email: cleanEmail,
          error: backendMsg,
        };
      }

      // Fallback clean message
      handleLogoutClean();
      setIsLoading(false);
      const generalErr = "We couldn't sign you in. Please check your email and password and try again.";
      setError(generalErr);
      return { success: false, error: generalErr };
    } catch (unexpectedErr) {
      handleLogoutClean();
      setIsLoading(false);
      if (import.meta.env.DEV) {
        console.error('[Auth Diagnostic Error]:', unexpectedErr.message || unexpectedErr);
      }
      const genericMsg = "We couldn't sign you in. Please try again.";
      setError(genericMsg);
      return { success: false, error: genericMsg };
    }
  };

  /**
   * Real AWS Cognito Account Registration
   */
  const register = async ({ name, email, password, role = 'student', studentId = null, department = null }) => {
    setError(null);
    try {
      const result = await signUpCognito({ name, email, password, role });
      if (!result.success) {
        setError(result.message);
        return { success: false, error: result.message };
      }

      // Also persist registration intent & profile to institutional directory
      try {
        await apiRegister({
          name,
          email,
          password,
          role,
          studentId,
          department,
          cognitoSub: result.userSub || null,
        });
      } catch (dirErr) {
        if (import.meta.env.DEV) {
          console.info('[Directory registration sync notice]:', dirErr.message);
        }
      }

      return {
        success: true,
        userSub: result.userSub,
        email: result.email,
        isConfirmed: result.userConfirmed,
      };
    } catch (err) {
      const msg = err.message || 'Failed to register account.';
      setError(msg);
      return { success: false, error: msg };
    }
  };

  /**
   * Confirm account with 6-digit email code
   */
  const confirmAccount = async (email, code) => {
    setError(null);
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      // 1. Try direct AWS Cognito client confirmation
      let directRes = await confirmSignUpCognito({ email: cleanEmail, code });

      // 2. Also notify backend to update local/Dynamo database record
      try {
        await apiConfirmCognitoAccount(cleanEmail, code);
      } catch (backendErr) {
        if (!directRes.success && backendErr.response?.data?.success) {
          directRes = { success: true, message: 'Account confirmed successfully!' };
        }
      }

      return directRes;
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  /**
   * Emergency/Admin direct confirmation when Cognito default email is delayed/in spam
   */
  const adminConfirmAccount = async (email) => {
    setError(null);
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      const res = await apiAdminConfirmCognitoAccount(cleanEmail);
      return res.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error?.message || err.message,
      };
    }
  };

  /**
   * Resend confirmation code
   */
  const resendCode = async (email) => {
    setError(null);
    try {
      return await resendConfirmationCodeCognito({ email });
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  /**
   * Forgot password request
   */
  const requestPasswordReset = async (email) => {
    setError(null);
    try {
      return await forgotPasswordCognito({ email });
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  /**
   * Confirm password reset with 6-digit code and new password
   */
  const resetPassword = async (email, code, newPassword) => {
    setError(null);
    try {
      return await confirmNewPasswordCognito({ email, code, newPassword });
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  /**
   * Full Sign Out
   */
  const logout = () => {
    handleLogoutClean();
    signOutCognito();
  };

  const value = {
    user,
    token,
    role: user?.role || null,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    register,
    confirmAccount,
    adminConfirmAccount,
    resendCode,
    requestPasswordReset,
    resetPassword,
    logout,
    clearError: () => setError(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
