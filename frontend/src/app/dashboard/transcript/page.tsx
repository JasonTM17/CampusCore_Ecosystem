'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { gradesApi } from '@/lib/api';
import { StudentTranscript } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    GraduationCap,
    TrendingUp,
    BookOpen,
    AlertCircle,
    Award,
    CalendarDays
} from 'lucide-react';

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
        case 'COMPLETED':
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Completed</span>;
        default:
            return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{status}</span>;
    }
};

export default function TranscriptPage() {
    const { user, logout } = useAuth();
    const [transcript, setTranscript] = useState<StudentTranscript | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTranscript();
    }, []);

    const fetchTranscript = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await gradesApi.getMyTranscript();
            setTranscript(data);
        } catch {
            setError('Failed to load transcript. Please try again.');
            toast.error('Failed to load transcript');
        } finally {
            setIsLoading(false);
        }
    };

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
                        <span className="text-gray-600">Official Transcript</span>
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
                            Academic Transcript
                        </h2>
                        <p className="text-gray-500 mt-1">Official summary of your academic progress and cumulative GPA</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard/grades">
                            <Button variant="outline" size="sm">View Recent Grades</Button>
                        </Link>
                        {/* Room for future PDF export */}
                        <Button size="sm" className="gap-2">
                            <GraduationCap className="h-4 w-4" /> Export PDF
                        </Button>
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
                {!error && transcript && transcript.semesters.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                        <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Records Found</h3>
                        <p className="text-gray-500 mb-4">You do not have any official transcript records yet.</p>
                        <Link href="/dashboard">
                            <Button>Return to Dashboard</Button>
                        </Link>
                    </div>
                )}

                {/* Content */}
                {!error && transcript && transcript.semesters.length > 0 && (
                    <div className="space-y-8">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white rounded-lg shadow-sm border border-primary/20 p-6 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-6 opacity-5">
                                    <TrendingUp className="h-24 w-24" />
                                </div>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-blue-50">
                                        <TrendingUp className="h-6 w-6 text-blue-600" />
                                    </div>
                                    <span className="text-lg font-medium text-gray-700">Cumulative GPA</span>
                                </div>
                                <p className="text-4xl font-bold text-gray-900 mt-2">{transcript.summary.cumulativeGpa.toFixed(2)}</p>
                                <p className="text-sm text-gray-500 mt-1">on a 4.0 scale</p>
                            </div>

                            <div className="bg-white rounded-lg shadow-sm border p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-emerald-50">
                                        <Award className="h-6 w-6 text-emerald-600" />
                                    </div>
                                    <span className="text-lg font-medium text-gray-700">Credits Earned</span>
                                </div>
                                <p className="text-4xl font-bold text-gray-900 mt-2">{transcript.summary.totalCreditsEarned}</p>
                                <p className="text-sm text-gray-500 mt-1">Total passed credits</p>
                            </div>

                            <div className="bg-white rounded-lg shadow-sm border p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-amber-50">
                                        <GraduationCap className="h-6 w-6 text-amber-600" />
                                    </div>
                                    <span className="text-lg font-medium text-gray-700">Credits Attempted</span>
                                </div>
                                <p className="text-4xl font-bold text-gray-900 mt-2">{transcript.summary.totalCreditsAttempted}</p>
                                <p className="text-sm text-gray-500 mt-1">Total registered credits</p>
                            </div>
                        </div>

                        {/* Semesters List */}
                        <div className="space-y-8">
                            {transcript.semesters.map((sem) => (
                                <div key={sem.semesterId} className="bg-white rounded-lg shadow-sm border overflow-hidden">
                                    <div className="bg-gray-50 border-b px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <CalendarDays className="h-5 w-5 text-primary" />
                                            <h3 className="text-lg font-bold text-gray-900">{sem.semesterName}</h3>
                                        </div>
                                        <div className="flex items-center gap-6 text-sm">
                                            <div>
                                                <span className="text-gray-500">Credits:</span>
                                                <span className="ml-2 font-medium bg-gray-200 px-2 py-1 rounded text-gray-800">{sem.creditsEarned} / {sem.creditsAttempted}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">GPA:</span>
                                                <span className="ml-2 font-bold text-primary text-base">{sem.gpa.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-white border-b">
                                                    <th className="text-left px-6 py-3 font-semibold text-gray-600">Course Code</th>
                                                    <th className="text-left px-6 py-3 font-semibold text-gray-600">Course Name</th>
                                                    <th className="text-center px-6 py-3 font-semibold text-gray-600">Credits</th>
                                                    <th className="text-center px-6 py-3 font-semibold text-gray-600">Score</th>
                                                    <th className="text-center px-6 py-3 font-semibold text-gray-600">Grade</th>
                                                    <th className="text-center px-6 py-3 font-semibold text-gray-600">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {sem.records.map((grade) => (
                                                    <tr key={grade.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-3 font-medium text-gray-900">{grade.courseCode}</td>
                                                        <td className="px-6 py-3 text-gray-700">{grade.courseName}</td>
                                                        <td className="px-6 py-3 text-center text-gray-600">{grade.credits}</td>
                                                        <td className="px-6 py-3 text-center text-gray-700 font-medium">
                                                            {grade.finalGrade !== null ? grade.finalGrade.toFixed(1) : '—'}
                                                        </td>
                                                        <td className="px-6 py-3 text-center">
                                                            {grade.letterGrade ? (
                                                                <span className={`inline-flex items-center justify-center w-10 h-7 rounded-md text-sm font-bold ${gradeColorClass(grade.letterGrade)}`}>
                                                                    {grade.letterGrade}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3 text-center">
                                                            {statusBadge(grade.enrollmentStatus === 'COMPLETED' ? 'COMPLETED' : grade.gradeStatus)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
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
