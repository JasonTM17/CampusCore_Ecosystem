'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { announcementsApi, semestersApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminToolbarCard,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { Textarea } from '@/components/ui/textarea';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';

type Semester = { id: string; name: string };

type Announcement = {
  id: string;
  title: string;
  content: string;
  priority: string;
  targetRoles?: string[];
  targetYears?: number[];
  isGlobal?: boolean;
  semesterId?: string | null;
  createdAt: string;
  semester?: { name: string } | null;
};

const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const roleOptions = ['STUDENT', 'LECTURER', 'ADMIN', 'SUPER_ADMIN'] as const;

export default function AdminAnnouncementsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<Announcement[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [filters, setFilters] = useState({ semesterId: '', priority: '' });
  const [draft, setDraft] = useState({
    title: '',
    content: '',
    priority: 'NORMAL',
    isGlobal: true,
    semesterId: '',
    targetRoles: [] as string[],
    targetYears: '' as string,
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchSemesters = useCallback(async () => {
    try {
      const response = await semestersApi.getAll();
      setSemesters(response.data || []);
    } catch {
      // Optional filter data.
    }
  }, []);

  const fetchAnnouncements = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await announcementsApi.getAll({
        page,
        limit: 20,
        semesterId: filters.semesterId || undefined,
        priority: filters.priority || undefined,
      });
      setItems(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Announcements could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [filters.priority, filters.semesterId, page]);

  useEffect(() => {
    if (canAccess) {
      void fetchSemesters();
      void fetchAnnouncements();
    }
  }, [canAccess, fetchAnnouncements, fetchSemesters]);

  const semesterOptions = useMemo(
    () => [
      { value: '', label: 'All semesters' },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [semesters],
  );

  const createSemesterOptions = useMemo(
    () => [
      { value: '', label: 'No semester' },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [semesters],
  );

  const priorityOptions = useMemo(
    () => [
      { value: '', label: 'All priorities' },
      ...priorities.map((priority) => ({
        value: priority,
        label: priority,
      })),
    ],
    [],
  );

  const pageSummary = useMemo(() => {
    if (items.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [items.length, page, totalPages]);

  if (!canAccess) {
    return <LoadingState label="Loading announcements" className="m-8" />;
  }

  const resetDraft = () => {
    setDraft({
      title: '',
      content: '',
      priority: 'NORMAL',
      isGlobal: true,
      semesterId: '',
      targetRoles: [],
      targetYears: '',
    });
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    resetDraft();
  };

  const handleCreate = async () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('Title and content are required.');
      return;
    }

    const targetYears = draft.targetYears
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

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
      closeCreateModal();
      setPage(1);
      await fetchAnnouncements();
    } catch {
      toast.error('The announcement could not be created.');
    }
  };

  const handleDelete = async (announcement: Announcement) => {
    const shouldDelete = await confirm({
      title: 'Delete announcement',
      message: `Delete ${announcement.title}? This removes the announcement from the current admin view.`,
      confirmText: 'Delete announcement',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await announcementsApi.delete(announcement.id);
      toast.success('Announcement deleted');
      await fetchAnnouncements();
    } catch {
      toast.error('We could not delete that announcement.');
    }
  };

  return (
    <AdminFrame
      title="Announcements"
      description="Publish clear updates without leaving fragmented messages scattered across the platform."
      backLabel="Back to admin dashboard"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void fetchAnnouncements()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New announcement
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                label="Semester"
                value={filters.semesterId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    semesterId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={semesterOptions}
              />
              <Select
                label="Priority"
                value={filters.priority}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    priority: event.target.value,
                  }));
                  setPage(1);
                }}
                options={priorityOptions}
              />
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ semesterId: '', priority: '' });
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
                <div className="text-sm text-muted-foreground">{pageSummary}</div>
              </div>
            </div>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Announcements unavailable"
            description={error}
            onRetry={() => void fetchAnnouncements()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading announcements" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No matching announcements"
            description="Create an announcement to keep students, lecturers, and admins aligned on the latest campus updates."
            action={<Button onClick={() => setIsCreateOpen(true)}>New announcement</Button>}
          />
        ) : (
          <AdminTableCard
            title="Announcement feed"
            contentClassName="space-y-4"
            footer={
              <AdminPaginationFooter
                summary={pageSummary}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
                className="mt-0"
              />
            }
          >
              {items.map((announcement) => (
                <div
                  key={announcement.id}
                  className="rounded-lg border border-border/70 bg-background/70 p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                          {announcement.priority}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {announcement.isGlobal
                            ? 'Global audience'
                            : `Targeted: ${(announcement.targetRoles || []).join(', ') || 'Selected roles'}`}
                        </span>
                        {announcement.semester?.name ? (
                          <span className="text-xs text-muted-foreground">
                            Semester: {announcement.semester.name}
                          </span>
                        ) : null}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {announcement.title}
                        </h3>
                        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                          {announcement.content}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Published {new Date(announcement.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <AdminRowActions className="shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleDelete(announcement)}
                        aria-label={`Delete announcement ${announcement.title}`}
                        title={`Delete announcement ${announcement.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AdminRowActions>
                  </div>
                </div>
              ))}
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isCreateOpen}
        onClose={closeCreateModal}
        title="New announcement"
        closeLabel="Close new announcement form"
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <AdminFormField label="Title">
            <Input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Announcement title"
            />
          </AdminFormField>

          <AdminFormField label="Content">
            <Textarea
              value={draft.content}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
              className="min-h-[160px]"
              placeholder="Write the update clearly and directly."
            />
          </AdminFormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Priority"
              value={draft.priority}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
              }
              options={priorities.map((priority) => ({
                value: priority,
                label: priority,
              }))}
            />
            <Select
              label="Semester"
              value={draft.semesterId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  semesterId: event.target.value,
                }))
              }
              options={createSemesterOptions}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              id="isGlobal"
              type="checkbox"
              checked={draft.isGlobal}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  isGlobal: event.target.checked,
                }))
              }
            />
            Global audience
          </label>

          {!draft.isGlobal ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Target roles
                </label>
                <div className="flex flex-wrap gap-3 rounded-lg border border-border/70 bg-background/70 p-3 text-sm">
                  {roleOptions.map((role) => (
                    <label key={role} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.targetRoles.includes(role)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            targetRoles: event.target.checked
                              ? Array.from(new Set([...current.targetRoles, role]))
                              : current.targetRoles.filter((entry) => entry !== role),
                          }))
                        }
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Target years
                </label>
                <Input
                  value={draft.targetYears}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      targetYears: event.target.value,
                    }))
                  }
                  placeholder="e.g. 1,2,3"
                  hint="Leave empty to target every matching year."
                />
              </div>
            </div>
          ) : null}

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeCreateModal}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()}>Create announcement</Button>
          </AdminDialogFooter>
        </div>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
