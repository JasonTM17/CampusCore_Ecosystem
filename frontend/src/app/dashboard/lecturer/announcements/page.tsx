'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, RefreshCw } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { announcementsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';

type Announcement = {
  id: string;
  title: string;
  content: string;
  priority: string;
  createdAt: string;
  semester?: { name: string } | null;
  section?: {
    sectionNumber: string;
    course?: { code?: string; name?: string };
  } | null;
};

const priorityTone: Record<string, string> = {
  LOW: 'bg-secondary text-foreground',
  NORMAL: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  HIGH: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  URGENT: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
};

export default function LecturerAnnouncementsPage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const [items, setItems] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchFeed = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await announcementsApi.getMy({ page: 1, limit: 50 });
      setItems(response.data ?? []);
    } catch {
      setError('Announcements could not be loaded right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) {
      void fetchFeed();
    }
  }, [fetchFeed, hasAccess]);

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading announcements" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
        title="Announcements"
        description="Keep the latest campus and section-level notices close to your teaching workflow."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/lecturer">
              <Button
                type="button"
                variant="outline"
                aria-label="Back to lecturer dashboard"
                title="Back to lecturer dashboard"
              >
                Back to lecturer dashboard
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={() => void fetchFeed()}
              disabled={isLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Announcements unavailable"
          description={error}
          onRetry={() => void fetchFeed()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading announcements" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No announcements yet"
          description="Shared notices for your teaching workspace will appear here once they are published."
        />
      ) : (
        <Card variant="muted">
          <CardHeader>
            <CardTitle className="text-xl">Recent notices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map((announcement) => (
              <article
                key={announcement.id}
                className="rounded-lg border border-border/70 bg-card px-5 py-5"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        priorityTone[announcement.priority] ??
                        'bg-secondary text-foreground'
                      }`}
                    >
                      {announcement.priority}
                    </span>
                    <h2 className="text-lg font-semibold text-foreground">
                      {announcement.title}
                    </h2>
                  </div>
                  <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
                    {announcement.content}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {announcement.semester?.name ? (
                      <span>Semester {announcement.semester.name}</span>
                    ) : null}
                    {announcement.section?.course?.code ? (
                      <span>
                        {announcement.section.course.code} section{' '}
                        {announcement.section.sectionNumber}
                      </span>
                    ) : null}
                    <span>{new Date(announcement.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
