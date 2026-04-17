'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { sectionsApi, semestersApi } from '@/lib/api';
import { pickPreferredSemesterId } from '@/lib/semesters';
import { GradingSection, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    BookOpen,
    Users,
    Calendar,
    ChevronDown,
    AlertCircle,
    CheckCircle,
    Edit,
    Building,
} from 'lucide-react';

export default function LecturerGradesPage() {
    const { user, logout, isLecturer } = useAuth();
    const router = useRouter();
    const [sections, setSections] = useState<GradingSection[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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

    const fetchSections = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await sectionsApi.getMyGradingSections(selectedSemester || undefined);
            setSections(data);
        } catch {
            setError('Failed to load sections. Please try again.');
            toast.error('Failed to load sections');
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
        void fetchSections();
    }, [fetchSections]);

    if (!isLecturer || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const getGradeStatusBadge = (status: string, canPublish: boolean) => {
        if (status === 'ALL_GRADED') {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    <CheckCircle className="h-3 w-3" /> Ready to Publish
                </span>
            );
        }
        if (status === 'PARTIAL') {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    <Edit className="h-3 w-3" /> In Progress
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                No Grades
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-gray-500">Loading sections...</p>
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
                        <Link href="/dashboard/lecturer" className="text-xl font-bold">CampusCore</Link>
                        <span className="text-gray-500">|</span>
                        <span className="text-gray-600">Grade Management</span>
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
                            <BookOpen className="h-7 w-7 text-primary" />
                            Grade Management
                        </h2>
                        <p className="text-gray-500 mt-1">View and manage grades for your teaching sections</p>
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
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchSections}>Try Again</Button>
                    </div>
                )}

                {/* Empty State */}
                {!error && sections.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                        <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Sections Found</h3>
                        <p className="text-gray-500 mb-4">
                            {selectedSemester
                                ? 'You have no teaching assignments for the selected semester.'
                                : 'You have no teaching assignments yet.'}
                        </p>
                        <Link href="/dashboard/lecturer/schedule">
                            <Button>View Schedule</Button>
                        </Link>
                    </div>
                )}

                {/* Sections List */}
                {!error && sections.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Course</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Section</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Semester</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Enrolled</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Graded</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
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
                                            <td className="px-4 py-3 text-gray-600">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3 text-gray-400" />
                                                    {section.semester}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Users className="h-4 w-4 text-gray-400" />
                                                    <span className="text-gray-600">{section.enrolledCount}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className="text-gray-600">{section.gradedCount}/{section.enrolledCount}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {getGradeStatusBadge(section.gradeStatus, section.canPublish)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <Link href={`/dashboard/lecturer/grades/${section.id}`}>
                                                    <Button size="sm" variant={section.gradeStatus === 'PARTIAL' ? 'default' : 'outline'}>
                                                        {section.gradedCount > 0 ? 'Manage Grades' : 'Enter Grades'}
                                                    </Button>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Summary */}
                        <div className="border-t bg-gray-50 px-4 py-3 flex justify-between items-center text-sm text-gray-600">
                            <span>{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
                            <span>
                                {sections.filter(s => s.gradeStatus === 'ALL_GRADED').length} ready to publish
                            </span>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
