'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const { user, isLoading } = useAuth();

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <Link href="/" className="text-xl font-bold text-gray-900 hover:text-gray-700">
            CampusCore
          </Link>
          <div className="flex items-center gap-3">
            {!isLoading && (
              user ? (
                <Link href="/dashboard">
                  <Button>Dashboard</Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button>Login</Button>
                </Link>
              )
            )}
          </div>
        </div>
      </nav>

      <div className="container mx-auto py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Welcome to CampusCore</h1>
        <p className="text-lg text-gray-600 mb-8">Student Portal - Course Registration Platform</p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/register">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">Course Registration</h2>
              <p className="text-gray-600">Browse and enroll in courses for the current semester</p>
            </div>
          </Link>

          <Link href="/dashboard/enrollments">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">My Enrollments</h2>
              <p className="text-gray-600">View your enrolled courses and status</p>
            </div>
          </Link>

          <Link href="/dashboard/schedule">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">Schedule</h2>
              <p className="text-gray-600">View your class timetable</p>
            </div>
          </Link>
        </div>

        {!user && !isLoading && (
          <p className="mt-8 text-center text-gray-500">
            <Link href="/login" className="text-blue-600 hover:underline font-medium">Log in</Link>
            {' '}to access Course Registration, My Enrollments, and Schedule.
          </p>
        )}
      </div>
    </main>
  );
}
