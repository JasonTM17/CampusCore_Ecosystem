'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { lecturersApi, departmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    GraduationCap,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
    Search,
} from 'lucide-react';

interface Lecturer {
    id: string;
    employeeId: string;
    userId: string;
    departmentId: string;
    specialization?: string;
    isActive: boolean;
    createdAt: string;
    user?: { firstName: string; lastName: string; email: string };
    department?: { name: string };
}

export default function AdminLecturersPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [lecturers, setLecturers] = useState<Lecturer[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingLecturer, setEditingLecturer] = useState<Lecturer | null>(null);
    const [formData, setFormData] = useState({
        employeeId: '',
        userId: '',
        departmentId: '',
        specialization: '',
    });

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
        fetchDepartments();
    }, []);

    useEffect(() => {
        fetchLecturers();
    }, [page]);

    const fetchDepartments = async () => {
        try {
            const response = await departmentsApi.getAll({ limit: 1000 });
            setDepartments(response.data);
        } catch {
            // Ignore error
        }
    };

    const fetchLecturers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await lecturersApi.getAll({ page, limit: 20 });
            let filteredData = response.data;
            if (search) {
                filteredData = response.data.filter((l: Lecturer) =>
                    l.employeeId.toLowerCase().includes(search.toLowerCase()) ||
                    l.user?.firstName?.toLowerCase().includes(search.toLowerCase()) ||
                    l.user?.lastName?.toLowerCase().includes(search.toLowerCase()) ||
                    l.user?.email?.toLowerCase().includes(search.toLowerCase())
                );
            }
            setLecturers(filteredData);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load lecturers');
            toast.error('Failed to load lecturers');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchLecturers();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this lecturer?')) return;
        
        try {
            await lecturersApi.delete(id);
            toast.success('Lecturer deleted successfully');
            fetchLecturers();
        } catch {
            toast.error('Failed to delete lecturer');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingLecturer) {
                await lecturersApi.update(editingLecturer.id, formData);
                toast.success('Lecturer updated successfully');
            } else {
                await lecturersApi.create(formData);
                toast.success('Lecturer created successfully');
            }
            setShowModal(false);
            setEditingLecturer(null);
            setFormData({ employeeId: '', userId: '', departmentId: '', specialization: '' });
            fetchLecturers();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (lecturer: Lecturer) => {
        setEditingLecturer(lecturer);
        setFormData({
            employeeId: lecturer.employeeId,
            userId: lecturer.userId,
            departmentId: lecturer.departmentId,
            specialization: lecturer.specialization || '',
        });
        setShowModal(true);
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
                        <span className="text-gray-300">Lecturer Management</span>
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
                            <GraduationCap className="h-7 w-7 text-primary" />
                            Lecturer Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage lecturer profiles</p>
                    </div>
                    <Button onClick={() => { setEditingLecturer(null); setFormData({ employeeId: '', userId: '', departmentId: '', specialization: '' }); setShowModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create Lecturer
                    </Button>
                </div>

                <form onSubmit={handleSearch} className="mb-6 flex gap-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, email, or employee ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <Button type="submit">Search</Button>
                </form>

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchLecturers}>Try Again</Button>
                    </div>
                )}

                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee ID</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Department</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Specialization</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {lecturers.map((lecturer) => (
                                        <tr key={lecturer.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{lecturer.employeeId}</td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {lecturer.user ? `${lecturer.user.firstName} ${lecturer.user.lastName}` : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{lecturer.user?.email || '-'}</td>
                                            <td className="px-4 py-3 text-gray-600">{lecturer.department?.name || '-'}</td>
                                            <td className="px-4 py-3 text-gray-600">{lecturer.specialization || '-'}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    lecturer.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {lecturer.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button size="sm" variant="ghost" onClick={() => openEdit(lecturer)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(lecturer.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {lecturers.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <GraduationCap className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No lecturers found</p>
                            </div>
                        )}

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

            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                        <h3 className="text-lg font-semibold mb-4">{editingLecturer ? 'Edit Lecturer' : 'Create Lecturer'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Employee ID *</label>
                                <input
                                    type="text"
                                    value={formData.employeeId}
                                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                                    disabled={!!editingLecturer}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">User ID *</label>
                                <input
                                    type="text"
                                    value={formData.userId}
                                    onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                                    disabled={!!editingLecturer}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                    placeholder="Existing user ID to link"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Department *</label>
                                <select
                                    value={formData.departmentId}
                                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                    required
                                >
                                    <option value="">Select Department</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Specialization</label>
                                <input
                                    type="text"
                                    value={formData.specialization}
                                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="e.g., Computer Science"
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => { setShowModal(false); setEditingLecturer(null); }}>Cancel</Button>
                                <Button type="submit">{editingLecturer ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
