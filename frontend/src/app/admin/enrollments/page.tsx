'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi, semestersApi, coursesApi, sectionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    FileText,
    Search,
    ArrowLeft,
    AlertCircle,
    Eye,
    Pencil,
    Trash2,
    X,
} from 'lucide-react';

interface Enrollment {
    id: string;
    studentId: string;
    sectionId: string;
    semesterId: string;
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'DROPPED' | 'CANCELLED';
    enrolledAt: string;
    droppedAt?: string;
    finalGrade?: number;
    letterGrade?: string;
    student?: { 
        user?: { firstName?: string; lastName?: string; email?: string }; 
        studentCode?: string 
    };
    section?: { 
        sectionNumber: string; 
        course?: { code?: string; name?: string };
        lecturer?: { user?: { firstName?: string; lastName?: string } };
    };
    semester?: { name: string };
}

interface Semester {
    id: string;
    name: string;
}

interface Course {
    id: string;
    code: string;
    name: string;
}

interface Section {
    id: string;
    sectionNumber: string;
}

const statusColors: Record<string, string> = {
    'PENDING': 'bg-yellow-100 text-yellow-700',
    'CONFIRMED': 'bg-blue-100 text-blue-700',
    'COMPLETED': 'bg-green-100 text-green-700',
    'DROPPED': 'bg-red-100 text-red-700',
    'CANCELLED': 'bg-gray-100 text-gray-600',
};

