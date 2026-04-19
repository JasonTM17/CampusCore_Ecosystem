'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  GraduationCap,
  BookOpen,
  Calendar,
  BarChart3,
  Shield,
  Cloud,
  Users,
  ArrowRight,
  CheckCircle2,
  Star,
  Zap,
  Globe,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const features = [
  {
    icon: BookOpen,
    title: 'Course Registration',
    description: 'Enroll in courses with clear section and capacity details.',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: Calendar,
    title: 'Smart Scheduling',
    description: 'Review weekly schedules in one place.',
    color: 'from-purple-500 to-pink-500',
  },
  {
    icon: BarChart3,
    title: 'Analytics Ownership',
    description:
      'Serve operational reporting through a dedicated analytics service boundary.',
    color: 'from-emerald-500 to-teal-500',
  },
  {
    icon: Shield,
    title: 'Auth Service Boundary',
    description:
      'Handle sessions, users, roles, and permissions through a dedicated service boundary.',
    color: 'from-orange-500 to-red-500',
  },
  {
    icon: Cloud,
    title: 'Deployment Ready',
    description:
      'Built for containerized development and production deployment.',
    color: 'from-indigo-500 to-blue-500',
  },
  {
    icon: Users,
    title: 'People Ownership',
    description:
      'Manage student and lecturer records through a dedicated service boundary.',
    color: 'from-rose-500 to-pink-500',
  },
];

const stats = [
  { value: 'Live', label: 'Enrollment workflows' },
  { value: 'Clear', label: 'Role-based access' },
  { value: 'Shared', label: 'Academic records' },
  { value: 'Ready', label: 'Operational dashboards' },
];

export default function HomePage() {
  const { user, isLoading } = useAuth();

  return (
    <main className="min-h-screen bg-white dark:bg-gray-900">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                CampusCore
              </span>
            </Link>

            <div className="flex items-center gap-4">
              <ThemeToggle />
              {!isLoading &&
                (user ? (
                  <Link href="/dashboard">
                    <Button className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-0">
                      Dashboard
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                ) : (
                  <Link href="/login">
                    <Button
                      variant="outline"
                      className="border-gray-200 dark:border-gray-700"
                    >
                      Sign In
                    </Button>
                  </Link>
                ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.03)_1px,transparent_1px)] bg-[size:32px_32px]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium mb-6">
              <Zap className="w-4 h-4" />
              Academic Management Stack
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="bg-gradient-to-r from-gray-900 via-blue-900 to-gray-900 dark:from-white dark:via-blue-200 dark:to-white bg-clip-text text-transparent">
                Transform Your
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                University Operations
              </span>
            </h1>

            <p className="text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              A production-like campus platform for identity, academic flows,
              finance, engagement, people operations, and hardened identity
              workflows.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/login">
                <Button
                  size="lg"
                  className="px-8 py-4 text-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-0 shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 transition-all"
                >
                  Get Started
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href={user ? '/dashboard' : '/login'}>
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 py-4 text-lg border-gray-200 dark:border-gray-700"
                >
                  Open Portal
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 mt-1">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gray-50 dark:bg-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Everything You Need
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Service boundaries, runtime verification, and campus workflows
              aligned in one production-like stack
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-xl hover:shadow-gray-500/10 transition-all duration-300"
              >
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6 shadow-lg`}
                >
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-6">
                Built with Modern
                <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  {' '}
                  Technologies
                </span>
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                CampusCore runs a NestJS 11 core API together with dedicated
                auth, notification, finance, academic, engagement, people, and
                analytics services behind nginx, then verifies the full runtime
                contract across the web app, API edge, database, cache, queue,
                and object storage.
              </p>

              <div className="space-y-4">
                {[
                  'NestJS 11 core API with TypeScript',
                  'Auth service for sessions, users, roles, and permissions',
                  'Notification service for inbox and realtime delivery',
                  'Finance service for invoices and payments',
                  'Academic service for sections, enrollment, and grading',
                  'Engagement service for announcements and support tickets',
                  'People service for students and lecturers ownership',
                  'Analytics service for dashboards and operational reporting',
                  'Next.js 15 frontend with React 18',
                  'PostgreSQL with Prisma ORM',
                  'Redis for caching and sessions',
                  'RabbitMQ for async messaging',
                  'Docker-based deployment',
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-gray-700 dark:text-gray-300">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 text-white shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <Globe className="w-6 h-6 text-cyan-400" />
                  <span className="font-semibold">
                    Production-Like Stack Verification
                  </span>
                </div>
                <div className="space-y-3 font-mono text-sm">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span>API Gateway (Nginx)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span>Frontend App (Next.js standalone)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    <span>Core API (NestJS 11)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-pink-500"></div>
                    <span>Notification Service (Inbox + Realtime)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <span>Finance Service (Billing Domain)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span>Academic Service (Enrollment + Grades)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <span>Engagement Service (Announcements + Support)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-lime-500"></div>
                    <span>People Service (Students + Lecturers)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-teal-500"></div>
                    <span>Analytics Service (Dashboards + Reporting)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-sky-500"></div>
                    <span>Data Plane (PostgreSQL + Redis)</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                    <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
                    <span>Async + Storage (RabbitMQ + MinIO)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-cyan-600">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Manage academic operations from a single portal
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? '/dashboard' : '/login'}>
              <Button
                size="lg"
                className="px-8 py-4 text-lg bg-white text-blue-600 hover:bg-gray-100 border-0"
              >
                {user ? 'Open Dashboard' : 'Sign In'}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
                  <GraduationCap className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold text-white">CampusCore</span>
              </div>
              <p className="text-sm">
                Academic operations platform for modern universities
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Platform</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <span>Features</span>
                </li>
                <li>
                  <span>Access</span>
                </li>
                <li>
                  <span>Documentation</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <span>About</span>
                </li>
                <li>
                  <span>News</span>
                </li>
                <li>
                  <span>Careers</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <span>Privacy</span>
                </li>
                <li>
                  <span>Terms</span>
                </li>
                <li>
                  <span>Security</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm">
            <p>&copy; 2024 CampusCore. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
