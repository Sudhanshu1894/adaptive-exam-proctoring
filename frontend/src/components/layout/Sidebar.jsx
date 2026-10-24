import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  BarChart3,
  ShieldAlert,
  User,
  BookOpen,
  Award,
  LogOut,
  GraduationCap,
  Briefcase,
  ChevronRight,
  Users,
} from 'lucide-react';

export const Sidebar = ({ isOpen, setIsOpen }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const isTeacher = location.pathname.startsWith('/teacher') || location.pathname.startsWith('/proctor');
  const isStudent = location.pathname.startsWith('/student');

  // Teacher navigation: Dashboard, Courses & Students, My Exams, Create Exam, Student Results, Proctoring Reports, Profile, Sign Out
  const teacherNav = [
    { name: 'Dashboard', path: '/teacher', icon: LayoutDashboard, exact: true },
    { name: 'Courses & Students', path: '/teacher/courses', icon: Users },
    { name: 'My Exams', path: '/teacher/exams', icon: FileText },
    { name: 'Create Exam', path: '/teacher/create-exam', icon: PlusCircle },
    { name: 'Student Results', path: '/teacher/results', icon: BarChart3 },
    { name: 'Proctoring Reports', path: '/teacher/reports', icon: ShieldAlert },
    { name: 'Profile', path: '/teacher/profile', icon: User },
  ];

  // Student navigation: Dashboard, My Exams, Results, Profile, Sign Out
  const studentNav = [
    { name: 'Dashboard', path: '/student', icon: LayoutDashboard, exact: true },
    { name: 'My Exams', path: '/student/available', icon: BookOpen },
    { name: 'Results', path: '/student/results', icon: Award },
    { name: 'Profile', path: '/student/profile', icon: User },
  ];

  const currentNav = isTeacher ? teacherNav : isStudent ? studentNav : null;

  if (!currentNav) return null;

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 w-64 bg-white border-r border-[#E2E8F0] transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full justify-between p-4">
          <div className="space-y-6">
            {/* Active Workspace Pill */}
            <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center">
                {isTeacher ? <Briefcase className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
              </div>
              <div className="overflow-hidden">
                <span className="text-[10px] uppercase font-bold text-[#64748B] block tracking-wider">
                  Workspace
                </span>
                <span className="text-xs font-bold text-[#172033] truncate block">
                  {isTeacher ? 'Teacher Workspace' : 'Student Portal'}
                </span>
              </div>
            </div>

            {/* Navigation links */}
            <nav className="space-y-1">
              {currentNav.map((item) => {
                const Icon = item.icon;
                const isActive = item.exact
                  ? location.pathname === item.path
                  : location.pathname.startsWith(item.path);

                return (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-[#2563EB] font-semibold border border-blue-200'
                        : 'text-[#64748B] hover:text-[#172033] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-[#2563EB]' : 'text-[#64748B]'}`} />
                      <span>{item.name}</span>
                    </div>
                    {isActive && <ChevronRight className="w-3.5 h-3.5 text-[#2563EB]" />}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* User Sign Out footer */}
          <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
            <div className="flex items-center gap-2.5 px-2">
              <div className="h-8 w-8 rounded-full bg-slate-100 text-[#172033] flex items-center justify-center font-bold text-xs border border-slate-200">
                {(user?.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden flex-1">
                <p className="text-xs font-bold text-[#172033] truncate">{user?.name || 'User'}</p>
                <p className="text-[11px] text-[#64748B] truncate">{user?.email || ''}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
