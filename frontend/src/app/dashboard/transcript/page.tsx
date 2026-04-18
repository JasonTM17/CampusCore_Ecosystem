'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { gradesApi, semestersApi } from '@/lib/api';
import { TranscriptResponse, Semester } from '@/types/api';
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
    FileText,
    CheckCircle,
    Clock,
    XCircle,
} from 'lucide-react';

const gradePoints: Record<string, number> = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F': 0.0,
};

const gradeColorClass = (letter: string | null): string => {
    if (!letter) return 'text-gray-400 bg-gray-50';
    if (letter.startsWith('A')) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (letter.startsWith('B')) return 'text-blue-700 bg-blue-50 border-blue-200';
    if (letter.startsWith('C')) return 'text-amber-700 bg-amber-50 border-amber-200';
    if (letter.startsWith('D')) return 'text-orange-700 bg-orange-50 border-orange-200';
    return 'text-red-700 bg-red-50 border-red-200';
};

const statusBadge = (status: string) => {
    switch (status) {
        case 'PUBLISHED':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                    <CheckCircle className="h-3 w-3" /> Published
                </span>
            );
        case 'APPEALED':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-200">
                    <Clock className="h-3 w-3" /> Appealed
                </span>
            );
        case 'DRAFT':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                    <Clock className="h-3 w-3" /> Draft
                </span>
            );
        default:
            return null;
    }
};

const enrollmentStatusBadge = (status: string) => {
    switch (status) {
        case 'COMPLETED':
            return <span className="text-green-600 font-medium">Completed</span>;
        case 'CONFIRMED':
            return <span className="text-blue-600 font-medium">Confirmed</span>;
        case 'PENDING':
            return <span className="text-amber-600 font-medium">Pending</span>;
        case 'DROPPED':
            return <span className="text-red-600 font-medium">Dropped</span>;
        case 'CANCELLED':
            return <span className="text-gray-600 font-medium">Cancelled</span>;
        default:
            return <span className="text-gray-500">{status}</span>;
    }
};

