'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { academicYearsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    CalendarRange,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
    Search,
} from 'lucide-react';

interface AcademicYear {
    id: string;
    year: number;
    startDate: string;
    endDate: string;
    isActive?: boolean;
    isCurrent?: boolean;
    createdAt?: string;
}

export default function AdminAcademicYearsPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
    const [formData, setFormData] = useState({
        year: new Date().getFullYear(),
        startDate: '',
        endDate: '',
    });
    const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

    useEffect(() => {
        if (user && !isAdmin && !isSuperAdmin) {
            router.push('/dashboard');
        }
    }, [user, isAdmin, isSuperAdmin, router]);

    const fetchAcademicYears = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await academicYearsApi.getAll({ page, limit: 20 });
            let filteredData = response.data;
            if (search) {
                filteredData = response.data.filter((y: AcademicYear) =>
                    y.year.toString().includes(search)
                );
            }
            setAcademicYears(filteredData);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load academic years');
            toast.error('Failed to load academic years');
        } finally {
            setIsLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        if (canAccess) {
            void fetchAcademicYears();
        }
    }, [canAccess, fetchAcademicYears]);

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
        fetchAcademicYears();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this academic year?')) return;
        
        try {
            await academicYearsApi.delete(id);
            toast.success('Academic year deleted successfully');
            fetchAcademicYears();
        } catch {
            toast.error('Failed to delete academic year');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingYear) {
                await academicYearsApi.update(editingYear.id, formData);
                toast.success('Academic year updated successfully');
            } else {
                await academicYearsApi.create(formData);
                toast.success('Academic year created successfully');
            }
            setShowModal(false);
            setEditingYear(null);
            setFormData({ year: new Date().getFullYear(), startDate: '', endDate: '' });
            fetchAcademicYears();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (year: AcademicYear) => {
        setEditingYear(year);
        setFormData({
            year: year.year,
            startDate: year.startDate.split('T')[0],
            endDate: year.endDate.split('T')[0],
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
                        <span className="text-gray-300">Academic Year Management</span>
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
                            <CalendarRange className="h-7 w-7 text-primary" />
                            Academic Year Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage academic years</p>
                    </div>
                    <Button onClick={() => { setEditingYear(null); setFormData({ year: new Date().getFullYear(), startDate: '', endDate: '' }); setShowModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create Academic Year
                    </Button>
                </div>

                <form onSubmit={handleSearch} className="mb-6 flex gap-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by year (e.g., 2026)..."
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
                        <Button variant="outline" onClick={fetchAcademicYears}>Try Again</Button>
                    </div>
                )}

                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Year</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Start Date</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">End Date</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {academicYears.map((year) => (
                                        <tr key={year.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{year.year}</td>
                                            <td className="px-4 py-3 text-gray-600">{new Date(year.startDate).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-gray-600">{new Date(year.endDate).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    (year.isActive ?? year.isCurrent) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {(year.isActive ?? year.isCurrent) ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => openEdit(year)}
                                                        aria-label={`Edit academic year ${year.year}`}
                                                        title={`Edit academic year ${year.year}`}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        onClick={() => handleDelete(year.id)}
                                                        aria-label={`Delete academic year ${year.year}`}
                                                        title={`Delete academic year ${year.year}`}
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

                        {academicYears.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <CalendarRange className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No academic years found</p>
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
                        <h3 className="text-lg font-semibold mb-4">{editingYear ? 'Edit Academic Year' : 'Create Academic Year'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Year *</label>
                                <input
                                    type="number"
                                    min="2000"
                                    max="2100"
                                    value={formData.year}
                                    onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) })}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Start Date *</label>
                                    <input
                                        type="date"
                                        value={formData.startDate}
                                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">End Date *</label>
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
                                <Button type="button" variant="outline" onClick={() => { setShowModal(false); setEditingYear(null); }}>Cancel</Button>
                                <Button type="submit">{editingYear ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
