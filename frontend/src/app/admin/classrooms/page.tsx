'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { classroomsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    DoorOpen,
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    AlertCircle,
    Search,
} from 'lucide-react';

interface Classroom {
    id: string;
    building: string;
    roomNumber: string;
    capacity: number;
    type: string;
    isActive?: boolean;
    createdAt?: string;
}

export default function AdminClassroomsPage() {
    const { user, logout, isAdmin, isSuperAdmin } = useAuth();
    const router = useRouter();
    const [classrooms, setClassrooms] = useState<Classroom[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
    const [formData, setFormData] = useState({
        building: '',
        roomNumber: '',
        capacity: 30,
        type: 'LECTURE',
    });
    const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

    useEffect(() => {
        if (user && !isAdmin && !isSuperAdmin) {
            router.push('/dashboard');
        }
    }, [user, isAdmin, isSuperAdmin, router]);

    const fetchClassrooms = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await classroomsApi.getAll({ page, limit: 20 });
            let filteredData = response.data;
            if (search) {
                filteredData = response.data.filter((c: Classroom) =>
                    c.building.toLowerCase().includes(search.toLowerCase()) ||
                    c.roomNumber.toLowerCase().includes(search.toLowerCase())
                );
            }
            setClassrooms(filteredData);
            setTotalPages(response.meta?.totalPages || 1);
        } catch {
            setError('Failed to load classrooms');
            toast.error('Failed to load classrooms');
        } finally {
            setIsLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        if (canAccess) {
            void fetchClassrooms();
        }
    }, [canAccess, fetchClassrooms]);

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
        fetchClassrooms();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this classroom?')) return;
        
        try {
            await classroomsApi.delete(id);
            toast.success('Classroom deleted successfully');
            fetchClassrooms();
        } catch {
            toast.error('Failed to delete classroom');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingRoom) {
                await classroomsApi.update(editingRoom.id, formData);
                toast.success('Classroom updated successfully');
            } else {
                await classroomsApi.create(formData);
                toast.success('Classroom created successfully');
            }
            setShowModal(false);
            setEditingRoom(null);
            setFormData({ building: '', roomNumber: '', capacity: 30, type: 'LECTURE' });
            fetchClassrooms();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Operation failed');
        }
    };

    const openEdit = (room: Classroom) => {
        setEditingRoom(room);
        setFormData({
            building: room.building,
            roomNumber: room.roomNumber,
            capacity: room.capacity,
            type: room.type,
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
                        <span className="text-gray-300">Classroom Management</span>
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
                            <DoorOpen className="h-7 w-7 text-primary" />
                            Classroom Management
                        </h2>
                        <p className="text-gray-500 mt-1">Manage classrooms and rooms</p>
                    </div>
                    <Button onClick={() => { setEditingRoom(null); setFormData({ building: '', roomNumber: '', capacity: 30, type: 'LECTURE' }); setShowModal(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create Classroom
                    </Button>
                </div>

                <form onSubmit={handleSearch} className="mb-6 flex gap-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by building or room number..."
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
                        <Button variant="outline" onClick={fetchClassrooms}>Try Again</Button>
                    </div>
                )}

                {!error && (
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Building</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Room</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Capacity</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {classrooms.map((room) => (
                                        <tr key={room.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{room.building}</td>
                                            <td className="px-4 py-3 text-gray-600">{room.roomNumber}</td>
                                            <td className="px-4 py-3 text-center text-gray-600">{room.capacity}</td>
                                            <td className="px-4 py-3 text-gray-600">{room.type}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    room.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {room.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => openEdit(room)}
                                                        aria-label={`Edit classroom ${room.building} ${room.roomNumber}`}
                                                        title={`Edit classroom ${room.building} ${room.roomNumber}`}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        onClick={() => handleDelete(room.id)}
                                                        aria-label={`Delete classroom ${room.building} ${room.roomNumber}`}
                                                        title={`Delete classroom ${room.building} ${room.roomNumber}`}
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

                        {classrooms.length === 0 && !isLoading && (
                            <div className="p-8 text-center">
                                <DoorOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No classrooms found</p>
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
                        <h3 className="text-lg font-semibold mb-4">{editingRoom ? 'Edit Classroom' : 'Create Classroom'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Building *</label>
                                    <input
                                        type="text"
                                        value={formData.building}
                                        onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Room Number *</label>
                                    <input
                                        type="text"
                                        value={formData.roomNumber}
                                        onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                                        className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Capacity *</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.capacity}
                                        onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 30 })}
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
                                        <option value="LECTURE">Lecture</option>
                                        <option value="LAB">Lab</option>
                                        <option value="SEMINAR">Seminar</option>
                                        <option value="OTHER">Other</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button type="button" variant="outline" onClick={() => { setShowModal(false); setEditingRoom(null); }}>Cancel</Button>
                                <Button type="submit">{editingRoom ? 'Update' : 'Create'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