export default function TranscriptPage() {
    const { user, logout } = useAuth();
    const [transcriptData, setTranscriptData] = useState<TranscriptResponse | null>(null);
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

    const fetchTranscript = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await gradesApi.getMyTranscript(selectedSemester || undefined);
            setTranscriptData(data);
        } catch {
            setError('Failed to load transcript. Please try again.');
            toast.error('Failed to load transcript');
        } finally {
            setIsLoading(false);
        }
    }, [selectedSemester]);

    useEffect(() => {
        void fetchSemesters();
    }, [fetchSemesters]);

    useEffect(() => {
        void fetchTranscript();
    }, [fetchTranscript]);

    // Group grades by semester
    const groupedRecords = useMemo(() => {
        if (!transcriptData?.records) return {};
        const groups: Record<string, typeof transcriptData.records> = {};
        transcriptData.records.forEach((record) => {
            if (!groups[record.semester]) groups[record.semester] = [];
            groups[record.semester].push(record);
        });
        return groups;
    }, [transcriptData]);

    // Calculate semester GPAs from records
    const semesterSummaries = useMemo(() => {
        if (!transcriptData?.records) return {};
        const summaries: Record<string, { gpa: number; credits: number; courses: number }> = {};
        Object.entries(groupedRecords).forEach(([semester, records]) => {
            const graded = records.filter((r) => r.letterGrade && gradePoints[r.letterGrade] !== undefined && r.enrollmentStatus === 'COMPLETED');
            const credits = graded.reduce((sum, r) => sum + r.credits, 0);
            const points = graded.reduce((sum, r) => sum + (gradePoints[r.letterGrade!] * r.credits), 0);
            const gpa = credits > 0 ? points / credits : 0;
            summaries[semester] = { gpa: Number(gpa.toFixed(2)), credits, courses: records.length };
        });
        return summaries;
    }, [groupedRecords, transcriptData]);

    const transcriptRecords = transcriptData?.records ?? [];
    const hasTranscriptRecords = transcriptRecords.length > 0;

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-gray-500">Loading transcript...</p>
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
                        <span className="text-gray-600">Academic Transcript</span>
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
                            <FileText className="h-7 w-7 text-primary" />
                            Academic Transcript
                        </h2>
                        <p className="text-gray-500 mt-1">View your official academic record and GPA</p>
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
                                        {semesters.map((sem) => (
                                            <option key={sem.id} value={sem.id}>
                                                {sem.name} {(sem.status === 'IN_PROGRESS' || sem.status === 'ADD_DROP_OPEN') ? '(Current)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                                </div>
                            </div>
                        )}
                        <Link href="/dashboard/grades">
                            <Button variant="outline" size="sm">View Grades</Button>
                        </Link>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchTranscript}>Try Again</Button>
                    </div>
                )}

                {/* Empty State */}
                {!error && (!transcriptData || !hasTranscriptRecords) && (
                    <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                        <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Transcript Available</h3>
                        <p className="text-gray-500 mb-4">
                            {selectedSemester
                                ? 'No records found for the selected semester.'
                                : 'You don\'t have any completed courses yet. Your transcript will appear here once you finish courses and receive grades.'}
                        </p>
                        <Link href="/dashboard/enrollments">
                            <Button>View Enrollments</Button>
                        </Link>
                    </div>
                )}

                {/* Content - Transcript Summary + Records */}
                {!error && transcriptData && hasTranscriptRecords && (
                    <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-md p-5 text-white">
                                <div className="flex items-center gap-2 mb-2 opacity-90">
                                    <TrendingUp className="h-4 w-4" />
                                    <span className="text-sm font-medium">Cumulative GPA</span>
                                </div>
                                <p className="text-4xl font-bold">{transcriptData.summary.cumulativeGPA.toFixed(2)}</p>
                                <p className="text-xs text-blue-100 mt-1">out of 4.00</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 rounded-lg bg-emerald-50">
                                        <Award className="h-4 w-4 text-emerald-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Earned Credits</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{transcriptData.summary.totalEarnedCredits}</p>
                                <p className="text-xs text-gray-400 mt-1">completed</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 rounded-lg bg-amber-50">
                                        <Clock className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Attempted Credits</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{transcriptData.summary.totalAttemptedCredits}</p>
                                <p className="text-xs text-gray-400 mt-1">registered</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 rounded-lg bg-violet-50">
                                        <BookOpen className="h-4 w-4 text-violet-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Total Courses</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{transcriptData.summary.totalCourses}</p>
                                <p className="text-xs text-gray-400 mt-1">{transcriptData.summary.gradeCount} with grades</p>
                            </div>
                            <div className="bg-white rounded-lg shadow-sm border p-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 rounded-lg bg-cyan-50">
                                        <GraduationCap className="h-4 w-4 text-cyan-600" />
                                    </div>
                                    <span className="text-sm text-gray-500">Credits Left</span>
                                </div>
                                <p className="text-3xl font-bold text-gray-900">{Math.max(0, transcriptData.summary.totalAttemptedCredits - transcriptData.summary.totalEarnedCredits)}</p>
                                <p className="text-xs text-gray-400 mt-1">to complete</p>
                            </div>
                        </div>

                        {/* Records by Semester */}
                        {Object.entries(groupedRecords).map(([semesterName, records]) => {
                            const summary = semesterSummaries[semesterName];
                            return (
                                <div key={semesterName} className="mb-6">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                                            <Calendar className="h-4 w-4 text-gray-500" />
                                            {semesterName}
                                        </h3>
                                        {summary && summary.courses > 0 && (
                                            <div className="flex items-center gap-4 text-sm">
                                                <span className="text-gray-600">
                                                    {summary.courses} course{summary.courses !== 1 ? 's' : ''} | {summary.credits} credits
                                                </span>
                                                <span className="font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                                    Semester GPA: {summary.gpa.toFixed(2)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-gray-50 border-b">
                                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Course Code</th>
                                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Course Name</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Credits</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Section</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Score</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Grade</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Points</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Grade Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {records.map((record) => (
                                                        <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-4 py-3 font-medium text-gray-900">{record.courseCode}</td>
                                                            <td className="px-4 py-3 text-gray-700">{record.courseName}</td>
                                                            <td className="px-4 py-3 text-center text-gray-600">{record.credits}</td>
                                                            <td className="px-4 py-3 text-center text-gray-600">{record.sectionCode}</td>
                                                            <td className="px-4 py-3 text-center text-gray-700 font-medium">
                                                                {record.finalGrade !== null ? record.finalGrade.toFixed(1) : '-'}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {record.letterGrade ? (
                                                                    <span className={`inline-flex items-center justify-center min-w-[2.5rem] h-7 rounded-md text-sm font-bold border ${gradeColorClass(record.letterGrade)}`}>
                                                                        {record.letterGrade}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-gray-400">-</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-gray-600">
                                                                {record.gradePoint !== null ? record.gradePoint.toFixed(1) : '-'}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-sm">
                                                                {enrollmentStatusBadge(record.enrollmentStatus)}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {statusBadge(record.gradeStatus)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </main>
        </div>
    );
}
