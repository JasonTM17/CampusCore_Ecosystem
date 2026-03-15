'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function LecturerDashboardPage() {
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
        <h2 className="text-2xl font-bold mb-6">Lecturer Dashboard</h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/lecturer/schedule">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">My Teaching Schedule</h3>
              <p className="text-gray-600">View your class timetable and teaching assignments</p>
            </div>
          </Link>

          <Link href="/dashboard/lecturer/grades">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <h3 className="text-lg font-semibold mb-2">Grade Management</h3>
              <p className="text-gray-600">Enter and publish grades for your sections</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
