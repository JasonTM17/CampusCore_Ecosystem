'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi } from '@/lib/api';
import { Enrollment } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, BookOpen, Clock, MapPin, Trash2, Calendar } from 'lucide-react';

export default function EnrollmentsPage() {
  const { user, logout } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDropping, setIsDropping] = useState<string | null>(null);

  useEffect(() => {
    fetchEnrollments();
  }, []);

  const fetchEnrollments = async () => {
    try {
      const data = await enrollmentsApi.getMyEnrollments();
      setEnrollments(data);
    } catch (error) {
      toast.error('Failed to load enrollments');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = async (enrollmentId: string) => {
    if (!user?.studentId) {
      toast.error('Student profile not found. Please log in again.');
      return;
    }

    if (!confirm('Are you sure you want to drop this course?')) {
      return;
    }

    setIsDropping(enrollmentId);
    try {
      await enrollmentsApi.drop(enrollmentId);
      toast.success('Course dropped successfully');
      fetchEnrollments();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to drop course');
    } finally {
      setIsDropping(null);
    }
  };

  const getDayName = (day: number) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day] || '';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return 'bg-green-100 text-green-800';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'DROPPED':
        return 'bg-red-100 text-red-800';
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xl font-bold">CampusCore</Link>
            <span className="text-gray-500">|</span>
            <span className="text-gray-600">My Enrollments</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.firstName}</span>
            <Button variant="outline" onClick={logout}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">My Enrollments</h2>
          <Link href="/dashboard/register">
            <Button>Browse Courses</Button>
          </Link>
        </div>

        {enrollments.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">You haven't enrolled in any courses yet</p>
            <Link href="/dashboard/register">
              <Button>Browse Courses</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {enrollments.map(enrollment => (
              <div key={enrollment.id} className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">
                        {enrollment.section?.course?.code} - {enrollment.section?.course?.name}
                      </h3>
                      <span className="text-sm text-gray-500">
                        Section {enrollment.section?.sectionNumber}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(enrollment.status)}`}>
                        {enrollment.status}
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>Enrolled: {new Date(enrollment.enrolledAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{enrollment.section?.course?.credits} credits</span>
                      </div>
                      {enrollment.section?.lecturer && (
                        <div className="flex items-center gap-1">
                          <span>Prof. {enrollment.section.lecturer.user?.firstName} {enrollment.section.lecturer.user?.lastName}</span>
                        </div>
                      )}
                      {enrollment.section?.classroom && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          <span>{enrollment.section.classroom.building} {enrollment.section.classroom.roomNumber}</span>
                        </div>
                      )}
                    </div>

                    {/* Schedule */}
                    {enrollment.section?.schedules && enrollment.section.schedules.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {enrollment.section.schedules.map((schedule, idx) => (
                          <span 
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm"
                          >
                            <Clock className="h-3 w-3" />
                            {getDayName(schedule.dayOfWeek)} {schedule.startTime}-{schedule.endTime}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {enrollment.status !== 'DROPPED' && enrollment.status !== 'COMPLETED' && (
                    <div className="ml-4">
                      <Button 
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDrop(enrollment.id)}
                        disabled={isDropping === enrollment.id}
                      >
                        {isDropping === enrollment.id ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-1" />
                        )}
                        Drop
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
