'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { gradesApi, semestersApi } from '@/lib/api';
import { StudentGradeRecord, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    GraduationCap,
    Calendar,
    TrendingUp,
    BookOpen,
    AlertCircle,
    Award,
    ChevronDown,
} from 'lucide-react';

const gradePoints: Record<string, number> = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F': 0.0,
};

const gradeColorClass = (letter: string | null): string => {
    if (!letter) return 'text-gray-400';
    if (letter.startsWith('A')) return 'text-emerald-600 bg-emerald-50';
    if (letter.startsWith('B')) return 'text-blue-600 bg-blue-50';
    if (letter.startsWith('C')) return 'text-amber-600 bg-amber-50';
    if (letter.startsWith('D')) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
};

const statusBadge = (status: string) => {
    switch (status) {
        case 'PUBLISHED':
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Published</span>;
        case 'APPEALED':
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Appealed</span>;
        case 'DRAFT':
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Draft</span>;
        default:
            return null;
    }
};

export default function GradesPage() {
    const { user, logout } = useAuth();
    const [grades, setGrades] = useState<StudentGradeRecord[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fetchSemesters = useCallback(async () => {
        try {
            const semestersRes = await semestersApi.getAll();
            setSemesters(semestersRes.data);
        } catch {
            toast.error('Failed to load semesters');
        }
    }, []);

    const fetchGrades = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await gradesApi.getMyGrades(selectedSemester || undefined);
            setGrades(data);
        } catch {
            setError('Failed to load grades. Please try again.');
            toast.error('Failed to load grades');
        } finally {
            setIsLoading(false);
        }
    }, [selectedSemester]);

    useEffect(() => {
        void fetchSemesters();
    }, [fetchSemesters]);

    useEffect(() => {
        void fetchGrades();
    }, [fetchGrades]);

    // GPA calculation
    const summary = useMemo(() => {
        const gradedCourses = grades.filter(g => g.letterGrade && gradePoints[g.letterGrade] !== undefined);
        const totalCredits = gradedCourses.reduce((sum, g) => sum + g.credits, 0);
        const totalPoints = gradedCourses.reduce((sum, g) => sum + (gradePoints[g.letterGrade!] * g.credits), 0);
        const gpa = totalCredits > 0 ? totalPoints / totalCredits : 0;
        const totalAllCredits = grades.reduce((sum, g) => sum + g.credits, 0);
        const completedCredits = grades.filter(g => g.enrollmentStatus === 'COMPLETED').reduce((sum, g) => sum + g.credits, 0);

        return {
            gpa: gpa.toFixed(2),
            totalCredits: totalAllCredits,
            completedCredits,
            courseCount: grades.length,
            gradedCount: gradedCourses.length,
        };
    }, [grades]);

    // Group grades by semester
    const groupedGrades = useMemo(() => {
        const groups: Record<string, StudentGradeRecord[]> = {};
        grades.forEach(g => {
            if (!groups[g.semester]) groups[g.semester] = [];
            groups[g.semester].push(g);
        });
        return groups;
    }, [grades]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-gray-500">Loading grades...</p>
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
                        <span className="text-gray-600">My Grades</span>
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
                            <GraduationCap className="h-7 w-7 text-primary" />
                            Academic Grades
                        </h2>
                        <p className="text-gray-500 mt-1">View your course grades and academic performance</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {semesters.length > 0 && (
                            <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-gray-500" />
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
                        <Link href="/dashboard/schedule">
                            <Button variant="outline" size="sm">View Schedule</Button>
                        </Link>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchGrades}>Try Again</Button>
                    </div>
                )}

                {/* Empty State */}
                {!error && grades.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                        <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Grades Available</h3>
                        <p className="text-gray-500 mb-4">
                            {selectedSemester
                                ? 'No grades found for the selected semester.'
                                : 'You do not have any grades recorded yet. Grades will appear here once your courses are completed and graded.'}
                        </p>
                        <Link href="/dashboard/enrollments">
                            <Button>View Enrollments</Button>
                        </Link>
                    </div>
                )}

                {/* Content - GPA Summary + Grades Table */}
                {!error && grades.length > 0 && (
                    <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-blue-50">
                                        <TrendingUp className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">GPA</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{summary.gpa}</p>
                                <p className="text-xs text-gray-400 mt-1">of 4.00 scale</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-emerald-50">
                                        <Award className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Completed</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{summary.completedCredits}</p>
                                <p className="text-xs text-gray-400 mt-1">credits earned</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-violet-50">
                                        <BookOpen className="h-5 w-5 text-violet-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Courses</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{summary.courseCount}</p>
                                <p className="text-xs text-gray-400 mt-1">{summary.gradedCount} graded</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-amber-50">
                                        <GraduationCap className="h-5 w-5 text-amber-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Total Credits</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{summary.totalCredits}</p>
                                <p className="text-xs text-gray-400 mt-1">across all courses</p>
                            </div>
                        </div>

                        {/* Grades by Semester */}
                        {Object.entries(groupedGrades).map(([semesterName, semGrades]) => (
                            <div key={semesterName} className="mb-6">
                                <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-gray-500" />
                                    {semesterName}
                                </h3>
                                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-gray-50 border-b">
                                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Course Code</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Course Name</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Credits</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Section</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Lecturer</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Score</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Grade</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {semGrades.map((grade) => (
                                                    <tr key={grade.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-3 font-medium text-gray-900">{grade.courseCode}</td>
                                                        <td className="px-4 py-3 text-gray-700">{grade.courseName}</td>
                                                        <td className="px-4 py-3 text-center text-gray-600">{grade.credits}</td>
                                                        <td className="px-4 py-3 text-gray-600">{grade.sectionCode}</td>
                                                        <td className="px-4 py-3 text-gray-600">{grade.lecturerName || '—'}</td>
                                                        <td className="px-4 py-3 text-center text-gray-700 font-medium">
                                                            {grade.finalGrade !== null ? grade.finalGrade.toFixed(1) : '—'}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            {grade.letterGrade ? (
                                                                <span className={`inline-flex items-center justify-center w-10 h-7 rounded-md text-sm font-bold ${gradeColorClass(grade.letterGrade)}`}>
                                                                    {grade.letterGrade}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            {statusBadge(grade.gradeStatus)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Semester Sub-summary */}
                                    <div className="border-t bg-gray-50 px-4 py-3 flex justify-between items-center text-sm text-gray-600">
                                        <span>
                                            {semGrades.length} course{semGrades.length !== 1 ? 's' : ''} · {semGrades.reduce((s, g) => s + g.credits, 0)} credits
                                        </span>
                                        {(() => {
                                            const graded = semGrades.filter(g => g.letterGrade && gradePoints[g.letterGrade] !== undefined);
                                            if (graded.length === 0) return null;
                                            const tc = graded.reduce((s, g) => s + g.credits, 0);
                                            const tp = graded.reduce((s, g) => s + gradePoints[g.letterGrade!] * g.credits, 0);
                                            const sgpa = tc > 0 ? (tp / tc).toFixed(2) : '0.00';
                                            return <span className="font-medium">Semester GPA: <span className="text-gray-900">{sgpa}</span></span>;
                                        })()}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </main>
        </div>
    );
}
