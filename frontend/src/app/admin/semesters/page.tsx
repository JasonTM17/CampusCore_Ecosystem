'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { adminSemestersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    Calendar,
    Search,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
} from 'lucide-react';

interface Semester {
    id: string;
    name: string;
    type: string;
    academicYearId: string;
    academicYear?: { year: number };
    startDate: string;
    endDate: string;
    status: string;
}

export default function AdminSemestersPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingSemester, setEditingSemester] = useState<Semester | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        type: 'FALL',
        academicYearId: '',
        startDate: '',
        endDate: '',
    });
    const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

    // Redirect non-admins
    useEffect(() => {
        if (user && !isAdmin && !isSuperAdmin) {
            router.push('/dashboard');
        }
    }, [user, isAdmin, isSuperAdmin, router]);

    const fetchSemesters = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await adminSemestersApi.getAll({ page, limit: 20 });
            setSemesters(response.data);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load semesters');
            toast.error('Failed to load semesters');
        } finally {
            setIsLoading(false);
        }
    }, [page]);

    useEffect(() => {
        if (canAccess) {
            void fetchSemesters();
        }
    }, [canAccess, fetchSemesters]);

    if (!canAccess) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this semester?')) return;
        
        try {
            await adminSemestersApi.delete(id);
            toast.success('Semester deleted successfully');
            fetchSemesters();
        } catch {
            toast.error('Failed to delete semester');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingSemester) {
                await adminSemestersApi.update(editingSemester.id, formData);
                toast.success('Semester updated successfully');
            } else {
                await adminSemestersApi.create(formData);
                toast.success('Semester created successfully');
            }
            setShowModal(false);
            setEditingSemester(null);
            setFormData({ name: '', type: 'FALL', academicYearId: '', startDate: '', endDate: '' });
            fetchSemesters();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (semester: Semester) => {
        setEditingSemester(semester);
        setFormData({
            name: semester.name,
            type: semester.type,
            academicYearId: semester.academicYearId,
            startDate: semester.startDate.split('T')[0],
            endDate: semester.endDate.split('T')[0],
        });
        setShowModal(true);
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            'ACTIVE': 'bg-green-100 text-green-700',
            'REGISTRATION_OPEN': 'bg-blue-100 text-blue-700',
            'ADD_DROP_OPEN': 'bg-cyan-100 text-cyan-700',
            'IN_PROGRESS': 'bg-purple-100 text-purple-700',
            'CLOSED': 'bg-gray-100 text-gray-700',
            'ARCHIVED': 'bg-slate-100 text-slate-700',
        };
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
                {status.replace(/_/g, ' ')}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Navigation */}
            <nav className="bg-slate-800 text-white shadow-sm">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <Link href="/admin" className="flex items-center gap-2 text-gray-300 hover:text-white">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <h1 className="text-xl font-bold">CampusCore Admin</h1>
                        <span className="text-gray-500">|</span>
                        <span className="text-gray-300">Semester Management</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-300">Welcome, {user?.firstName}</span>
                        <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Calendar className="h-7 w-7 text-primary" />
                            Semester Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage academic semesters</p>
                    </div>
                    <Button onClick={() => { setEditingSemester(null); setFormData({ name: '', type: 'FALL', academicYearId: '', startDate: '', endDate: '' }); setShowModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create Semester
                    </Button>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchSemesters}>Try Again</Button>
                    </div>
                )}

                {/* Semesters Table */}
                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Academic Year</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Start Date</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">End Date</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {semesters.map((semester) => (
                                        <tr key={semester.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{semester.name}</td>
                                            <td className="px-4 py-3 text-gray-600">{semester.type}</td>
                                            <td className="px-4 py-3 text-gray-600">{semester.academicYear?.year || '-'}</td>
                                            <td className="px-4 py-3 text-gray-600">{new Date(semester.startDate).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-gray-600">{new Date(semester.endDate).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-center">{getStatusBadge(semester.status)}</td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => openEdit(semester)}
                                                        aria-label={`Edit semester ${semester.name}`}
                                                        title={`Edit semester ${semester.name}`}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        onClick={() => handleDelete(semester.id)}
                                                        aria-label={`Delete semester ${semester.name}`}
                                                        title={`Delete semester ${semester.name}`}
                                                    >
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
                        {semesters.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No semesters found</p>
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
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

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                        <h3 className="text-lg font-semibold mb-4">{editingSemester ? 'Edit Semester' : 'Create Semester'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Semester Name</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., Fall 2026"
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Type</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    <option value="FALL">Fall</option>
                                    <option value="SPRING">Spring</option>
                                    <option value="SUMMER">Summer</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Academic Year ID</label>
                                <input
                                    type="text"
                                    value={formData.academicYearId}
                                    onChange={(e) => setFormData({ ...formData, academicYearId: e.target.value })}
                                    placeholder="e.g., 2026"
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Start Date</label>
                                    <input
                                        type="date"
                                        value={formData.startDate}
                                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">End Date</label>
                                    <input
                                        type="date"
                                        value={formData.endDate}
                                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => { setShowModal(false); setEditingSemester(null); }}>Cancel</Button>
                                <Button type="submit">{editingSemester ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
