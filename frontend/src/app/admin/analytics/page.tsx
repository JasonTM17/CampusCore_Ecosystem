'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    ArrowLeft,
    Users,
    BookOpen,
    GraduationCap,
    Building2,
    MapPin,
    Calendar,
    BarChart3,
    TrendingUp,
    AlertCircle,
    RefreshCw,
} from 'lucide-react';

interface AnalyticsOverview {
    totalStudents: number;
    totalLecturers: number;
    totalCourses: number;
    totalSections: number;
    totalEnrollments: number;
    totalDepartments: number;
    totalFaculties: number;
    totalAcademicYears: number;
    totalSemesters: number;
    totalClassrooms: number;
}

interface SemesterEnrollment {
    semesterId: string;
    semesterName: string;
    academicYear: number;
    enrollmentCount: number;
}

interface SectionOccupancy {
    sectionId: string;
    sectionNumber: string;
    courseCode: string;
    courseName: string;
    semesterName: string;
    capacity: number;
    enrolledCount: number;
    occupancyRate: number;
}

interface GradeDistribution {
    grade: string;
    count: number;
    percentage: number;
}

interface EnrollmentTrend {
    month: string;
    enrolled: number;
    dropped: number;
    completed: number;
}

const gradeColors: Record<string, string> = {
    'A': 'bg-emerald-500',
    'A-': 'bg-emerald-400',
    'B+': 'bg-blue-500',
    'B': 'bg-blue-400',
    'B-': 'bg-blue-300',
    'C+': 'bg-amber-500',
    'C': 'bg-amber-400',
    'C-': 'bg-amber-300',
    'D+': 'bg-orange-500',
    'D': 'bg-orange-400',
    'D-': 'bg-orange-300',
    'F': 'bg-red-500',
};

