'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function AdminDashboardPage() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();

  // Redirect non-admins
  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-800 text-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">CampusCore Admin</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-300">Welcome, {user.firstName} {user.lastName}</span>
            <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-6">Admin Dashboard</h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/users">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">User Management</h3>
              <p className="text-gray-600">Manage user accounts, roles, and permissions</p>
            </div>
          </Link>

          <Link href="/admin/enrollments">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Enrollment Management</h3>
              <p className="text-gray-600">View and manage course enrollments</p>
            </div>
          </Link>

          <Link href="/admin/lecturers">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Lecturer Management</h3>
              <p className="text-gray-600">Manage lecturer profiles and assignments</p>
            </div>
          </Link>

          <Link href="/admin/courses">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Course Management</h3>
              <p className="text-gray-600">Create and manage courses and curricula</p>
            </div>
          </Link>

          <Link href="/admin/sections">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Section Management</h3>
              <p className="text-gray-600">Manage class sections, schedules, and assignments</p>
            </div>
          </Link>

          <Link href="/admin/semesters">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Semester Management</h3>
              <p className="text-gray-600">Manage academic semesters and years</p>
            </div>
          </Link>

          <Link href="/admin/academic-years">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Academic Years</h3>
              <p className="text-gray-600">Manage academic year periods</p>
            </div>
          </Link>

          <Link href="/admin/departments">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Departments</h3>
              <p className="text-gray-600">Manage academic departments</p>
            </div>
          </Link>

          <Link href="/admin/classrooms">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Classrooms</h3>
              <p className="text-gray-600">Manage rooms and facilities</p>
            </div>
          </Link>

          <Link href="/admin/analytics">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Reports & Analytics</h3>
              <p className="text-gray-600">View campus statistics and enrollment insights</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
