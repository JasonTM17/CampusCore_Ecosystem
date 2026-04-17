'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { sectionsApi } from '@/lib/api';
import { SectionGrades, StudentGrade, GradeUpdate } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    ArrowLeft,
    Save,
    Send,
    AlertCircle,
    CheckCircle,
    Users,
    BookOpen,
    Calendar,
} from 'lucide-react';

const letterGrades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

const calculateGrade = (score: number): string => {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 67) return 'D+';
    if (score >= 63) return 'D';
    if (score >= 60) return 'D-';
    return 'F';
};

export default function SectionGradingPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { user, logout, isLecturer } = useAuth();
    const router = useRouter();
    const [sectionData, setSectionData] = useState<SectionGrades | null>(null);
    const [grades, setGrades] = useState<Map<string, GradeUpdate>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchSectionGrades = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await sectionsApi.getSectionGrades(id) as SectionGrades;
            setSectionData(data);

            const gradeMap = new Map<string, GradeUpdate>();
            data.enrollments.forEach((enrollment: { id: string; finalGrade?: number; letterGrade?: string }) => {
                gradeMap.set(enrollment.id, {
                    enrollmentId: enrollment.id,
                    finalGrade: enrollment.finalGrade ?? 0,
                    letterGrade: enrollment.letterGrade ?? calculateGrade(enrollment.finalGrade ?? 0),
                });
            });
            setGrades(gradeMap);
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to load section grades';
            setError(errorMsg);
            toast.error(errorMsg);
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    // Redirect non-lecturers
    useEffect(() => {
        if (!isLecturer && user) {
            router.push('/dashboard');
        }
    }, [isLecturer, user, router]);

    useEffect(() => {
        void fetchSectionGrades();
    }, [fetchSectionGrades]);

    if (!isLecturer || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const handleGradeChange = (enrollmentId: string, field: 'finalGrade' | 'letterGrade', value: number | string) => {
        setGrades((prev) => {
            const newMap = new Map(prev);
            const existing = newMap.get(enrollmentId) || { enrollmentId, finalGrade: 0, letterGrade: 'F' };
            
            if (field === 'finalGrade') {
                existing.finalGrade = value as number;
                existing.letterGrade = calculateGrade(value as number);
            } else {
                existing.letterGrade = value as string;
            }
            
            newMap.set(enrollmentId, existing);
            return newMap;
        });
    };

    const handleSaveGrades = async () => {
        setIsSaving(true);
        try {
            const gradeArray = Array.from(grades.values());
            await sectionsApi.updateSectionGrades(id, gradeArray);
            toast.success('Grades saved successfully');
            fetchSectionGrades();
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to save grades';
            toast.error(errorMsg);
        } finally {
            setIsSaving(false);
        }
    };

    const handlePublishGrades = async () => {
        if (!confirm('Are you sure you want to publish these grades? This action cannot be undone.')) {
            return;
        }
        
        setIsPublishing(true);
        try {
            await sectionsApi.publishSectionGrades(id);
            toast.success('Grades published successfully');
            fetchSectionGrades();
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to publish grades';
            toast.error(errorMsg);
        } finally {
            setIsPublishing(false);
        }
    };

    const hasChanges = () => {
        if (!sectionData) return false;
        return sectionData.enrollments.some((enrollment) => {
            const current = grades.get(enrollment.id);
            if (!current) return false;
            return current.finalGrade !== (enrollment.finalGrade ?? 0) || 
                   current.letterGrade !== (enrollment.letterGrade ?? 'F');
        });
    };

    const allGraded = () => {
        if (!sectionData) return false;
        return sectionData.enrollments.every((e) => e.letterGrade !== null);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-gray-500">Loading section...</p>
                </div>
            </div>
        );
    }

    if (error || !sectionData) {
        return (
            <div className="min-h-screen bg-gray-50">
                <nav className="bg-white shadow-sm border-b">
                    <div className="container mx-auto px-4 py-4">
                        <Link href="/dashboard/lecturer/grades" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Grade Management
                        </Link>
                    </div>
                </nav>
                <div className="container mx-auto px-4 py-8">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error || 'Section not found'}</p>
                        <Link href="/dashboard/lecturer/grades">
                            <Button variant="outline">Back to Grades</Button>
                        </Link>
                    </div>
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
                        <Link href="/dashboard/lecturer/grades" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold">CampusCore</h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-600">Welcome, {user?.firstName}</span>
                        <Button variant="outline" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <h2 className="text-2xl font-bold">
                                    {sectionData.courseCode} - Section {sectionData.sectionNumber}
                                </h2>
                                {sectionData.status === 'CLOSED' ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Closed</span>
                                ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Open</span>
                                )}
                            </div>
                            <p className="text-gray-600">{sectionData.courseName} ({sectionData.credits} credits)</p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                    <BookOpen className="h-4 w-4" />
                                    {sectionData.departmentName}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    {sectionData.semester}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Users className="h-4 w-4" />
                                    {sectionData.enrollments.length} students
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button 
                                variant="outline" 
                                onClick={handleSaveGrades}
                                disabled={isSaving || !hasChanges()}
                            >
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                Save Grades
                            </Button>
                            <Button 
                                onClick={handlePublishGrades}
                                disabled={isPublishing || !allGraded()}
                            >
                                {isPublishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                                Publish Grades
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Warning */}
                {!allGraded() && sectionData.enrollments.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                        <p className="text-amber-800 text-sm">
                            Not all students have grades yet. You must enter grades for all students before publishing.
                        </p>
                    </div>
                )}

                {/* Grades Table */}
                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b">
                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Student ID</th>
                                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                                    <th className="text-center px-4 py-3 font-semibold text-gray-600 w-32">Score (0-100)</th>
                                    <th className="text-center px-4 py-3 font-semibold text-gray-600 w-32">Letter Grade</th>
                                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {sectionData.enrollments.map((enrollment) => {
                                    const grade = grades.get(enrollment.id);
                                    const isPublished = enrollment.gradeStatus === 'PUBLISHED';
                                    
                                    return (
                                        <tr key={enrollment.id} className={`hover:bg-gray-50 transition-colors ${isPublished ? 'bg-green-50' : ''}`}>
                                            <td className="px-4 py-3">
                                                <span className="font-medium text-gray-900">{enrollment.studentName}</span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{enrollment.studentCode}</td>
                                            <td className="px-4 py-3 text-gray-600">{enrollment.email}</td>
                                            <td className="px-4 py-3">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.1"
                                                    value={grade?.finalGrade ?? 0}
                                                    onChange={(e) => handleGradeChange(enrollment.id, 'finalGrade', parseFloat(e.target.value) || 0)}
                                                    disabled={isPublished}
                                                    className="w-full px-3 py-2 border rounded-md text-center focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={grade?.letterGrade ?? 'F'}
                                                    onChange={(e) => handleGradeChange(enrollment.id, 'letterGrade', e.target.value)}
                                                    disabled={isPublished}
                                                    className="w-full px-3 py-2 border rounded-md text-center focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                >
                                                    {letterGrades.map((lg) => (
                                                        <option key={lg} value={lg}>{lg}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {isPublished ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                        <CheckCircle className="h-3 w-3" /> Published
                                                    </span>
                                                ) : enrollment.enrollmentStatus === 'COMPLETED' ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                                        Saved
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                                        Not Graded
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {sectionData.enrollments.length === 0 && (
                        <div className="p-12 text-center">
                            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">No Enrolled Students</h3>
                            <p className="text-gray-500">There are no students enrolled in this section.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
