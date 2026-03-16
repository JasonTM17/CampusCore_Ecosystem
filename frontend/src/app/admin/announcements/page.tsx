'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { announcementsApi, semestersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, AlertCircle, Bell, Plus, Trash2, RefreshCw, X } from 'lucide-react';

type Semester = { id: string; name: string };

type Announcement = {
  id: string;
  title: string;
  content: string;
  priority: string;
  targetRoles: string[];
  targetYears: number[];
  isGlobal: boolean;
  semesterId?: string | null;
  createdAt: string;
  semester?: { name: string } | null;
};

const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const roleOptions = ['STUDENT', 'LECTURER', 'ADMIN', 'SUPER_ADMIN'] as const;

export default function AdminAnnouncementsPage() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<Announcement[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({ semesterId: '', priority: '' });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    content: '',
    priority: 'NORMAL',
    isGlobal: true,
    semesterId: '',
    targetRoles: [] as string[],
    targetYears: '' as string, // comma-separated
  });

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) router.push('/dashboard');
  }, [user, isAdmin, isSuperAdmin, router]);

  useEffect(() => {
    fetchSemesters();
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [page, filters]);

  const fetchSemesters = async () => {
    try {
      const res = await semestersApi.getAll();
      setSemesters(res.data || []);
    } catch {
      // ignore
    }
  };

  const fetchAnnouncements = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await announcementsApi.getAll({
        page,
        limit: 20,
        semesterId: filters.semesterId || undefined,
        priority: filters.priority || undefined,
      });
      setItems(res.data || []);
      setTotalPages(res.meta?.totalPages || 1);
    } catch {
      setError('Failed to load announcements');
      toast.error('Failed to load announcements');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('Title and content are required');
      return;
    }

    const targetYears = draft.targetYears
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    try {
      await announcementsApi.create({
        title: draft.title,
        content: draft.content,
        priority: draft.priority,
        isGlobal: draft.isGlobal,
        semesterId: draft.semesterId || null,
        targetRoles: draft.isGlobal ? [] : draft.targetRoles,
        targetYears: draft.isGlobal ? [] : targetYears,
      });
      toast.success('Announcement created');
      setIsCreateOpen(false);
      setDraft({
        title: '',
        content: '',
        priority: 'NORMAL',
        isGlobal: true,
        semesterId: '',
        targetRoles: [],
        targetYears: '',
      });
      setPage(1);
      fetchAnnouncements();
    } catch {
      toast.error('Failed to create announcement');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await announcementsApi.delete(id);
      toast.success('Announcement deleted');
      fetchAnnouncements();
    } catch {
      toast.error('Failed to delete announcement');
    }
  };

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

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
            <span className="text-gray-300">Announcements</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              className="text-white border-gray-600 hover:bg-gray-700"
              onClick={fetchAnnouncements}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <span className="text-gray-300">Welcome, {user.firstName}</span>
            <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-7 w-7 text-primary" />
              Announcements
            </h2>
            <p className="text-gray-500 mt-1">Create and manage announcements for platform users</p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
              <select
                value={filters.semesterId}
                onChange={(e) => {
                  setFilters((p) => ({ ...p, semesterId: e.target.value }));
                  setPage(1);
                }}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
              >
                <option value="">All Semesters</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={filters.priority}
                onChange={(e) => {
                  setFilters((p) => ({ ...p, priority: e.target.value }));
                  setPage(1);
                }}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[160px]"
              >
                <option value="">All</option>
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setFilters({ semesterId: '', priority: '' });
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">{error}</p>
            <Button variant="outline" onClick={fetchAnnouncements}>
              Try Again
            </Button>
          </div>
        )}

        {!error && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            {isLoading ? (
              <div className="p-10 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              </div>
            ) : items.length === 0 ? (
              <div className="p-10 text-center text-gray-500">No announcements found.</div>
            ) : (
              <div className="divide-y">
                {items.map((a) => (
                  <div key={a.id} className="p-5 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                            {a.priority}
                          </span>
                          <span className="text-xs text-gray-500">
                            {a.isGlobal ? 'Global' : `Targeted (${a.targetRoles?.join(', ') || 'roles'})`}
                          </span>
                          {a.semester?.name ? <span className="text-xs text-gray-500">• {a.semester.name}</span> : null}
                        </div>
                        <h3 className="font-semibold text-gray-900 mt-1 truncate">{a.title}</h3>
                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{a.content}</p>
                        <p className="text-xs text-gray-500 mt-3">{new Date(a.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleDelete(a.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && !isLoading && (
              <div className="border-t px-4 py-3 flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6 my-8 mx-4">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold">New Announcement</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Announcement title"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft((p) => ({ ...p, content: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-h-[140px]"
                  placeholder="Write the announcement..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={draft.priority}
                    onChange={(e) => setDraft((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {priorities.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester (optional)</label>
                  <select
                    value={draft.semesterId}
                    onChange={(e) => setDraft((p) => ({ ...p, semesterId: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {semesters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="isGlobal"
                  type="checkbox"
                  checked={draft.isGlobal}
                  onChange={(e) => setDraft((p) => ({ ...p, isGlobal: e.target.checked }))}
                />
                <label htmlFor="isGlobal" className="text-sm text-gray-700">
                  Global (visible to all authenticated users)
                </label>
              </div>

              {!draft.isGlobal && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target roles</label>
                    <div className="flex flex-wrap gap-2">
                      {roleOptions.map((r) => (
                        <label key={r} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.targetRoles.includes(r)}
                            onChange={(e) => {
                              setDraft((p) => ({
                                ...p,
                                targetRoles: e.target.checked
                                  ? Array.from(new Set([...p.targetRoles, r]))
                                  : p.targetRoles.filter((x) => x !== r),
                              }));
                            }}
                          />
                          {r}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target years (students)</label>
                    <input
                      value={draft.targetYears}
                      onChange={(e) => setDraft((p) => ({ ...p, targetYears: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="e.g. 1,2,3"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave empty to target all years.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

