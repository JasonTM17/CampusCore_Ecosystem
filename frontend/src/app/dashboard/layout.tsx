'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  Users, 
  BookOpen, 
  GraduationCap,
  Calendar,
  FileText,
  CreditCard,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User,
  ClipboardList,
  School,
  DoorOpen,
  BarChart3,
  MessageSquare
} from 'lucide-react';

const studentMenuItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/register', icon: ClipboardList, label: 'Course Registration' },
  { href: '/dashboard/enrollments', icon: BookOpen, label: 'My Courses' },
  { href: '/dashboard/schedule', icon: Calendar, label: 'Schedule' },
  { href: '/dashboard/grades', icon: FileText, label: 'Grades' },
  { href: '/dashboard/transcript', icon: GraduationCap, label: 'Transcript' },
  { href: '/dashboard/invoices', icon: CreditCard, label: 'Invoices' },
  { href: '/dashboard/announcements', icon: Bell, label: 'Announcements' },
];

const lecturerMenuItems = [
  { href: '/dashboard/lecturer', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/lecturer/schedule', icon: Calendar, label: 'My Schedule' },
  { href: '/dashboard/lecturer/grades', icon: FileText, label: 'Grade Management' },
  { href: '/dashboard/lecturer/announcements', icon: Bell, label: 'Announcements' },
];

const adminMenuItems = [
  { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/users', icon: Users, label: 'Users' },
  { href: '/admin/lecturers', icon: School, label: 'Lecturers' },
  { href: '/admin/courses', icon: BookOpen, label: 'Courses' },
  { href: '/admin/sections', icon: ClipboardList, label: 'Sections' },
  { href: '/admin/enrollments', icon: FileText, label: 'Enrollments' },
  { href: '/admin/classrooms', icon: DoorOpen, label: 'Classrooms' },
  { href: '/admin/semesters', icon: Calendar, label: 'Semesters' },
  { href: '/admin/academic-years', icon: Calendar, label: 'Academic Years' },
  { href: '/admin/departments', icon: School, label: 'Departments' },
  { href: '/admin/announcements', icon: Bell, label: 'Announcements' },
  { href: '/admin/invoices', icon: CreditCard, label: 'Invoices' },
  { href: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout, isStudent, isLecturer, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const menuItems = isAdmin ? adminMenuItems : isLecturer ? lecturerMenuItems : studentMenuItems;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-white dark:bg-gray-800 shadow-lg transform transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
          <Link href={isAdmin ? '/admin' : '/dashboard'} className="flex items-center gap-2">
            <School className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold dark:text-white">CampusCore</span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
            aria-label="Close sidebar navigation"
          >
            <X className="h-6 w-6 dark:text-white" />
          </button>
        </div>
        
        <nav className="mt-4 px-2 space-y-1 overflow-y-auto h-[calc(100vh-4rem)]">
          {menuItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && item.href !== '/admin' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-primary text-white' 
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between h-full px-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Open sidebar navigation"
                aria-expanded={sidebarOpen}
              >
                <Menu className="h-6 w-6 dark:text-white" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              
              {/* Notifications */}
              <div className="relative" ref={notificationsRef}>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className="relative p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label="Toggle notifications panel"
                  aria-expanded={notificationsOpen}
                  aria-controls="dashboard-notifications-panel"
                >
                  <Bell className="h-5 w-5 dark:text-white" />
                  <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
                </button>
                
                {notificationsOpen && (
                  <div
                    id="dashboard-notifications-panel"
                    className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50"
                  >
                    <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="font-semibold dark:text-white">Notifications</h3>
                    </div>
                  <div className="max-h-64 overflow-y-auto">
                      <div className="p-4 text-sm text-gray-500 dark:text-gray-300">
                        No dedicated notification inbox yet. Check announcements for live updates.
                      </div>
                    </div>
                    <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                      <Link
                        href="/dashboard/announcements"
                        className="block text-center text-sm text-primary hover:underline"
                        onClick={() => setNotificationsOpen(false)}
                      >
                        View announcements
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Dropdown */}
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label="Toggle profile menu"
                  aria-expanded={profileOpen}
                  aria-controls="dashboard-profile-menu"
                  aria-haspopup="menu"
                >
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white font-medium">
                    {user.firstName?.[0]}{user.lastName?.[0]}
                  </div>
                  <span className="hidden md:block text-sm font-medium dark:text-white">
                    {user.firstName} {user.lastName}
                  </span>
                  <ChevronDown className="h-4 w-4 dark:text-white" />
                </button>
                
                {profileOpen && (
                  <div
                    id="dashboard-profile-menu"
                    className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50"
                  >
                    <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                      <p className="font-medium dark:text-white">{user.firstName} {user.lastName}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                        {user.roles?.[0]}
                      </span>
                    </div>
                    <div className="p-1">
                      <Link 
                        href="/dashboard/profile" 
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                        onClick={() => setProfileOpen(false)}
                      >
                        <User className="h-4 w-4" />
                        Profile
                      </Link>
                      <Link
                        href="/dashboard/profile"
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Settings className="h-4 w-4" />
                        Profile settings
                      </Link>
                      <button 
                        onClick={handleLogout}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md"
                      >
                        <LogOut className="h-4 w-4" />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
