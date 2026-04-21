'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';

interface Classroom {
  id: string;
  building: string;
  roomNumber: string;
  capacity: number;
  type: string;
  isActive?: boolean;
}

const classroomTypeOptions = [
  { value: 'LECTURE', label: 'Lecture' },
  { value: 'LAB', label: 'Lab' },
  { value: 'SEMINAR', label: 'Seminar' },
  { value: 'OTHER', label: 'Other' },
];

export default function AdminClassroomsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    building: '',
    roomNumber: '',
    capacity: 30,
    type: 'LECTURE',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchClassrooms = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await classroomsApi.getAll({ page, limit: 20 });
      const filteredRooms = search
        ? response.data.filter(
            (room: Classroom) =>
              room.building.toLowerCase().includes(search.toLowerCase()) ||
              room.roomNumber.toLowerCase().includes(search.toLowerCase()),
          )
        : response.data;

      setClassrooms(filteredRooms);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Classrooms could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchClassrooms();
    }
  }, [canAccess, fetchClassrooms]);

  const pageSummary = useMemo(() => {
    if (classrooms.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [classrooms.length, page, totalPages]);

  if (!canAccess) {
    return <LoadingState label="Loading classrooms" className="m-8" />;
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

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    await fetchClassrooms();
  };

  const handleDelete = async (room: Classroom) => {
    const shouldDelete = await confirm({
      title: 'Delete classroom',
      message: `Delete ${room.building} ${room.roomNumber}? This removes the classroom from the current admin view.`,
      confirmText: 'Delete classroom',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await classroomsApi.delete(room.id);
      toast.success('Classroom deleted');
      await fetchClassrooms();
    } catch {
      toast.error('We could not delete that classroom.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingRoom) {
        await classroomsApi.update(editingRoom.id, formData);
        toast.success('Classroom updated');
      } else {
        await classroomsApi.create(formData);
        toast.success('Classroom created');
      }

      closeModal();
      await fetchClassrooms();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'The classroom could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Classrooms"
      description="Keep room inventory readable so sections, schedules, and capacity planning stay aligned."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create classroom
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
                  Search classrooms
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by building or room number"
                  icon={<Search className="h-4 w-4" />}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    Search
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Classrooms unavailable"
            description={error}
            onRetry={() => void fetchClassrooms()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading classrooms" />
        ) : classrooms.length === 0 ? (
          <EmptyState
            icon={DoorOpen}
            title="No matching classrooms"
            description="Create a classroom so section scheduling has a reliable room inventory to work with."
            action={<Button onClick={openCreate}>Create classroom</Button>}
          />
        ) : (
          <AdminTableCard
            title="Classroom records"
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
              <AdminTableScroll>
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Building</th>
                      <th className="px-2 py-3 font-medium">Room</th>
                      <th className="px-2 py-3 font-medium">Capacity</th>
                      <th className="px-2 py-3 font-medium">Type</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
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
                          {room.capacity}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {room.type}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {room.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(room)}
                              aria-label={`Edit classroom ${room.building} ${room.roomNumber}`}
                              title={`Edit classroom ${room.building} ${room.roomNumber}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(room)}
                              aria-label={`Delete classroom ${room.building} ${room.roomNumber}`}
                              title={`Delete classroom ${room.building} ${room.roomNumber}`}
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
        title={editingRoom ? 'Edit classroom' : 'Create classroom'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="Building">
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
            <AdminFormField label="Room number">
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
            <AdminFormField label="Capacity">
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
              label="Type"
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingRoom
                  ? 'Save changes'
                  : 'Create classroom'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
