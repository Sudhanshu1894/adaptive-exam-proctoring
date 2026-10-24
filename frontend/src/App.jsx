import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import ProtectedRoute from './components/auth/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import TeacherDashboard from './pages/teacher/TeacherDashboard';
import StudentDashboard from './pages/student/StudentDashboard';
import ExamArena from './pages/student/ExamArena';
import NotFoundPage from './pages/NotFoundPage';
import ErrorBoundary from './components/common/ErrorBoundary';

export const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
        <Route element={<AppShell />}>
          {/* Public Landing & Authentication Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/overview" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected Proctor / Teacher Workspace (Role: proctor / teacher) */}
          <Route
            path="/teacher"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'proctor']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/*"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'proctor']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/proctor"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'proctor']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/proctor/*"
            element={
              <ProtectedRoute allowedRoles={['teacher', 'proctor']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />

          {/* Protected Student Arena (Role: student) */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/exam/:examId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ExamArena />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/*"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />

          {/* 404 Catch-All */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  </ErrorBoundary>
  );
};


export default App;
