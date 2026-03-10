'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi } from '@/lib/api';
import { Enrollment, SectionSchedule } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, BookOpen, Clock, MapPin } from 'lucide-react';

interface TimetableSlot {
  courseName: string;
  courseCode: string;
  sectionNumber: string;
  startTime: string;
  endTime: string;
  building: string;
  roomNumber: string;
}

export default function SchedulePage() {
  const { user, logout } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchEnrollments();
  }, []);

  const fetchEnrollments = async () => {
    try {
      const data = await enrollmentsApi.getMyEnrollments();
      setEnrollments(data);
    } catch (error) {
      toast.error('Failed to load schedule');
    } finally {
      setIsLoading(false);
    }
  };

  const timetable = useMemo(() => {
    const schedule: Record<string, TimetableSlot[]> = {
      '0': [], // Sunday
      '1': [], // Monday
      '2': [], // Tuesday
      '3': [], // Wednesday
      '4': [], // Thursday
      '5': [], // Friday
      '6': [], // Saturday
    };

    enrollments
      .filter(e => e.status === 'CONFIRMED' || e.status === 'PENDING')
      .forEach(enrollment => {
        const section = enrollment.section;
        if (section?.schedules) {
          section.schedules.forEach((sched: SectionSchedule) => {
            const day = sched.dayOfWeek.toString();
            if (!schedule[day]) {
              schedule[day] = [];
            }
            schedule[day].push({
              courseName: section.course?.name || '',
              courseCode: section.course?.code || '',
              sectionNumber: section.sectionNumber,
              startTime: sched.startTime,
              endTime: sched.endTime,
              building: sched.classroom?.building || '',
              roomNumber: sched.classroom?.roomNumber || '',
            });
          });
        }
      });

    // Sort each day by start time
    Object.keys(schedule).forEach(day => {
      schedule[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    });

    return schedule;
  }, [enrollments]);

  const days = [
    { key: '1', name: 'Monday' },
    { key: '2', name: 'Tuesday' },
    { key: '3', name: 'Wednesday' },
    { key: '4', name: 'Thursday' },
    { key: '5', name: 'Friday' },
  ];

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = 8; hour <= 20; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
    return slots;
  }, []);

  const getPosition = (startTime: string) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = (hours - 8) * 60 + minutes;
    return totalMinutes / 30;
  };

  const getHeight = (startTime: string, endTime: string) => {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const totalMinutes = (endH - startH) * 60 + (endM - startM);
    return totalMinutes / 30;
  };

  const hasClasses = Object.values(timetable).some(day => day.length > 0);

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
            <span className="text-gray-600">My Schedule</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.firstName}</span>
            <Button variant="outline" onClick={logout}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">My Class Schedule</h2>
          <Link href="/dashboard/enrollments">
            <Button variant="outline">View Enrollments</Button>
          </Link>
        </div>

        {!hasClasses ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">You don't have any classes scheduled yet</p>
            <Link href="/dashboard/register">
              <Button>Browse Courses</Button>
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="grid grid-cols-6 border-b">
              <div className="p-4 font-medium text-gray-500 bg-gray-50">Time</div>
              {days.map(day => (
                <div key={day.key} className="p-4 font-medium text-center border-l bg-gray-50">
                  {day.name}
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: `${timeSlots.length * 40}px` }}>
              {/* Time labels */}
              <div className="absolute left-0 top-0 w-20">
                {timeSlots.map((time, idx) => (
                  <div 
                    key={time} 
                    className="text-xs text-gray-400 border-b"
                    style={{ height: '40px', lineHeight: '40px' }}
                  >
                    {idx % 2 === 0 ? time : ''}
                  </div>
                ))}
              </div>

              {/* Grid cells */}
              <div className="absolute left-20 right-0 top-0 grid grid-cols-5">
                {days.map(day => (
                  <div key={day.key} className="border-l relative">
                    {timeSlots.map((_, idx) => (
                      <div 
                        key={idx} 
                        className="border-b"
                        style={{ height: '40px' }}
                      />
                    ))}
                  </div>
                ))}
              </div>

              {/* Events */}
              {days.map((day, dayIdx) => (
                <div key={day.key} className="absolute left-20 right-0 grid grid-cols-5" style={{ top: 0 }}>
                  <div 
                    key={day.key} 
                    className="relative border-l"
                    style={{ gridColumn: dayIdx + 1 }}
                  >
                    {timetable[day.key]?.map((slot, idx) => {
                      const top = getPosition(slot.startTime) * 40;
                      const height = getHeight(slot.startTime, slot.endTime) * 40;
                      
                      return (
                        <div
                          key={idx}
                          className="absolute left-1 right-1 bg-blue-500 text-white rounded p-2 text-xs overflow-hidden"
                          style={{
                            top: `${top}px`,
                            height: `${height - 4}px`,
                          }}
                        >
                          <div className="font-semibold">{slot.courseCode}</div>
                          <div>Sec {slot.sectionNumber}</div>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3" />
                            {slot.startTime}-{slot.endTime}
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {slot.building} {slot.roomNumber}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* List View */}
        {hasClasses && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">Class List</h3>
            <div className="bg-white rounded-lg shadow-sm border divide-y">
              {enrollments
                .filter(e => e.status === 'CONFIRMED' || e.status === 'PENDING')
                .flatMap(e => 
                  (e.section?.schedules || []).map((sched: SectionSchedule, idx: number) => ({
                    ...sched,
                    courseName: e.section?.course?.name,
                    courseCode: e.section?.course?.code,
                    sectionNumber: e.section?.sectionNumber,
                  }))
                )
                .sort((a, b) => {
                  if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
                  return a.startTime.localeCompare(b.startTime);
                })
                .map((item, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-24 font-medium">
                        {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][item.dayOfWeek]}
                      </div>
                      <div>
                        <span className="font-semibold">{item.courseCode}</span>
                        <span className="text-gray-500"> - {item.courseName}</span>
                        <span className="text-gray-400 ml-2">Section {item.sectionNumber}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {item.startTime} - {item.endTime}
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {item.classroom?.building} {item.classroom?.roomNumber}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
