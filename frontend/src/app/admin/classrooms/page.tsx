'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { classroomsApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
  AdminToolbarMeta,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { statusToneClass } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import { campusErrorMessage } from '@/lib/campus-error';
import { createRequestEpoch } from '@/lib/request-epoch';

interface Classroom {
  id: string;
  building: string;
  roomNumber: string;
  capacity: number;
  type: string;
  isActive?: boolean;
}

function buildClassroomUpdatePayload(
  baseline: Classroom,
  formData: { building: string; roomNumber: string; capacity: number; type: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (formData.building !== baseline.building) payload.building = formData.building;
  if (formData.roomNumber !== baseline.roomNumber) payload.roomNumber = formData.roomNumber;
  if (Number(formData.capacity) !== baseline.capacity) payload.capacity = Number(formData.capacity);
  if (formData.type !== baseline.type) payload.type = formData.type;
  return payload;
}

export default function AdminClassroomsPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { formatNumber, href, locale, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.classrooms, vi: adminAcademicsVi.classrooms }[locale];
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
  const classroomsEpoch = useRef(createRequestEpoch()).current;
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    building: '',
    roomNumber: '',
    capacity: 30,
    type: 'LECTURE',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const editLabel = (building: string, roomNumber: string) =>
    copy.editLabel
      .replace('{building}', () => building)
      .replace('{roomNumber}', () => roomNumber);
  const deleteLabel = (building: string, roomNumber: string) =>
    copy.deleteLabel
      .replace('{building}', () => building)
      .replace('{roomNumber}', () => roomNumber);

  useEffect(() => {
    if (isAuthLoading || isLoggingOut) {
      return;
    }

    if (!user) {
      router.replace(`${href('/login')}?portal=admin&reason=session-expired`);
      return;
    }

    if (!isAdmin && !isSuperAdmin) {
      router.replace(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, isAuthLoading, isLoggingOut, router, user]);

  const fetchClassrooms = useCallback(async () => {
    const epoch = classroomsEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      // Search is a server-side filter: paging through 20-row pages and narrowing
      // them in the browser reports "no results" for anything on another page.
      const query = { page, limit: 20, search: search || undefined };
      const response = await classroomsApi.getAll(query);

      if (!classroomsEpoch.isCurrent(epoch)) return;
      setClassrooms(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!classroomsEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!classroomsEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [classroomsEpoch, copy, page, search]);

  useEffect(() => () => {
    classroomsEpoch.invalidate();
  }, [classroomsEpoch]);

  const classroomTypeOptions = useMemo(
    () => [
      { value: 'LECTURE', label: copy.typeOptions.LECTURE },
      { value: 'LAB', label: copy.typeOptions.LAB },
      { value: 'WORKSHOP', label: copy.typeOptions.WORKSHOP },
      { value: 'SEMINAR', label: copy.typeOptions.SEMINAR },
      { value: 'AUDITORIUM', label: copy.typeOptions.AUDITORIUM },
      { value: 'OTHER', label: copy.typeOptions.OTHER },
    ],
    [copy.typeOptions],
  );

  const getClassroomTypeLabel = useCallback(
    (type: string) =>
      classroomTypeOptions.find((option) => option.value === type)?.label ?? type,
    [classroomTypeOptions],
  );

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) {
      return;
    }
    if (!trimmed) {
      setSearch('');
      setPage(1);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearch(trimmed);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchClassrooms();
    }
  }, [canAccess, fetchClassrooms]);

  const pageSummary = useMemo(() => {
    if (classrooms.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [classrooms.length, copy, page, totalPages]);

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = () => {
    setEditingRoom(null);
    setFormData({
      building: '',
      roomNumber: '',
      capacity: 30,
      type: 'LECTURE',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (room: Classroom) => {
    setEditingRoom(room);
    setFormData({
      building: room.building,
      roomNumber: room.roomNumber,
      capacity: room.capacity,
      type: room.type,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    // `search` and `page` are fetch dependencies, so committing the term here is
    // what re-issues the request. Calling the fetch directly would run it against
    // the previous closure and fire twice.
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleDelete = async (room: Classroom) => {
    const shouldDelete = await confirm({
      title: copy.deleteTitle,
      message: copy.deleteMessage
        .replace('{building}', () => room.building)
        .replace('{roomNumber}', () => room.roomNumber),
      confirmText: copy.deleteConfirm,
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await classroomsApi.delete(room.id);
      toast.success(copy.deleted);
      if (classrooms.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchClassrooms();
      }
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingRoom) {
        const payload = buildClassroomUpdatePayload(editingRoom, formData);
        if (Object.keys(payload).length > 0) {
          await classroomsApi.update(editingRoom.id, payload);
        }
        toast.success(copy.updated);
      } else {
        await classroomsApi.create(formData);
        toast.success(copy.created);
      }

      closeModal();
      await fetchClassrooms();
    } catch (requestError: unknown) {
      toast.error(
        campusErrorMessage(
          requestError,
          messages.common.campusErrors,
          copy.saveFailed,
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {copy.create}
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <form
              onSubmit={handleSearch}
              className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
            >
              <div className="w-full max-w-xl">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {copy.searchLabel}
                </label>
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchLabel}
                  icon={<Search className="h-4 w-4" />}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    {messages.common.actions.search}
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchClassrooms()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : classrooms.length === 0 ? (
          <EmptyState
            icon={DoorOpen}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={<Button onClick={openCreate}>{copy.create}</Button>}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
            footer={
              <AdminPaginationFooter
                summary={pageSummary}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <div className="space-y-3 md:hidden" role="list" aria-label={copy.tableTitle}>
                {classrooms.map((room) => (
                  <article
                    key={`${room.id}-mobile`}
                    className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
                    role="listitem"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                          {room.building}
                        </p>
                        <h3 className="mt-1 font-semibold text-foreground">{room.roomNumber}</h3>
                      </div>
                      <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(room.isActive ? 'success' : 'neutral')}`}>
                        {room.isActive ? copy.active : copy.inactive}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {copy.headers.capacity}
                        </dt>
                        <dd className="mt-1 text-foreground">{formatNumber(room.capacity)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {copy.headers.type}
                        </dt>
                        <dd className="mt-1 text-foreground">{getClassroomTypeLabel(room.type)}</dd>
                      </div>
                    </dl>
                    <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(room)}
                        aria-label={editLabel(room.building, room.roomNumber)}
                        title={editLabel(room.building, room.roomNumber)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleDelete(room)}
                        aria-label={deleteLabel(room.building, room.roomNumber)}
                        title={deleteLabel(room.building, room.roomNumber)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AdminRowActions>
                  </article>
                ))}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.building}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.room}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.capacity}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.type}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {classrooms.map((room) => (
                      <tr key={room.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {room.building}
                        </td>
                        <td className="px-2 py-4 text-foreground">
                          {room.roomNumber}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatNumber(room.capacity)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {getClassroomTypeLabel(room.type)}
                        </td>
                        <td className="px-2 py-4">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(room.isActive ? 'success' : 'neutral')}`}>
                            {room.isActive ? copy.active : copy.inactive}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(room)}
                              aria-label={editLabel(room.building, room.roomNumber)}
                              title={editLabel(room.building, room.roomNumber)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(room)}
                              aria-label={deleteLabel(room.building, room.roomNumber)}
                              title={deleteLabel(room.building, room.roomNumber)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AdminRowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingRoom ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.fields.building}>
              <Input
                type="text"
                value={formData.building}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    building: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField label={copy.fields.roomNumber}>
              <Input
                type="text"
                value={formData.roomNumber}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    roomNumber: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.fields.capacity}>
              <Input
                type="number"
                min="1"
                value={formData.capacity}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    capacity: Number(event.target.value) || 30,
                  }))
                }
                required
              />
            </AdminFormField>
            <Select
              label={copy.fields.type}
              value={formData.type}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
              options={classroomTypeOptions}
            />
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? copy.saving
                : editingRoom
                  ? messages.common.actions.saveChanges
                  : copy.create}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
