'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Calendar, ClipboardList, CreditCard, FileText, LayoutDashboard, LogOut, Menu, School, Settings, User, Users, X, BookOpen, DoorOpen, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { notificationsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const studentMenuItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/register', icon: ClipboardList, label: 'Course registration' },
  { href: '/dashboard/enrollments', icon: BookOpen, label: 'My courses' },
  { href: '/dashboard/schedule', icon: Calendar, label: 'Schedule' },
  { href: '/dashboard/grades', icon: FileText, label: 'Grades' },
  { href: '/dashboard/transcript', icon: School, label: 'Transcript' },
  { href: '/dashboard/invoices', icon: CreditCard, label: 'Invoices' },
  { href: '/dashboard/announcements', icon: Bell, label: 'Announcements' },
];

const lecturerMenuItems = [
  { href: '/dashboard/lecturer', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/lecturer/schedule', icon: Calendar, label: 'Teaching schedule' },
  { href: '/dashboard/lecturer/grades', icon: FileText, label: 'Grade management' },
  { href: '/dashboard/lecturer/announcements', icon: Bell, label: 'Announcements' },
];

const pageMetadata: Record<string, { title: string; description: string }> = {
  '/dashboard': {
    title: 'Student dashboard',
    description: 'Registration, coursework, billing, and profile tasks stay in one student shell.',
  },
  '/dashboard/profile': {
    title: 'Profile settings',
    description: 'Keep contact details and credential rotation aligned with the active browser session.',
  },
  '/dashboard/register': {
    title: 'Course registration',
    description: 'Browse sections and manage enrollment decisions for the current term.',
  },
  '/dashboard/enrollments': {
    title: 'My courses',
    description: 'Track the classes you are taking and the sections attached to them.',
  },
  '/dashboard/schedule': {
    title: 'Schedule',
    description: 'Keep the weekly class view close while the rest of the portal stays reachable.',
  },
  '/dashboard/grades': {
    title: 'Grades',
    description: 'Review published grades and current academic standing.',
  },
  '/dashboard/transcript': {
    title: 'Transcript',
    description: 'View cumulative academic history and semester outcomes.',
  },
  '/dashboard/invoices': {
    title: 'Invoices',
    description: 'Review billing status and payment history.',
  },
  '/dashboard/announcements': {
    title: 'Announcements',
    description: 'Read campus-wide updates and shared notices.',
  },
  '/dashboard/lecturer': {
    title: 'Lecturer dashboard',
    description: 'Keep teaching tasks, grading queues, section context, and announcements in one lecturer shell.',
  },
  '/dashboard/lecturer/schedule': {
    title: 'Teaching schedule',
    description: 'Track assigned sections, rooms, and meeting windows.',
  },
  '/dashboard/lecturer/grades': {
    title: 'Grade management',
    description: 'Review grading queues, filter by term, and move publish-ready sections forward.',
  },
  '/dashboard/lecturer/announcements': {
    title: 'Announcements',
    description: 'Share updates with the students connected to your sections.',
  },
};

interface NotificationItem {
  id: string;
  title?: string;
  content?: string;
  isRead: boolean;
  createdAt: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout, isLecturer, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const menuItems = isAdmin ? [] : isLecturer ? lecturerMenuItems : studentMenuItems;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login?reason=unauthorized');
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    const loadNotifications = async () => {
      setNotificationsLoading(true);
      try {
        const response = await notificationsApi.getMy({
          limit: 5,
          isRead: false,
        });
        if (!cancelled) {
          setNotifications(response.data);
        }
      } catch {
        if (!cancelled) {
          setNotifications([]);
        }
      } finally {
        if (!cancelled) {
          setNotificationsLoading(false);
        }
      }
    };

    void loadNotifications();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const currentPage = useMemo(() => {
    if (pageMetadata[pathname]) {
      return pageMetadata[pathname];
    }

    const matchingItem = [...studentMenuItems, ...lecturerMenuItems].find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );

    if (matchingItem) {
      return {
        title: matchingItem.label,
        description: 'Navigate the current workflow without leaving the workspace shell.',
      };
    }

    return {
      title: 'Campus workspace',
      description: 'Move through your current role surface with consistent session handling.',
    };
  }, [pathname]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  const roleLabel = isAdmin ? 'Admin access' : isLecturer ? 'Lecturer access' : 'Student access';

  return (
    <div className="min-h-screen bg-background dark:bg-[hsl(var(--background))]">
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border/70 bg-[hsl(var(--surface-alt))] transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <BrandMark href={isLecturer ? '/dashboard/lecturer' : '/dashboard'} compact />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar navigation"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="border-b border-border/70 px-5 py-4">
          <div className="text-sm font-semibold text-foreground">{roleLabel}</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Keep your next action close without losing the surrounding context.
          </p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
          {menuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' &&
                item.href !== '/dashboard/lecturer' &&
                pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                )}
              >
                <item.icon className="h-4.5 w-4.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border/70 px-4 py-4">
          <Link
            href="/dashboard/profile"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <Settings className="h-4.5 w-4.5" />
            Profile settings
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10"
          >
            <LogOut className="h-4.5 w-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-start gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar navigation"
                aria-expanded={sidebarOpen}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                  {currentPage.title}
                </h1>
                <p className="hidden text-sm leading-6 text-muted-foreground sm:block">
                  {currentPage.description}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />

              <div className="relative" ref={notificationsRef}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setNotificationsOpen((current) => !current)}
                  aria-label="Toggle notifications panel"
                  aria-expanded={notificationsOpen}
                  aria-controls="dashboard-notifications-panel"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 ? (
                    <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[hsl(var(--accent-warm))]" />
                  ) : null}
                </Button>

                {notificationsOpen ? (
                  <div
                    id="dashboard-notifications-panel"
                    className="absolute right-0 mt-2 w-80 rounded-lg border border-border/80 bg-card shadow-2xl"
                  >
                    <div className="border-b border-border/70 px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Notifications
                      </h3>
                    </div>
                    <div className="max-h-72 overflow-y-auto px-4 py-3">
                      {notificationsLoading ? (
                        <div className="py-6 text-sm text-muted-foreground">
                          Loading recent alerts...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="py-6 text-sm leading-6 text-muted-foreground">
                          No unread alerts right now. Announcements remain the
                          main broadcast channel for shared updates.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {notifications.map((notification) => (
                            <div
                              key={notification.id}
                              className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-3"
                            >
                              <div className="text-sm font-medium text-foreground">
                                {notification.title || 'New update'}
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                {notification.content || 'A new notification has arrived for your account.'}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-border/70 px-4 py-3">
                      <Link
                        href={isLecturer ? '/dashboard/lecturer/announcements' : '/dashboard/announcements'}
                        className="text-sm font-medium text-primary hover:underline"
                        onClick={() => setNotificationsOpen(false)}
                      >
                        Open announcements
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((current) => !current)}
                  className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 transition-colors hover:bg-secondary/50"
                  aria-label="Toggle profile menu"
                  aria-expanded={profileOpen}
                  aria-controls="dashboard-profile-menu"
                  aria-haspopup="menu"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {user.firstName?.[0]}
                    {user.lastName?.[0]}
                  </div>
                  <div className="hidden min-w-0 text-left md:block">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {user.firstName} {user.lastName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </div>
                </button>

                {profileOpen ? (
                  <div
                    id="dashboard-profile-menu"
                    className="absolute right-0 mt-2 w-64 rounded-lg border border-border/80 bg-card shadow-2xl"
                  >
                    <div className="border-b border-border/70 px-4 py-4">
                      <p className="font-semibold text-foreground">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {user.email}
                      </p>
                      <div className="mt-3 inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                        {user.roles?.[0] || 'USER'}
                      </div>
                    </div>
                    <div className="px-2 py-2">
                      <Link
                        href="/dashboard/profile"
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                        onClick={() => setProfileOpen(false)}
                      >
                        <User className="h-4 w-4" />
                        Profile
                      </Link>
                      <Link
                        href="/dashboard/profile"
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                      <button
                        type="button"
                        onClick={() => void logout()}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