export default function AdminEnrollmentsPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [filters, setFilters] = useState({
        semesterId: '',
        courseId: '',
        sectionId: '',
        status: '',
    });
    
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [selectedEnrollment, setSelectedEnrollment] = useState<Enrollment | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // Redirect non-admins
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
        fetchDropdownData();
    }, []);

    useEffect(() => {
        fetchEnrollments();
    }, [page, filters]);

    const fetchDropdownData = async () => {
        try {
            const [semestersRes, coursesRes] = await Promise.all([
                semestersApi.getAll(),
                coursesApi.getAll({ limit: 1000 }),
            ]);
            setSemesters(semestersRes.data);
            setCourses(coursesRes.data);
        } catch (err) {
            console.error('Failed to fetch dropdown data:', err);
        }
    };

    const fetchSectionsForCourse = async (courseId: string) => {
        if (!courseId) {
            setSections([]);
            return;
        }
        try {
            const res = await sectionsApi.getAll({ courseId, limit: 100 });
            setSections(res.data);
        } catch (err) {
            console.error('Failed to fetch sections:', err);
        }
    };

    useEffect(() => {
        if (filters.courseId) {
            fetchSectionsForCourse(filters.courseId);
        } else {
            setSections([]);
        }
    }, [filters.courseId]);

    const fetchEnrollments = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const params: any = { page, limit: 20 };
            if (filters.semesterId) params.semesterId = filters.semesterId;
            if (filters.courseId) params.courseId = filters.courseId;
            if (filters.sectionId) params.sectionId = filters.sectionId;
            if (filters.status) params.status = filters.status;

            const response = await enrollmentsApi.getAll(params);
            setEnrollments(response.data);
            setTotalPages(response.meta?.totalPages || 1);
            setTotal(response.meta?.total || 0);
        } catch (err) {
            setError('Failed to load enrollments');
            toast.error('Failed to load enrollments');
        } finally {
            setIsLoading(false);
        }
    };

    const handleFilterChange = (key: string, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        if (key !== 'courseId' && key !== 'sectionId') {
            setPage(1);
        }
        if (key === 'courseId') {
            setFilters(prev => ({ ...prev, sectionId: '' }));
        }
    };

    const handleClearFilters = () => {
        setFilters({ semesterId: '', courseId: '', sectionId: '', status: '' });
        setPage(1);
    };

    const handleViewDetail = async (enrollment: Enrollment) => {
        try {
            const fullEnrollment = await enrollmentsApi.getById(enrollment.id);
            setSelectedEnrollment(fullEnrollment);
            setIsDetailOpen(true);
        } catch (err) {
            toast.error('Failed to load enrollment details');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this enrollment? This action cannot be undone.')) return;
        
        try {
            await enrollmentsApi.delete(id);
            toast.success('Enrollment deleted successfully');
            fetchEnrollments();
        } catch (err) {
            toast.error('Failed to delete enrollment');
        }
    };

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
                        <span className="text-gray-300">Enrollment Management</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-300">Welcome, {user.firstName}</span>
                        <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <FileText className="h-7 w-7 text-primary" />
                            Enrollment Management
                        </h2>
                        <p className="text-gray-500 mt-1">View and manage course enrollments</p>
                    </div>
                    <div className="text-sm text-gray-500">
                        Total: {total} enrollments
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
                    <div className="flex flex-wrap items-end gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
                            <select
                                value={filters.semesterId}
                                onChange={(e) => handleFilterChange('semesterId', e.target.value)}
                                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                            >
                                <option value="">All Semesters</option>
                                {semesters.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                            <select
                                value={filters.courseId}
                                onChange={(e) => handleFilterChange('courseId', e.target.value)}
                                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                            >
                                <option value="">All Courses</option>
                                {courses.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                            <select
                                value={filters.sectionId}
                                onChange={(e) => handleFilterChange('sectionId', e.target.value)}
                                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[120px]"
                                disabled={!filters.courseId}
                            >
                                <option value="">All Sections</option>
                                {sections.map(s => (
                                    <option key={s.id} value={s.id}>{s.sectionNumber}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                            <select
                                value={filters.status}
                                onChange={(e) => handleFilterChange('status', e.target.value)}
                                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px]"
                            >
                                <option value="">All Statuses</option>
                                <option value="PENDING">Pending</option>
                                <option value="CONFIRMED">Confirmed</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="DROPPED">Dropped</option>
                                <option value="CANCELLED">Cancelled</option>
                            </select>
                        </div>
                        <Button variant="outline" onClick={handleClearFilters}>
                            Clear Filters
                        </Button>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchEnrollments}>Try Again</Button>
                    </div>
                )}

                {/* Enrollments Table */}
                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Course</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Section</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Semester</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Lecturer</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Enrolled Date</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {enrollments.map((enrollment) => (
                                        <tr key={enrollment.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div>
                                                    <p className="font-medium text-gray-900">
                                                        {enrollment.student?.user ? 
                                                            `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}` 
                                                            : enrollment.studentId}
                                                    </p>
                                                    <p className="text-gray-500 text-xs">{enrollment.student?.user?.email}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div>
                                                    <p className="font-medium text-gray-900">{enrollment.section?.course?.code}</p>
                                                    <p className="text-gray-500 text-xs">{enrollment.section?.course?.name}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{enrollment.section?.sectionNumber}</td>
                                            <td className="px-4 py-3 text-gray-600">{enrollment.semester?.name || '-'}</td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {enrollment.section?.lecturer?.user ? 
                                                    `${enrollment.section.lecturer.user.firstName} ${enrollment.section.lecturer.user.lastName}`
                                                    : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[enrollment.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {enrollment.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {new Date(enrollment.enrolledAt).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button size="sm" variant="ghost" onClick={() => handleViewDetail(enrollment)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(enrollment.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Empty state */}
                        {enrollments.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No enrollments found</p>
                            </div>
                        )}

                        {/* Loading */}
                        {isLoading && (
                            <div className="p-8 text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && !isLoading && (
                            <div className="border-t px-4 py-3 flex justify-between items-center">
                                <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                                    <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Detail Modal */}
            {isDetailOpen && selectedEnrollment && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6 my-8 mx-4">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-lg font-semibold">Enrollment Details</h3>
                            <Button variant="ghost" size="sm" onClick={() => setIsDetailOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Student</label>
                                    <p className="text-gray-900">
                                        {selectedEnrollment.student?.user?.firstName} {selectedEnrollment.student?.user?.lastName}
                                    </p>
                                    <p className="text-sm text-gray-500">{selectedEnrollment.student?.user?.email}</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Status</label>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedEnrollment.status] || 'bg-gray-100 text-gray-600'}`}>
                                        {selectedEnrollment.status}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Course</label>
                                    <p className="text-gray-900">
                                        {selectedEnrollment.section?.course?.code} - {selectedEnrollment.section?.course?.name}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Section</label>
                                    <p className="text-gray-900">{selectedEnrollment.section?.sectionNumber}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Semester</label>
                                    <p className="text-gray-900">{selectedEnrollment.semester?.name || '-'}</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Lecturer</label>
                                    <p className="text-gray-900">
                                        {selectedEnrollment.section?.lecturer?.user ? 
                                            `${selectedEnrollment.section.lecturer.user.firstName} ${selectedEnrollment.section.lecturer.user.lastName}`
                                            : '-'}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-500">Enrolled Date</label>
                                    <p className="text-gray-900">
                                        {new Date(selectedEnrollment.enrolledAt).toLocaleString()}
                                    </p>
                                </div>
                                {selectedEnrollment.droppedAt && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-500">Dropped Date</label>
                                        <p className="text-gray-900">
                                            {new Date(selectedEnrollment.droppedAt).toLocaleString()}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {selectedEnrollment.finalGrade && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-500">Final Grade</label>
                                        <p className="text-gray-900">{selectedEnrollment.finalGrade}</p>
                                    </div>
                                    {selectedEnrollment.letterGrade && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-500">Letter Grade</label>
                                            <p className="text-gray-900">{selectedEnrollment.letterGrade}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end">
                            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>Close</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
