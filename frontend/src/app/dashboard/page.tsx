'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">CampusCore</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.firstName} {user?.lastName}</span>
            <Button variant="outline" onClick={logout}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-6">Student Dashboard</h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/register">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Course Registration</h3>
              <p className="text-gray-600">Browse and enroll in courses for the current semester</p>
            </div>
          </Link>

          <Link href="/dashboard/enrollments">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">My Enrollments</h3>
              <p className="text-gray-600">View your enrolled courses and status</p>
            </div>
          </Link>

          <Link href="/dashboard/schedule">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">My Schedule</h3>
              <p className="text-gray-600">View your class timetable</p>
            </div>
          </Link>

          <Link href="/dashboard/grades">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">My Grades</h3>
              <p className="text-gray-600">View your academic grades and GPA</p>
            </div>
          </Link>

          <Link href="/dashboard/invoices">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">My Invoices</h3>
              <p className="text-gray-600">View and pay your tuition invoices</p>
            </div>
          </Link>

          <Link href="/dashboard/transcript">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Official Transcript</h3>
              <p className="text-gray-600">View comprehensive academic transcript</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
