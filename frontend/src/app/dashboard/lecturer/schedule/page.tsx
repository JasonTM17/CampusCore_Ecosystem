'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { sectionsApi, semestersApi } from '@/lib/api';
import { pickPreferredSemesterId } from '@/lib/semesters';
import { LecturerSection, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    Calendar,
    Clock,
    MapPin,
    BookOpen,
    AlertCircle,
    ChevronDown,
    Users,
    Building,
} from 'lucide-react';

interface TimetableSlot {
    courseCode: string;
    courseName: string;
    sectionNumber: string;
    startTime: string;
    endTime: string;
    building: string;
    roomNumber: string;
    dayOfWeek: number;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const timeSlots = [
    '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'
];

export default function LecturerSchedulePage() {
    const { user, logout, isLecturer } = useAuth();
    const router = useRouter();
    const [sections, setSections] = useState<LecturerSection[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'table' | 'timetable'>('table');
    const fetchSemesters = useCallback(async () => {
        try {
            const semestersRes = await semestersApi.getAll();
            setSemesters(semestersRes.data);

            const preferredSemesterId = pickPreferredSemesterId(semestersRes.data);
            if (preferredSemesterId) {
                setSelectedSemester(preferredSemesterId);
            }
        } catch {
            toast.error('Failed to load semesters');
        }
    }, []);

    const fetchSchedule = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await sectionsApi.getMySchedule(selectedSemester || undefined);
            setSections(data);
        } catch {
            setError('Failed to load schedule. Please try again.');
            toast.error('Failed to load schedule');
        } finally {
            setIsLoading(false);
        }
    }, [selectedSemester]);

    // Redirect non-lecturers
    useEffect(() => {
        if (!isLecturer && user) {
            router.push('/dashboard');
        }
    }, [isLecturer, user, router]);

    useEffect(() => {
        void fetchSemesters();
    }, [fetchSemesters]);

    useEffect(() => {
        void fetchSchedule();
    }, [fetchSchedule]);

    // Build timetable data
    const timetable = useMemo(() => {
        const schedule: Record<number, TimetableSlot[]> = {};
        for (let i = 0; i < 7; i++) {
            schedule[i] = [];
        }

        sections.forEach(section => {
            section.schedules.forEach(sched => {
                schedule[sched.dayOfWeek].push({
                    courseCode: section.courseCode,
                    courseName: section.courseName,
                    sectionNumber: section.sectionNumber,
                    startTime: sched.startTime,
                    endTime: sched.endTime,
                    building: sched.building,
                    roomNumber: sched.roomNumber,
                    dayOfWeek: sched.dayOfWeek,
                });
            });
        });

        // Sort by start time
        Object.keys(schedule).forEach(day => {
            schedule[parseInt(day)].sort((a, b) => a.startTime.localeCompare(b.startTime));
        });

        return schedule;
    }, [sections]);

    if (!isLecturer || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const getTimeSlotPosition = (time: string) => {
        const index = timeSlots.indexOf(time);
        return index >= 0 ? index : 0;
    };

    const getSlotHeight = (startTime: string, endTime: string) => {
        const startIndex = getTimeSlotPosition(startTime);
        const endIndex = getTimeSlotPosition(endTime);
        return Math.max(1, endIndex - startIndex);
    };

    const getSlotTop = (startTime: string) => {
        const index = getTimeSlotPosition(startTime);
        return index * 3; // 3rem = 48px per slot
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-gray-500">Loading schedule...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Navigation */}
            <nav className="bg-white shadow-sm border-b">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="text-xl font-bold">CampusCore</Link>
                        <span className="text-gray-500">|</span>
                        <span className="text-gray-600">My Teaching Schedule</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-600">Welcome, {user?.firstName}</span>
                        <Button variant="outline" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Calendar className="h-7 w-7 text-primary" />
                            My Teaching Schedule
                        </h2>
                        <p className="text-gray-500 mt-1">View your teaching assignments and class timetable</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {semesters.length > 0 && (
                            <div className="flex items-center gap-2">
                                <Building className="h-4 w-4 text-gray-500" />
                                <div className="relative">
                                    <select
                                        value={selectedSemester}
                                        onChange={(e) => setSelectedSemester(e.target.value)}
                                        className="border rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-white"
                                    >
                                        <option value="">All Semesters</option>
                                        {semesters.map(sem => (
                                            <option key={sem.id} value={sem.id}>
                                                {sem.name} {(sem.status === 'IN_PROGRESS' || sem.status === 'ADD_DROP_OPEN') ? '(Current)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                                </div>
                            </div>
                        )}
                        <div className="flex items-center border rounded-md overflow-hidden">
                            <button
                                onClick={() => setViewMode('table')}
                                className={`px-3 py-2 text-sm ${viewMode === 'table' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                                Table
                            </button>
                            <button
                                onClick={() => setViewMode('timetable')}
                                className={`px-3 py-2 text-sm ${viewMode === 'timetable' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                                Timetable
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchSchedule}>Try Again</Button>
                    </div>
                )}

                {/* Empty State */}
                {!error && sections.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                        <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Teaching Assignments</h3>
                        <p className="text-gray-500 mb-4">
                            {selectedSemester
                                ? 'You have no teaching assignments for the selected semester.'
                                : 'You have no teaching assignments yet.'}
                        </p>
                    </div>
                )}

                {/* Table View */}
                {!error && sections.length > 0 && viewMode === 'table' && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Course</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Section</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Credits</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Department</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Enrolled</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Schedule</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {sections.map((section) => (
                                        <tr key={section.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div>
                                                    <p className="font-medium text-gray-900">{section.courseCode}</p>
                                                    <p className="text-gray-500 text-xs">{section.courseName}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{section.sectionNumber}</td>
                                            <td className="px-4 py-3 text-center text-gray-600">{section.credits}</td>
                                            <td className="px-4 py-3 text-gray-600">{section.departmentName}</td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Users className="h-4 w-4 text-gray-400" />
                                                    <span className="text-gray-600">{section.enrolledCount}/{section.capacity}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="space-y-1">
                                                    {section.schedules.map((sched, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 text-xs">
                                                            <span className="font-medium text-gray-700">{dayNames[sched.dayOfWeek]}</span>
                                                            <span className="text-gray-500">{sched.startTime}-{sched.endTime}</span>
                                                            <span className="text-gray-400">|</span>
                                                            <span className="text-gray-500">{sched.building} {sched.roomNumber}</span>
                                                        </div>
                                                    ))}
                                                    {section.schedules.length === 0 && (
                                                        <span className="text-gray-400 text-xs">No schedule</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {section.status === 'OPEN' && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Open</span>
                                                )}
                                                {section.status === 'CLOSED' && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Closed</span>
                                                )}
                                                {section.status === 'CANCELLED' && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Cancelled</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Summary */}
                        <div className="border-t bg-gray-50 px-4 py-3 flex justify-between items-center text-sm text-gray-600">
                            <span>{sections.length} teaching assignment{sections.length !== 1 ? 's' : ''}</span>
                            <span>{sections.reduce((sum, s) => sum + s.enrolledCount, 0)} total students</span>
                        </div>
                    </div>
                )}

                {/* Timetable View */}
                {!error && sections.length > 0 && viewMode === 'timetable' && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <div className="min-w-[800px]">
                                {/* Time header */}
                                <div className="flex border-b bg-gray-50">
                                    <div className="w-16 flex-shrink-0 px-2 py-2 text-xs font-semibold text-gray-500 border-r">Time</div>
                                    {dayNames.map((day, idx) => (
                                        <div key={idx} className="flex-1 px-2 py-2 text-xs font-semibold text-gray-600 text-center border-r last:border-r-0">
                                            {day}
                                        </div>
                                    ))}
                                </div>
                                
                                {/* Time slots */}
                                <div className="relative">
                                    {timeSlots.slice(0, 14).map((time, idx) => (
                                        <div key={time} className="flex border-b border-gray-100">
                                            <div className="w-16 flex-shrink-0 px-2 py-3 text-xs text-gray-400 border-r">{time}</div>
                                            {dayNames.map((_, dayIdx) => (
                                                <div key={dayIdx} className="flex-1 h-12 border-r border-gray-100 last:border-r-0"></div>
                                            ))}
                                        </div>
                                    ))}
                                    
                                    {/* Render schedule items */}
                                    {Object.entries(timetable).map(([dayStr, slots]) => {
                                        const day = parseInt(dayStr);
                                        return slots.map((slot, slotIdx) => {
                                            const top = getSlotTop(slot.startTime);
                                            const height = getSlotHeight(slot.startTime, slot.endTime);
                                            return (
                                                <div
                                                    key={`${day}-${slotIdx}`}
                                                    className="absolute w-[calc(100%/7)] bg-blue-50 border border-blue-200 rounded-md p-1.5 overflow-hidden"
                                                    style={{
                                                        top: `${top}rem`,
                                                        height: `${height * 3}rem`,
                                                        left: `${(day * 100) / 7}%`,
                                                    }}
                                                >
                                                    <p className="text-xs font-bold text-blue-700 truncate">{slot.courseCode}</p>
                                                    <p className="text-xs text-blue-600 truncate">Sec {slot.sectionNumber}</p>
                                                    <p className="text-xs text-blue-500 truncate">{slot.roomNumber}</p>
                                                </div>
                                            );
                                        });
                                    })}
                                </div>
                            </div>
                        </div>
                        
                        {/* Legend */}
                        <div className="border-t bg-gray-50 px-4 py-3">
                            <p className="text-xs text-gray-500">
                                Showing classes from 07:00 to 13:30. Switch to table view for full schedule details.
                            </p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
