'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { departmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Building2,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
    Search,
} from 'lucide-react';

interface Department {
    id: string;
    name: string;
    code: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
}

export default function AdminDepartmentsPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [departments, setDepartments] = useState<Department[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingDept, setEditingDept] = useState<Department | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        description: '',
    });
    const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

    useEffect(() => {
        if (user && !isAdmin && !isSuperAdmin) {
            router.push('/dashboard');
        }
    }, [user, isAdmin, isSuperAdmin, router]);

    const fetchDepartments = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await departmentsApi.getAll({ page, limit: 20 });
            let filteredData = response.data;
            if (search) {
                filteredData = response.data.filter((d: Department) =>
                    d.name.toLowerCase().includes(search.toLowerCase()) ||
                    d.code.toLowerCase().includes(search.toLowerCase())
                );
            }
            setDepartments(filteredData);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load departments');
            toast.error('Failed to load departments');
        } finally {
            setIsLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        if (canAccess) {
            void fetchDepartments();
        }
    }, [canAccess, fetchDepartments]);

    if (!canAccess) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchDepartments();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this department?')) return;
        
        try {
            await departmentsApi.delete(id);
            toast.success('Department deleted successfully');
            fetchDepartments();
        } catch {
            toast.error('Failed to delete department');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingDept) {
                await departmentsApi.update(editingDept.id, formData);
                toast.success('Department updated successfully');
            } else {
                await departmentsApi.create(formData);
                toast.success('Department created successfully');
            }
            setShowModal(false);
            setEditingDept(null);
            setFormData({ name: '', code: '', description: '' });
            fetchDepartments();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (dept: Department) => {
        setEditingDept(dept);
        setFormData({
            name: dept.name,
            code: dept.code,
            description: dept.description || '',
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
                        <span className="text-gray-300">Department Management</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-300">Welcome, {user?.firstName}</span>
                        <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Building2 className="h-7 w-7 text-primary" />
                            Department Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage academic departments</p>
                    </div>
                    <Button onClick={() => { setEditingDept(null); setFormData({ name: '', code: '', description: '' }); setShowModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create Department
                    </Button>
                </div>

                <form onSubmit={handleSearch} className="mb-6 flex gap-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name or code..."
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
                        <Button variant="outline" onClick={fetchDepartments}>Try Again</Button>
                    </div>
                )}

                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Description</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {departments.map((dept) => (
                                        <tr key={dept.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{dept.code}</td>
                                            <td className="px-4 py-3 text-gray-600">{dept.name}</td>
                                            <td className="px-4 py-3 text-gray-600">{dept.description || '-'}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    dept.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {dept.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => openEdit(dept)}
                                                        aria-label={`Edit department ${dept.name}`}
                                                        title={`Edit department ${dept.name}`}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        onClick={() => handleDelete(dept.id)}
                                                        aria-label={`Delete department ${dept.name}`}
                                                        title={`Delete department ${dept.name}`}
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

                        {departments.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No departments found</p>
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
                        <h3 className="text-lg font-semibold mb-4">{editingDept ? 'Edit Department' : 'Create Department'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Code *</label>
                                    <input
                                        type="text"
                                        value={formData.code}
                                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                        disabled={!!editingDept}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Name *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Description</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={3}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => { setShowModal(false); setEditingDept(null); }}>Cancel</Button>
                                <Button type="submit">{editingDept ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
