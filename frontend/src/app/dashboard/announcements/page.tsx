'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { announcementsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Bell, AlertCircle, RefreshCw } from 'lucide-react';

type Announcement = {
  id: string;
  title: string;
  content: string;
  priority: string;
  createdAt: string;
  semester?: { name: string } | null;
  section?: { sectionNumber: string; course?: { code?: string; name?: string } } | null;
};

const priorityBadge: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  NORMAL: 'bg-blue-50 text-blue-700',
  HIGH: 'bg-yellow-50 text-yellow-800',
  URGENT: 'bg-red-50 text-red-700',
};

export default function StudentAnnouncementsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.studentId) router.push('/dashboard');
  }, [user, router]);

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await announcementsApi.getMy({ page: 1, limit: 50 });
      setItems(res.data || []);
    } catch (e) {
      setError('Failed to load announcements');
      toast.error('Failed to load announcements');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user?.studentId) {
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
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-gray-700"
              onClick={() => router.push('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-xl font-bold">CampusCore</h1>
            <span className="text-gray-500">|</span>
            <span className="text-gray-300">Announcements</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              className="text-white border-gray-600 hover:bg-gray-700"
              onClick={fetchFeed}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
                        <span className="text-gray-300">Welcome, {user?.firstName}</span>
            <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-7 w-7 text-primary" />
              Announcements
            </h2>
            <p className="text-gray-500 mt-1">Updates from the university and your courses</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">{error}</p>
            <Button variant="outline" onClick={fetchFeed}>
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
              <div className="p-10 text-center text-gray-500">No announcements yet.</div>
            ) : (
              <div className="divide-y">
                {items.map((a) => (
                  <div key={a.id} className="p-5 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${priorityBadge[a.priority] || 'bg-gray-100 text-gray-700'}`}>
                            {a.priority}
                          </span>
                          <h3 className="font-semibold text-gray-900">{a.title}</h3>
                        </div>
                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{a.content}</p>
                        <div className="text-xs text-gray-500 mt-3">
                          {a.semester?.name ? <span className="mr-3">Semester: {a.semester.name}</span> : null}
                          {a.section?.course?.code ? <span className="mr-3">Course: {a.section.course.code}</span> : null}
                          <span>{new Date(a.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