export default function AdminAnalyticsPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
    const [enrollmentsBySemester, setEnrollmentsBySemester] = useState<SemesterEnrollment[]>([]);
    const [sectionOccupancy, setSectionOccupancy] = useState<SectionOccupancy[]>([]);
    const [gradeDistribution, setGradeDistribution] = useState<GradeDistribution[]>([]);
    const [enrollmentTrends, setEnrollmentTrends] = useState<EnrollmentTrend[]>([]);

    useEffect(() => {
        if (user && !isAdmin && !isSuperAdmin) {
            router.push('/dashboard');
        }
    }, [user, isAdmin, isSuperAdmin, router]);

    if (!user || (!isAdmin && !isSuperAdmin)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [overviewData, semesterData, occupancyData, gradeData, trendsData] = await Promise.all([
                analyticsApi.getOverview(),
                analyticsApi.getEnrollmentsBySemester(),
                analyticsApi.getSectionOccupancy(),
                analyticsApi.getGradeDistribution(),
                analyticsApi.getEnrollmentTrends(),
            ]);

            setOverview(overviewData);
            setEnrollmentsBySemester(semesterData);
            setSectionOccupancy(occupancyData);
            setGradeDistribution(gradeData);
            setEnrollmentTrends(trendsData);
        } catch (err) {
            setError('Failed to load analytics data');
            toast.error('Failed to load analytics data');
        } finally {
            setIsLoading(false);
        }
    };

    const stats = [
        { label: 'Total Students', value: overview?.totalStudents || 0, icon: Users, color: 'bg-blue-500' },
        { label: 'Total Lecturers', value: overview?.totalLecturers || 0, icon: GraduationCap, color: 'bg-purple-500' },
        { label: 'Total Courses', value: overview?.totalCourses || 0, icon: BookOpen, color: 'bg-green-500' },
        { label: 'Total Sections', value: overview?.totalSections || 0, icon: BarChart3, color: 'bg-orange-500' },
        { label: 'Total Enrollments', value: overview?.totalEnrollments || 0, icon: TrendingUp, color: 'bg-cyan-500' },
        { label: 'Departments', value: overview?.totalDepartments || 0, icon: Building2, color: 'bg-pink-500' },
        { label: 'Faculties', value: overview?.totalFaculties || 0, icon: Building2, color: 'bg-indigo-500' },
        { label: 'Classrooms', value: overview?.totalClassrooms || 0, icon: MapPin, color: 'bg-teal-500' },
    ];

    const maxEnrollment = Math.max(...enrollmentsBySemester.map(s => s.enrollmentCount), 1);
    const maxOccupancy = Math.max(...sectionOccupancy.map(s => s.occupancyRate), 1);

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-slate-800 text-white shadow-sm">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <Link href="/admin" className="flex items-center gap-2 text-gray-300 hover:text-white">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <h1 className="text-xl font-bold">CampusCore Admin</h1>
                        <span className="text-gray-500">|</span>
                        <span className="text-gray-300">Reports & Analytics</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            className="text-white border-gray-600 hover:bg-gray-700"
                            onClick={fetchAnalytics}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <span className="text-gray-300">Welcome, {user.firstName}</span>
                        <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <BarChart3 className="h-7 w-7 text-primary" />
                            Reports & Analytics
                        </h2>
                        <p className="text-gray-500 mt-1">Overview of campus data and enrollment statistics</p>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchAnalytics}>Try Again</Button>
                    </div>
                )}

                {isLoading && !overview && (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                    </div>
                )}

                {!error && overview && (
                    <>
                        {/* Overview Cards */}
                        <div className="mb-8">
                            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <BarChart3 className="h-5 w-5" />
                                Overview
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
                                {stats.map((stat) => (
                                    <div key={stat.label} className="bg-white p-4 rounded-lg shadow-sm border">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${stat.color}`}>
                                                <stat.icon className="h-5 w-5 text-white" />
                                            </div>
                                            <div>
                                                <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
                                                <p className="text-sm text-gray-500">{stat.label}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Enrollments by Semester */}
                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div className="bg-white p-6 rounded-lg shadow-sm border">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Calendar className="h-5 w-5" />
                                    Enrollments by Semester
                                </h3>
                                {enrollmentsBySemester.length === 0 ? (
                                    <p className="text-gray-500 text-center py-8">No enrollment data available</p>
                                ) : (
                                    <div className="space-y-3">
                                        {enrollmentsBySemester.map((sem) => (
                                            <div key={sem.semesterId}>
                                                <div className="flex justify-between text-sm mb-1">
                                                    <span className="font-medium">{sem.semesterName}</span>
                                                    <span className="text-gray-500">{sem.enrollmentCount} students</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2">
                                                    <div
                                                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                                        style={{ width: `${(sem.enrollmentCount / maxEnrollment) * 100}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Grade Distribution */}
                            <div className="bg-white p-6 rounded-lg shadow-sm border">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <TrendingUp className="h-5 w-5" />
                                    Grade Distribution
                                </h3>
                                {gradeDistribution.length === 0 || gradeDistribution.every(g => g.count === 0) ? (
                                    <p className="text-gray-500 text-center py-8">No grade data available</p>
                                ) : (
                                    <div className="space-y-2">
                                        {gradeDistribution.map((grade) => (
                                            <div key={grade.grade} className="flex items-center gap-3">
                                                <span className="w-8 text-sm font-medium">{grade.grade}</span>
                                                <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                                                    <div
                                                        className={`h-full ${gradeColors[grade.grade] || 'bg-gray-400'} transition-all duration-300`}
                                                        style={{ width: `${grade.percentage}%` }}
                                                    ></div>
                                                </div>
                                                <span className="w-16 text-right text-sm text-gray-500">
                                                    {grade.count} ({grade.percentage}%)
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Section Occupancy */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border mb-6">
                            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Section Occupancy (Top 10)
                            </h3>
                            {sectionOccupancy.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No section data available</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="text-left py-2 px-2 font-medium text-gray-600">Course</th>
                                                <th className="text-left py-2 px-2 font-medium text-gray-600">Section</th>
                                                <th className="text-left py-2 px-2 font-medium text-gray-600">Semester</th>
                                                <th className="text-right py-2 px-2 font-medium text-gray-600">Capacity</th>
                                                <th className="text-right py-2 px-2 font-medium text-gray-600">Enrolled</th>
                                                <th className="text-right py-2 px-2 font-medium text-gray-600">Occupancy</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {sectionOccupancy.slice(0, 10).map((section) => (
                                                <tr key={section.sectionId} className="hover:bg-gray-50">
                                                    <td className="py-2 px-2">
                                                        <div>
                                                            <p className="font-medium">{section.courseCode}</p>
                                                            <p className="text-gray-500 text-xs">{section.courseName}</p>
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-2">{section.sectionNumber}</td>
                                                    <td className="py-2 px-2 text-gray-600">{section.semesterName}</td>
                                                    <td className="py-2 px-2 text-right">{section.capacity}</td>
                                                    <td className="py-2 px-2 text-right">{section.enrolledCount}</td>
                                                    <td className="py-2 px-2 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <div className="w-16 bg-gray-200 rounded-full h-2">
                                                                <div
                                                                    className={`h-2 rounded-full ${
                                                                        section.occupancyRate >= 90 ? 'bg-red-500' :
                                                                        section.occupancyRate >= 70 ? 'bg-yellow-500' :
                                                                        'bg-green-500'
                                                                    }`}
                                                                    style={{ width: `${Math.min(section.occupancyRate, 100)}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className="text-xs font-medium w-10 text-right">
                                                                {section.occupancyRate}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Enrollment Trends */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border">
                            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Enrollment Trends (Last 6 Months)
                            </h3>
                            {enrollmentTrends.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No trend data available</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-4">
                                    {enrollmentTrends.map((trend) => (
                                        <div key={trend.month} className="p-4 bg-gray-50 rounded-lg">
                                            <p className="text-sm font-medium text-gray-600 mb-3">{trend.month}</p>
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <span className="text-xs text-gray-500">Enrolled</span>
                                                    <span className="text-xs font-medium text-blue-600">{trend.enrolled}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-xs text-gray-500">Completed</span>
                                                    <span className="text-xs font-medium text-green-600">{trend.completed}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-xs text-gray-500">Dropped</span>
                                                    <span className="text-xs font-medium text-red-600">{trend.dropped}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
