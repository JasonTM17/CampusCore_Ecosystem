'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { usersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    Loader2,
    Users,
    Search,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
} from 'lucide-react';

interface UserRecord {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    createdAt: string;
}

export default function AdminUsersPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
    });

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
        fetchUsers();
    }, [page]);

    const fetchUsers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await usersApi.getAll({ page, limit: 20, search: search || undefined });
            setUsers(response.data);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load users');
            toast.error('Failed to load users');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchUsers();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this user?')) return;
        
        try {
            await usersApi.delete(id);
            toast.success('User deleted successfully');
            fetchUsers();
        } catch {
            toast.error('Failed to delete user');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingUser) {
                await usersApi.update(editingUser.id, {
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                });
                toast.success('User updated successfully');
            } else {
                await usersApi.create(formData);
                toast.success('User created successfully');
            }
            setShowCreateModal(false);
            setEditingUser(null);
            setFormData({ email: '', password: '', firstName: '', lastName: '' });
            fetchUsers();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (user: UserRecord) => {
        setEditingUser(user);
        setFormData({
            email: user.email,
            password: '',
            firstName: user.firstName,
            lastName: user.lastName,
        });
        setShowCreateModal(true);
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
                        <span className="text-gray-300">User Management</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-300">Welcome, {user.firstName}</span>
                        <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>Logout</Button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Users className="h-7 w-7 text-primary" />
                            User Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage user accounts in the system</p>
                    </div>
                    <Button onClick={() => { setEditingUser(null); setFormData({ email: '', password: '', firstName: '', lastName: '' }); setShowCreateModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create User
                    </Button>
                </div>

                {/* Search */}
                <form onSubmit={handleSearch} className="mb-6 flex gap-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by email or name..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <Button type="submit">Search</Button>
                </form>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-red-600 font-medium mb-2">{error}</p>
                        <Button variant="outline" onClick={fetchUsers}>Try Again</Button>
                    </div>
                )}

                {/* Users Table */}
                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Created</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {users.map((u) => (
                                        <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{u.firstName} {u.lastName}</td>
                                            <td className="px-4 py-3 text-gray-600">{u.email}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    u.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {u.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{new Date(u.createdAt).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(u.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

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
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                        <h3 className="text-lg font-semibold mb-4">{editingUser ? 'Edit User' : 'Create User'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    disabled={!!editingUser}
                                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                    required
                                />
                            </div>
                            {!editingUser && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Password</label>
                                    <input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required={!editingUser}
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">First Name</label>
                                    <input
                                        type="text"
                                        value={formData.firstName}
                                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Last Name</label>
                                    <input
                                        type="text"
                                        value={formData.lastName}
                                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => { setShowCreateModal(false); setEditingUser(null); }}>Cancel</Button>
                                <Button type="submit">{editingUser ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
