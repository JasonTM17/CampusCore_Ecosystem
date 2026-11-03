'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  ChevronDown,
  GraduationCap,
  KeyRound,
  Pencil,
  Plus,
  School,
  Search,
  ShieldCheck,
  Trash2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { curriculaApi, departmentsApi, fetchAllPages, usersApi } from '@/lib/api';
import { Curriculum, type Department } from '@/types/api';
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
import { roleSolidClass, roleToneClass, type StatusTone } from '@/components/ui/status';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { campusErrorMessage } from '@/lib/campus-error';
import {
  isPrivilegedAccountTarget,
  primaryManagedRole,
  type ManagedRole,
} from '@/lib/admin-user-guards';

interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  // The admin API serializes roles as an array (matching AuthUserResponse);
  // it used to send a comma-joined string and every consumer split it back.
  roles?: string[];
  // Profile-presence flags let the edit form ask for official IDs only when a
  // role conversion must create the profile; older responses omit them and the
  // held roles act as the fallback signal.
  hasStudentProfile?: boolean;
  hasLecturerProfile?: boolean;
  createdAt: string;
}

const defaultRole: ManagedRole = 'STUDENT';

const ACCOUNT_STATUSES = ['ACTIVE', 'PENDING', 'SUSPENDED', 'LOCKED', 'DISABLED'] as const;

function hasUserStatusChanged(loadedStatus: string | undefined, formStatus: string): boolean {
  const normalize = (status: string | undefined) => status?.trim().toUpperCase() || 'ACTIVE';
  return normalize(loadedStatus) !== normalize(formStatus);
}

function buildUserProfileUpdatePayload(
  baseline: Pick<UserRecord, 'firstName' | 'lastName'>,
  formData: { firstName: string; lastName: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const firstName = formData.firstName.trim();
  const lastName = formData.lastName.trim();
  if (firstName !== baseline.firstName) payload.firstName = firstName;
  if (lastName !== baseline.lastName) payload.lastName = lastName;
  return payload;
}

function usesLecturerProfileRole(role: string): boolean {
  const normalized = role.trim().toUpperCase();
  return (
    normalized === 'LECTURER' ||
    normalized === 'TRUONG_KHOA' ||
    normalized === 'TRUONG_BO_MON'
  );
}

function isRecordSuperAdmin(u: UserRecord): boolean {
  return recordRoles(u).some((role) => role.trim().toUpperCase() === 'SUPER_ADMIN');
}

function recordRoles(record: UserRecord): string[] {
  return record.roles ?? [];
}

function isRecordPrivileged(record: UserRecord): boolean {
  return isPrivilegedAccountTarget(recordRoles(record));
}

function userStatusTone(status: string): StatusTone {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'LOCKED':
    case 'SUSPENDED':
    case 'DISABLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

interface RoleTabButtonProps {
  active: boolean;
  /** Extra classes applied while the tab is active (tone overrides on top of the default variant). */
  activeClassName: string;
  /** Overrides the shared inactive treatment when a surface needs a transparent chip. */
  inactiveClassName?: string;
  className?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}

// Compact role filter/switcher chip built on the shared Button so every tab
// inherits the same focus-visible ring and disabled treatment; per-tab tones
// stay in the caller.
function RoleTabButton({
  active,
  activeClassName,
  inactiveClassName,
  className,
  onClick,
  disabled,
  title,
  children,
}: RoleTabButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'secondary'}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'h-auto px-3 py-1.5 text-xs',
        className,
        active
          ? activeClassName
          : inactiveClassName ?? 'bg-secondary/40 text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
      )}
    >
      {children}
    </Button>
  );
}

export default function AdminUsersPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, formatDate, messages } = useI18n();
  const { users: copy } = messages.adminPages;
  const creditUnit = messages.studentPages.schedule.creditsAbbreviation;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // Server truth for the active filter: meta.total of the query that produced
  // the current rows, so the tab count cannot describe a different set than
  // the table.
  const [totalItems, setTotalItems] = useState(0);
  const [roleFilter, setRoleFilter] = useState<'ALL' | ManagedRole>('ALL');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const deleteInFlightRef = useRef<string | null>(null);
  const [formError, setFormError] = useState('');
  // One-time office-issued credential shown exactly once after create/reset.
  const [issuedCredential, setIssuedCredential] = useState<{ email: string; secret: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 2-Column form data covering both general account & role-specific academic profiles
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: defaultRole as ManagedRole,
    status: 'ACTIVE',
    // Student-specific fields
    studentId: '',
    year: '1',
    curriculumId: '',
    // Lecturer-specific fields
    employeeId: '',
    departmentId: '',
    academicTitle: 'TS.',
    specialization: '',
  });

  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  // Sync role filter from URL query param if present
  useEffect(() => {
    const roleParam = searchParams.get('role');
    if (
      roleParam &&
      ['STUDENT', 'LECTURER', 'ADMIN', 'TRUONG_KHOA', 'TRUONG_BO_MON', 'SUPER_ADMIN'].includes(
        roleParam.toUpperCase(),
      )
    ) {
      setRoleFilter(roleParam.toUpperCase() as ManagedRole);
    }
  }, [searchParams]);

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

  // A filter/page change invalidates the in-flight request generation so a
  // slower older response cannot repopulate the list after a newer render.
  const usersRequestRef = useRef(0);

  const fetchUsers = useCallback(async () => {
    const requestId = ++usersRequestRef.current;
    const isCurrent = () => requestId === usersRequestRef.current;
    setIsLoading(true);
    setError('');
    try {
      // The active tab is a server-side filter, not a browser-side narrowing
      // of the current 20-row page: with a filter applied, meta.total counts
      // the matching set, which is what the tabs and pagination display.
      const response = await usersApi.getAll({
        page,
        limit: 20,
        search: search || undefined,
        role: roleFilter === 'ALL' ? undefined : roleFilter,
      });
      if (!isCurrent()) return;
      const rows = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];
      setUsers(rows as UserRecord[]);
      setTotalItems(Number(response.meta?.total ?? rows.length));
      setTotalPages(response.meta?.totalPages || 1);
    } catch (loadError) {
      if (!isCurrent()) return;
      const status = (loadError as { response?: { status?: number } }).response?.status;
      setError(
        status === 403
          ? copy.forbidden
          : copy.loadFailed,
      );
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [copy, page, search, roleFilter]);

  // Department + curriculum options power every create/edit form; when their
  // fetch fails there is no fallback list, so the failure must be visible and
  // retryable instead of silently leaving the selects empty.
  const fetchReferenceData = useCallback(async () => {
    setReferenceError('');
    try {
      const [departmentsRes, curriculaRes] = await Promise.all([
        fetchAllPages<Department>((p, l) => departmentsApi.getAll({ page: p, limit: l })),
        fetchAllPages<Curriculum>((p, l) => curriculaApi.getAll({ page: p, limit: l })),
      ]);
      setDepartments(departmentsRes);
      setCurricula(curriculaRes);
    } catch {
      setReferenceError(copy.referenceDataFailed);
    }
  }, [copy]);

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
      void fetchUsers();
      void fetchReferenceData();
    }
    return () => {
      usersRequestRef.current += 1;
    };
  }, [canAccess, fetchUsers, fetchReferenceData]);

  const pageSummary = useMemo(() => {
    if (totalItems === 0) {
      return copy.noRecords;
    }

    return copy.pageSummary
      .replace('{page}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [copy, page, totalPages, totalItems]);

  const statusLabel = (status: string | null | undefined) =>
    messages.common.statuses[
      (status ?? 'UNKNOWN').toUpperCase() as keyof typeof messages.common.statuses
    ] ?? messages.common.statuses.UNKNOWN;

  // Each held role gets its localized name; custom roles the admin console does
  // not model stay raw instead of collapsing into a wrong default label.
  const recordRoleLabel = (roles?: string[]) =>
    (roles ?? [])
      .map((role) => copy.roles[role.trim().toUpperCase() as ManagedRole] ?? role)
      .filter(Boolean)
      .join(', ') || '—';

  const isSelfEditing = Boolean(
    editingUser && user && (user.id === editingUser.id || user.email === editingUser.email),
  );
  const editingPrimaryRole = editingUser ? primaryManagedRole(editingUser.roles) : null;
  // A record carrying only custom roles is presented read-only: omitting role
  // from the update payload preserves what this form cannot represent.
  const roleUnsupported = Boolean(editingUser) && editingPrimaryRole === null;
  const recordHasStudentProfile = (record: UserRecord) =>
    record.hasStudentProfile ?? recordRoles(record).includes('STUDENT');
  const recordHasLecturerProfile = (record: UserRecord) =>
    record.hasLecturerProfile ?? recordRoles(record).includes('LECTURER');
  const editNeedsStudentFields = Boolean(
    editingUser && !roleUnsupported && formData.role === 'STUDENT' && !recordHasStudentProfile(editingUser),
  );
  const editNeedsLecturerFields = Boolean(
    editingUser &&
      !roleUnsupported &&
      usesLecturerProfileRole(formData.role) &&
      !recordHasLecturerProfile(editingUser),
  );
  const showAssignmentColumn =
    !roleUnsupported &&
    (!editingUser ||
      formData.role === 'ADMIN' ||
      formData.role === 'SUPER_ADMIN' ||
      editNeedsStudentFields ||
      editNeedsLecturerFields);

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = (role: ManagedRole = defaultRole) => {
    setEditingUser(null);
    setFormError('');
    setFieldErrors({});
    setFormData({
      email: '',
      firstName: '',
      lastName: '',
      role,
      status: 'ACTIVE',
      studentId: '',
      year: '1',
      curriculumId: curricula[0]?.id || '',
      employeeId: '',
      departmentId: departments[0]?.id || '',
      academicTitle: 'TS.',
      specialization: '',
    });
  };

  const openCreate = (targetRole: ManagedRole = 'STUDENT') => {
    resetForm(targetRole);
    setShowCreateModal(true);
  };

  const openEdit = (userRecord: UserRecord) => {
    if (!isSuperAdmin && isRecordSuperAdmin(userRecord)) {
      toast.error(copy.cannotEditSuperAdmin);
      return;
    }
    setEditingUser(userRecord);
    setFormError('');
    setFieldErrors({});
    setFormData({
      email: userRecord.email,
      firstName: userRecord.firstName,
      lastName: userRecord.lastName,
      role: primaryManagedRole(userRecord.roles) ?? defaultRole,
      status: (userRecord.status ?? '').trim().toUpperCase() || 'ACTIVE',
      studentId: '',
      year: '1',
      curriculumId: curricula[0]?.id || '',
      employeeId: '',
      departmentId: departments[0]?.id || '',
      academicTitle: 'TS.',
      specialization: '',
    });
    setShowCreateModal(true);
  };

  // Closing the form must never clear the one-time credential: both updates
  // batch in the same handler, and clearing it here made the handoff modal
  // vanish so the issued password was shown to nobody.
  const closeFormModal = () => {
    setShowCreateModal(false);
    setFieldErrors({});
    resetForm();
  };

  const closeModal = () => {
    closeFormModal();
    setIssuedCredential(null);
  };

  const handleResetCredential = async (userRecord: UserRecord) => {
    if (resettingUserId) {
      return;
    }

    const shouldReset = await confirm({
      title: copy.resetTitle,
      message: copy.resetMessage
        .replace('{lastName}', () => userRecord.lastName)
        .replace('{firstName}', () => userRecord.firstName),
      confirmText: copy.resetConfirm,
      variant: 'destructive',
    });

    if (!shouldReset) {
      return;
    }

    setResettingUserId(userRecord.id);
    try {
      const result = await usersApi.resetPassword(userRecord.id);
      if (result.temporaryPassword) {
        setIssuedCredential({ email: result.email, secret: result.temporaryPassword });
      }
      toast.success(copy.resetSuccess);
      // A non-ACTIVE account cannot sign in until re-activated: surface that
      // while the one-time credential is on screen so the office does not
      // hand out a password that fails at first use.
      if ((userRecord.status ?? '').toUpperCase() !== 'ACTIVE') {
        toast.warning(
          copy.resetInactiveWarning.replace(
            '{status}',
            () => statusLabel(userRecord.status),
          ),
        );
      }
      await fetchUsers();
    } catch {
      toast.error(copy.resetFailed);
    } finally {
      setResettingUserId(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleDelete = async (userRecord: UserRecord) => {
    if (deleteInFlightRef.current !== null) return;

    if (user && (user.id === userRecord.id || user.email === userRecord.email)) {
      toast.error(copy.cannotDeleteSelf);
      return;
    }

    if (!isSuperAdmin && isRecordSuperAdmin(userRecord)) {
      toast.error(copy.cannotDeleteSuperAdmin);
      return;
    }

    deleteInFlightRef.current = userRecord.id;
    setDeletingUserId(userRecord.id);
    try {
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage
          .replace('{lastName}', () => userRecord.lastName)
          .replace('{firstName}', () => userRecord.firstName),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) {
        return;
      }

      await usersApi.delete(userRecord.id);
      toast.success(copy.deleted);
      if (users.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchUsers();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deleteInFlightRef.current = null;
      setDeletingUserId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    try {
      if (editingUser) {
        const isSelf = Boolean(user && (user.id === editingUser.id || user.email === editingUser.email));
        if (isSelf && !roleUnsupported && formData.role !== editingPrimaryRole) {
          const selfRoleMsg = copy.cannotChangeOwnRole;
          setFormError(selfRoleMsg);
          toast.error(selfRoleMsg);
          setIsSaving(false);
          return;
        }

        const nextFieldErrors: Record<string, string> = {};
        if (editNeedsStudentFields) {
          if (!formData.studentId.trim()) nextFieldErrors.studentId = copy.errors.studentIdRequired;
          if (!(formData.curriculumId || curricula[0]?.id)) nextFieldErrors.curriculumId = copy.errors.curriculumRequired;
        }
        if (editNeedsLecturerFields) {
          if (!formData.employeeId.trim()) nextFieldErrors.employeeId = copy.errors.employeeIdRequired;
          if (!(formData.departmentId || departments[0]?.id)) nextFieldErrors.departmentId = copy.errors.departmentRequired;
        }
        if (Object.keys(nextFieldErrors).length > 0) {
          setFieldErrors(nextFieldErrors);
          setIsSaving(false);
          return;
        }
        setFieldErrors({});

        const payload: Record<string, any> = {
          ...buildUserProfileUpdatePayload(editingUser, formData),
        };
        if (hasUserStatusChanged(editingUser.status, formData.status)) {
          payload.status = formData.status;
        }
        // Sending the displayed primary role replaces the complete system-role
        // set. Preserve companion roles (such as TRUONG_BO_MON + LECTURER)
        // on ordinary edits; only an explicit selector change is a conversion.
        if (!roleUnsupported && formData.role !== editingPrimaryRole) {
          payload.role = formData.role;
        }
        if (editNeedsStudentFields) {
          payload.studentId = formData.studentId.trim();
          payload.year = formData.year;
          payload.curriculumId = formData.curriculumId || curricula[0]?.id || '';
        }
        if (editNeedsLecturerFields) {
          payload.employeeId = formData.employeeId.trim();
          payload.departmentId = formData.departmentId || departments[0]?.id || '';
        }
        await usersApi.update(editingUser.id, payload);
        toast.success(copy.updated);
      } else {
        const nextFieldErrors: Record<string, string> = {};
        if (formData.role === 'STUDENT') {
          if (!formData.studentId.trim()) nextFieldErrors.studentId = copy.errors.studentIdRequired;
          if (!(formData.curriculumId || curricula[0]?.id)) nextFieldErrors.curriculumId = copy.errors.curriculumRequired;
        } else if (usesLecturerProfileRole(formData.role)) {
          if (!formData.employeeId.trim()) nextFieldErrors.employeeId = copy.errors.employeeIdRequired;
          if (!(formData.departmentId || departments[0]?.id)) nextFieldErrors.departmentId = copy.errors.departmentRequired;
        }
        if (Object.keys(nextFieldErrors).length > 0) {
          setFieldErrors(nextFieldErrors);
          setIsSaving(false);
          return;
        }
        setFieldErrors({});

        // The office never picks the start credential: the server issues a
        // one-time temporary password and the account must rotate it at first login.
        const payload: Record<string, any> = {
          email: formData.email.trim(),
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          role: formData.role,
        };

        if (formData.role === 'STUDENT') {
          payload.studentId = formData.studentId.trim();
          payload.year = formData.year;
          payload.curriculumId = formData.curriculumId || curricula[0]?.id || '';
          // departmentId is deliberately NOT sent: the DTO accepts it but the
          // student profile writer ignores it, so collecting a faculty choice
          // here would silently discard the admin's input.
        } else if (usesLecturerProfileRole(formData.role)) {
          // academicTitle and specialization are not fields of the user-create
          // DTO: they live on the lecturer directory record maintained by the
          // Academic Office, so the disabled inputs above must not pretend the
          // value travels with this account.
          payload.employeeId = formData.employeeId.trim();
          payload.departmentId = formData.departmentId || departments[0]?.id || '';
        }

        const created = await usersApi.create(payload);
        if (created.temporaryPassword) {
          setIssuedCredential({ email: created.email, secret: created.temporaryPassword });
        }

        if (formData.role === 'STUDENT') {
          toast.success(copy.createdStudent);
        } else if (formData.role === 'LECTURER') {
          toast.success(copy.createdLecturer);
        } else if (formData.role === 'TRUONG_KHOA') {
          toast.success(copy.createdDean);
        } else {
          toast.success(copy.createdUser);
        }
      }

      closeFormModal();
      await fetchUsers();
    } catch (err: any) {
      const code = err?.response?.data?.code as string | undefined;
      const codeField: Record<string, string> = {
        EMAIL_EXISTS: 'email',
        STUDENT_ID_EXISTS: 'studentId',
        EMPLOYEE_ID_EXISTS: 'employeeId',
      };
      const fieldKey = code ? codeField[code] : undefined;
      if (fieldKey) {
        const fieldMessages: Record<string, string> = {
          EMAIL_EXISTS: copy.errors.emailExists,
          STUDENT_ID_EXISTS: copy.errors.studentIdExists,
          EMPLOYEE_ID_EXISTS: copy.errors.employeeIdExists,
        };
        setFieldErrors({ [fieldKey]: fieldMessages[code as string] });
      }
      const message = campusErrorMessage(
        err,
        messages.common.campusErrors,
        copy.saveFailed,
      );
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const modalTitle = editingUser
    ? copy.editTitle
    : formData.role === 'STUDENT'
      ? copy.createStudentTitle
      : formData.role === 'LECTURER'
        ? copy.createLecturerTitle
        : formData.role === 'TRUONG_KHOA'
          ? copy.createDeanTitle
          : copy.createAdminTitle;

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => openCreate('STUDENT')}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
          >
            <GraduationCap className="mr-2 h-4 w-4" />
            {copy.createStudent}
          </Button>
          <Button
            onClick={() => openCreate('LECTURER')}
            variant="outline"
            className="border-role-lecturer/40 text-role-lecturer hover:bg-role-lecturer/10"
          >
            <School className="mr-2 h-4 w-4" />
            {copy.createLecturer}
          </Button>
          {isSuperAdmin ? (
            <>
              <Button
                onClick={() => openCreate('ADMIN')}
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {copy.roles.ADMIN}
              </Button>
              <Button
                onClick={() => openCreate('TRUONG_KHOA')}
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {copy.createDean}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
          <div className="flex flex-col gap-4">
            <div
              role="note"
              className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3"
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{copy.issuancePolicy}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {copy.issuancePolicyDescription}
                </p>
              </div>
            </div>
            {/* Filter Tabs by Role */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
              <span className="text-xs font-semibold text-muted-foreground mr-1">
                {copy.filterByRole}
              </span>
              <RoleTabButton
                active={roleFilter === 'ALL'}
                activeClassName="shadow-xs"
                onClick={() => {
                  setRoleFilter('ALL');
                  setPage(1);
                }}
              >
                {roleFilter === 'ALL'
                  ? copy.filterAll.replace('{count}', () => String(totalItems))
                  : copy.filterAllNoCount}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'STUDENT'}
                activeClassName="bg-status-info text-status-info-foreground shadow-xs hover:bg-status-info/90"
                onClick={() => {
                  setRoleFilter('STUDENT');
                  setPage(1);
                }}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                {copy.roles.STUDENT}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'LECTURER'}
                activeClassName="bg-status-success text-status-success-foreground shadow-xs hover:bg-status-success/90"
                onClick={() => {
                  setRoleFilter('LECTURER');
                  setPage(1);
                }}
              >
                <School className="h-3.5 w-3.5" />
                {copy.roles.LECTURER}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'ADMIN'}
                activeClassName="bg-status-neutral text-status-neutral-foreground shadow-xs hover:bg-status-neutral/90"
                onClick={() => {
                  setRoleFilter('ADMIN');
                  setPage(1);
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {copy.roles.ADMIN}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'TRUONG_KHOA'}
                activeClassName="bg-status-success text-status-success-foreground shadow-xs hover:bg-status-success/90"
                onClick={() => {
                  setRoleFilter('TRUONG_KHOA');
                  setPage(1);
                }}
              >
                <School className="h-3.5 w-3.5" />
                {copy.roles.TRUONG_KHOA}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'TRUONG_BO_MON'}
                activeClassName="bg-status-success text-status-success-foreground shadow-xs hover:bg-status-success/90"
                onClick={() => {
                  setRoleFilter('TRUONG_BO_MON');
                  setPage(1);
                }}
              >
                <School className="h-3.5 w-3.5" />
                {copy.roles.TRUONG_BO_MON}
              </RoleTabButton>
              <RoleTabButton
                active={roleFilter === 'SUPER_ADMIN'}
                activeClassName="bg-status-warning text-status-warning-foreground shadow-xs hover:bg-status-warning/90"
                onClick={() => {
                  setRoleFilter('SUPER_ADMIN');
                  setPage(1);
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {copy.roles.SUPER_ADMIN}
              </RoleTabButton>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="w-full max-w-xl">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {copy.searchUsers}
                </label>
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchUsers}
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
          </div>
        </AdminToolbarCard>

        {referenceError ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={referenceError}
            onRetry={() => void fetchReferenceData()}
          />
        ) : null}

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchUsers()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : users.length === 0 ? (
          <EmptyState
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            icon={Users}
            action={
              <div className="flex gap-2">
                <Button onClick={() => openCreate('STUDENT')}>
                  <GraduationCap className="mr-2 h-4 w-4" />
                  {copy.createStudent}
                </Button>
                <Button onClick={() => openCreate('LECTURER')} variant="outline">
                  <School className="mr-2 h-4 w-4" />
                  {copy.createLecturer}
                </Button>
              </div>
            }
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
                previousLabel={copy.previousPage}
                nextLabel={copy.nextPage}
              />
            }
          >
            <div className="divide-y divide-border/60 md:hidden">
              {users.map((record) => (
                <article key={record.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {record.lastName} {record.firstName}
                      </h3>
                      <p className="text-xs text-muted-foreground">{record.email}</p>
                    </div>
                    <StatusPill tone={userStatusTone(record.status)} className="py-1">
                      {statusLabel(record.status)}
                    </StatusPill>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{recordRoleLabel(record.roles)}</span>
                    <span>{formatDate(record.createdAt)}</span>
                  </div>
                  <AdminRowActions>
                    {(() => {
                      const isSelf = Boolean(user && (user.id === record.id || user.email === record.email));
                      const isPrivilegedTarget = isRecordPrivileged(record);
                      const canEditTarget = isSuperAdmin || !isPrivilegedTarget;
                      const canManageTarget = canEditTarget && deletingUserId === null;
                      return (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(record)} disabled={!canManageTarget}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            {copy.editRecord}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleResetCredential(record)}
                            disabled={isSelf || !canManageTarget || resettingUserId === record.id}
                            title={copy.resetAction}
                          >
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                            {copy.resetAction}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={() => void handleDelete(record)}
                            disabled={isSelf || !canManageTarget}
                            title={copy.deleteUserLabel
                              .replace('{lastName}', () => record.lastName)
                              .replace('{firstName}', () => record.firstName)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      );
                    })()}
                  </AdminRowActions>
                </article>
              ))}
            </div>

            <AdminTableScroll className="hidden md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-secondary text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">{copy.headers.name}</th>
                    <th className="px-4 py-3 font-medium">{copy.headers.email}</th>
                    <th className="px-4 py-3 font-medium">{copy.headers.status}</th>
                    <th className="px-4 py-3 font-medium">{copy.headers.role}</th>
                    <th className="px-4 py-3 font-medium">{copy.headers.created}</th>
                    <th className="px-4 py-3 text-right font-medium">{copy.headers.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {users.map((record) => {
                    const primary = primaryManagedRole(record.roles);
                    return (
                      <tr key={record.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-foreground">
                            {record.lastName} {record.firstName}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground font-mono text-xs">
                          {record.email}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusPill tone={userStatusTone(record.status)}>
                            {statusLabel(record.status)}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${roleToneClass(primary ?? '')}`}>
                            {primary === 'STUDENT' ? (
                              <GraduationCap className="h-3 w-3" />
                            ) : primary === 'LECTURER' ||
                              primary === 'TRUONG_KHOA' ||
                              primary === 'TRUONG_BO_MON' ? (
                              <School className="h-3 w-3" />
                            ) : (
                              <ShieldCheck className="h-3 w-3" />
                            )}
                            {primary ? copy.roles[primary] : recordRoleLabel(record.roles)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground text-xs">
                          {formatDate(record.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <AdminRowActions>
                            {(() => {
                              const isSelf = Boolean(user && (user.id === record.id || user.email === record.email));
                              // Mirror the server ceiling: a plain administrator
                              // can neither edit, reset, nor delete an account
                              // holding an ADMIN, SUPER_ADMIN, or TRUONG_KHOA role.
                              const isPrivilegedTarget = isRecordPrivileged(record);
                              const canEditTarget = isSuperAdmin || !isPrivilegedTarget;
                              const canManageTarget = canEditTarget && deletingUserId === null;
                              return (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => openEdit(record)}
                                    disabled={!canManageTarget}
                                    title={copy.editUserLabel
                                      .replace('{lastName}', () => record.lastName)
                                      .replace('{firstName}', () => record.firstName)}
                                    aria-label={copy.editUserLabel
                                      .replace('{lastName}', () => record.lastName)
                                      .replace('{firstName}', () => record.firstName)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => void handleResetCredential(record)}
                                    disabled={isSelf || !canManageTarget || resettingUserId === record.id}
                                    title={copy.resetAction}
                                    aria-label={copy.resetAction}
                                  >
                                    <KeyRound className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                                    onClick={() => void handleDelete(record)}
                                    disabled={isSelf || !canManageTarget}
                                    title={copy.deleteUserLabel
                                      .replace('{lastName}', () => record.lastName)
                                      .replace('{firstName}', () => record.firstName)}
                                    aria-label={copy.deleteUserLabel
                                      .replace('{lastName}', () => record.lastName)
                                      .replace('{firstName}', () => record.firstName)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              );
                            })()}
                          </AdminRowActions>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      {/* 2-COLUMN MODAL: TÁCH BIỆT THÊM SINH VIÊN VỚI GIẢNG VIÊN */}
      <Modal
        isOpen={showCreateModal}
        onClose={closeModal}
        title={modalTitle}
        closeLabel={copy.closeDialog}
        className="max-w-4xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {formError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-status-danger-foreground">
              {formError}
            </div>
          ) : null}

          {/* Quick role switcher inside modal if creating new */}
          {!editingUser && (
            <div className="rounded-xl border border-border/80 bg-secondary/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-xs font-semibold text-foreground">{copy.createAudienceLabel}</span>
                  <p className="text-xs text-muted-foreground">
                    {copy.createAudienceHint}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 self-stretch rounded-lg border border-border bg-background p-1 sm:self-auto [&>button]:flex-1 [&>button]:justify-center sm:[&>button]:flex-none">
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'STUDENT'}
                    activeClassName={roleSolidClass('STUDENT')}
                    onClick={() => {
                      setFormData((c) => ({ ...c, role: 'STUDENT' }));
                    }}
                  >
                    <GraduationCap className="h-3.5 w-3.5" />
                    {copy.roles.STUDENT}
                  </RoleTabButton>
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'LECTURER'}
                    activeClassName={roleSolidClass('LECTURER')}
                    onClick={() => {
                      setFormData((c) => ({ ...c, role: 'LECTURER' }));
                    }}
                  >
                    <School className="h-3.5 w-3.5" />
                    {copy.roles.LECTURER}
                  </RoleTabButton>
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'TRUONG_KHOA'}
                    activeClassName={roleSolidClass('TRUONG_KHOA')}
                    onClick={() => setFormData((c) => ({ ...c, role: 'TRUONG_KHOA' }))}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? copy.errors.adminReserved : undefined}
                  >
                    <School className="h-3.5 w-3.5" />
                    {copy.rolesShort.TRUONG_KHOA}
                  </RoleTabButton>
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'TRUONG_BO_MON'}
                    activeClassName={roleSolidClass('TRUONG_BO_MON')}
                    onClick={() => setFormData((c) => ({ ...c, role: 'TRUONG_BO_MON' }))}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? copy.errors.adminReserved : undefined}
                  >
                    <School className="h-3.5 w-3.5" />
                    {copy.rolesShort.TRUONG_BO_MON}
                  </RoleTabButton>
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'ADMIN'}
                    activeClassName={roleSolidClass('ADMIN')}
                    onClick={() => setFormData((c) => ({ ...c, role: 'ADMIN' }))}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? copy.errors.adminReserved : undefined}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {copy.rolesShort.ADMIN}
                  </RoleTabButton>
                  <RoleTabButton
                    className="rounded-md font-semibold"
                    inactiveClassName="bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                    active={formData.role === 'SUPER_ADMIN'}
                    activeClassName={roleSolidClass('SUPER_ADMIN')}
                    onClick={() => setFormData((c) => ({ ...c, role: 'SUPER_ADMIN' }))}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? copy.errors.adminReserved : undefined}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {copy.rolesShort.SUPER_ADMIN}
                  </RoleTabButton>
                </div>
              </div>
            </div>
          )}

          {/* 2-COLUMN FORM GRID */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* CỘT 1: THÔNG TIN TÀI KHOẢN & ĐĂNG NHẬP */}
            <div className="space-y-4 rounded-xl border border-border/80 bg-card p-4">
              <div className="flex items-center gap-2 border-b border-border/70 pb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {copy.accountSectionTitle}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {copy.accountSectionHint}
                  </p>
                </div>
              </div>

              <AdminFormField label={copy.emailLabel} error={fieldErrors.email}>
                <Input
                  type="email"
                  value={formData.email}
                  placeholder={
                    formData.role === 'STUDENT'
                      ? 'sv.nguyenvana@student.ute.edu.vn'
                      : usesLecturerProfileRole(formData.role)
                        ? 'gv.tranvanb@ute.edu.vn'
                        : 'admin.hoangdung@ute.edu.vn'
                  }
                  onChange={(e) => setFormData((current) => ({ ...current, email: e.target.value }))}
                  disabled={Boolean(editingUser)}
                  required
                />
              </AdminFormField>

              {!editingUser ? (
                <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-xs leading-5 text-muted-foreground">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.issuedSecretTitle}
                  </div>
                  <p className="mt-1">{copy.issuedSecretNote}</p>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <AdminFormField label={copy.lastName}>
                  <Input
                    type="text"
                    value={formData.lastName}
                    placeholder={copy.lastNamePlaceholder}
                    onChange={(e) => setFormData((current) => ({ ...current, lastName: e.target.value }))}
                    required
                  />
                </AdminFormField>
                <AdminFormField label={copy.firstName}>
                  <Input
                    type="text"
                    value={formData.firstName}
                    placeholder={copy.firstNamePlaceholder}
                    onChange={(e) => setFormData((current) => ({ ...current, firstName: e.target.value }))}
                    required
                  />
                </AdminFormField>
              </div>

              {editingUser ? (
                <>
                  <AdminFormField
                    label={copy.roleLabel}
                    description={
                      isSelfEditing
                        ? copy.selfRoleHint
                        : roleUnsupported
                          ? copy.unsupportedRoleHint
                          : undefined
                    }
                  >
                    <Select
                      value={roleUnsupported ? '' : formData.role}
                      disabled={isSelfEditing || roleUnsupported}
                      onChange={(e) => setFormData((c) => ({ ...c, role: e.target.value as ManagedRole }))}
                      options={(() => {
                        if (roleUnsupported) {
                          return [{ value: '', label: recordRoleLabel(editingUser.roles) }];
                        }
                        const options = [
                          { value: 'STUDENT', label: copy.roles.STUDENT },
                          { value: 'LECTURER', label: copy.roles.LECTURER },
                          ...(isSuperAdmin
                            ? [
                                { value: 'ADMIN', label: copy.roles.ADMIN },
                                { value: 'TRUONG_KHOA', label: copy.roles.TRUONG_KHOA },
                                { value: 'TRUONG_BO_MON', label: copy.roles.TRUONG_BO_MON },
                                { value: 'SUPER_ADMIN', label: copy.roles.SUPER_ADMIN },
                              ]
                            : []),
                        ];
                        if (editingPrimaryRole && !options.some((o) => o.value === editingPrimaryRole)) {
                          options.unshift({ value: editingPrimaryRole, label: copy.roles[editingPrimaryRole] });
                        }
                        return options;
                      })()}
                    />
                  </AdminFormField>
                  <AdminFormField
                    label={copy.statusFieldLabel}
                    description={isSelfEditing ? copy.selfStatusHint : undefined}
                  >
                    <Select
                      value={formData.status}
                      disabled={isSelfEditing}
                      onChange={(e) => setFormData((c) => ({ ...c, status: e.target.value }))}
                      options={[
                        ...(ACCOUNT_STATUSES.includes(
                          formData.status as (typeof ACCOUNT_STATUSES)[number],
                        )
                          ? []
                          : [{ value: formData.status, label: statusLabel(formData.status) }]),
                        ...ACCOUNT_STATUSES.map((status) => ({
                          value: status,
                          label: statusLabel(status),
                        })),
                      ]}
                    />
                  </AdminFormField>
                </>
              ) : (
                <div className="rounded-lg border border-border/60 bg-secondary/15 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{copy.initialStatusLabel}</span>
                    <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />} className="px-2 font-semibold">
                      {copy.initialStatusActive}
                    </StatusPill>
                  </div>
                </div>
              )}
            </div>

            {/* CỘT 2: HỒ SƠ HỌC VỤ CHUYÊN BIỆT THEO VAI TRÒ.
                On edit the profile section only reappears when the selected
                role needs a profile the record lacks (per hasStudentProfile /
                hasLecturerProfile): an existing official profile is never
                re-typed or reassigned from this form. */}
            {!showAssignmentColumn ? null : (
            <div className="space-y-4 rounded-xl border border-border/80 bg-card p-4">
              {/* Header Cột 2 */}
              <div className="flex items-center justify-between border-b border-border/70 pb-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md',
                    roleToneClass(formData.role),
                  )}>
                    {formData.role === 'STUDENT' ? (
                      <GraduationCap className="h-4 w-4" />
                    ) : usesLecturerProfileRole(formData.role) ? (
                      <School className="h-4 w-4" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {copy.assignmentSectionTitle}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {copy.assignmentHints[formData.role]}
                    </p>
                  </div>
                </div>

                <span className={cn(
                  'rounded-md px-2.5 py-0.5 text-xs font-semibold',
                  roleToneClass(formData.role),
                )}>
                  {copy.roles[formData.role]}
                </span>
              </div>

              {/* TRƯỜNG HỢP: SINH VIÊN */}
              {formData.role === 'STUDENT' && (!editingUser || editNeedsStudentFields) && (
                <div className="space-y-3.5">
                  <AdminFormField
                    label={copy.studentIdLabel}
                    description={copy.studentIdDescription}
                    error={fieldErrors.studentId}
                  >
                    <Input
                      type="text"
                      value={formData.studentId}
                      placeholder={copy.studentIdPlaceholder}
                      onChange={(e) => setFormData((c) => ({ ...c, studentId: e.target.value }))}
                      required
                    />
                  </AdminFormField>

                  <div className="grid grid-cols-2 gap-3">
                    <AdminFormField label={copy.cohortLabel}>
                      <Select
                        value={formData.year}
                        onChange={(e) => setFormData((c) => ({ ...c, year: e.target.value }))}
                        options={[
                          { value: '1', label: copy.yearOptions['1'] },
                          { value: '2', label: copy.yearOptions['2'] },
                          { value: '3', label: copy.yearOptions['3'] },
                          { value: '4', label: copy.yearOptions['4'] },
                        ]}
                      />
                    </AdminFormField>

                    <AdminFormField label={copy.curriculumLabel}>
                      <Select
                        value={formData.curriculumId || (curricula[0]?.id ?? '')}
                        onChange={(e) => setFormData((c) => ({ ...c, curriculumId: e.target.value }))}
                        options={
                          curricula.length > 0
                            ? curricula.map((curriculum) => ({
                                value: curriculum.id,
                                label: `${curriculum.nameVi || curriculum.name}${curriculum.totalCredits ? ` (${curriculum.totalCredits} ${creditUnit})` : ''}`,
                              }))
                            : [{ value: '', label: copy.loadingCurricula }]
                        }
                      />
                    </AdminFormField>
                  </div>

                  <AdminFormField label={copy.facultyLabel} description={copy.facultyManagedHint}>
                    {/* AdminUserCreateRequest accepts departmentId but the student
                        profile writer ignores it — show the field as office-assigned
                        instead of collecting a value the server will drop. */}
                    <Select
                      value=""
                      disabled
                      aria-disabled="true"
                      title={copy.facultyManagedHint}
                      options={[{ value: '', label: copy.facultyManagedHint }]}
                      className="cursor-not-allowed bg-muted/50 text-muted-foreground"
                    />
                  </AdminFormField>
                </div>
              )}

              {/* TRƯỜNG HỢP: GIẢNG VIÊN / TRƯỞNG KHOA */}
              {usesLecturerProfileRole(formData.role) && (!editingUser || editNeedsLecturerFields) && (
                <div className="space-y-3.5">
                  <AdminFormField
                    label={copy.employeeIdLabel}
                    description={copy.employeeIdDescription}
                    error={fieldErrors.employeeId}
                  >
                    <Input
                      type="text"
                      value={formData.employeeId}
                      placeholder={copy.employeeIdPlaceholder}
                      onChange={(e) => setFormData((c) => ({ ...c, employeeId: e.target.value }))}
                      required
                    />
                  </AdminFormField>

                  <div className="grid grid-cols-2 gap-3">
                    <AdminFormField
                      label={copy.academicTitleLabel}
                      description={copy.academicTitleManagedHint}
                    >
                      <Select
                        value={formData.academicTitle}
                        onChange={(e) => setFormData((c) => ({ ...c, academicTitle: e.target.value }))}
                        disabled
                        title={copy.academicTitleManagedHint}
                        options={[
                          { value: 'PGS.TS.', label: copy.academicTitleOptions['PGS.TS.'] },
                          { value: 'GS.TS.', label: copy.academicTitleOptions['GS.TS.'] },
                          { value: 'TS.', label: copy.academicTitleOptions['TS.'] },
                          { value: 'ThS.', label: copy.academicTitleOptions['ThS.'] },
                          { value: 'KS.', label: copy.academicTitleOptions['KS.'] },
                        ]}
                      />
                    </AdminFormField>

                    <AdminFormField label={copy.departmentLabel}>
                      <Select
                        value={formData.departmentId}
                        onChange={(e) => setFormData((c) => ({ ...c, departmentId: e.target.value }))}
                        options={[
                          { value: '', label: copy.selectDepartmentPlaceholder },
                          ...departments.map((department) => ({
                            value: department.id,
                            label: `${department.name}${department.code ? ` (${department.code})` : ''}`,
                          })),
                        ]}
                      />
                    </AdminFormField>
                  </div>

                  <AdminFormField
                    label={copy.specializationLabel}
                    description={copy.specializationManagedHint}
                  >
                    <Input
                      type="text"
                      value={formData.specialization}
                      placeholder={copy.specializationDescription}
                      disabled
                      title={copy.specializationManagedHint}
                      onChange={(e) => setFormData((c) => ({ ...c, specialization: e.target.value }))}
                    />
                  </AdminFormField>
                </div>
              )}

              {/* TRƯỜNG HỢP: QUẢN TRỊ VIÊN */}
              {(formData.role === 'ADMIN' || formData.role === 'SUPER_ADMIN') && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-role-admin/25 bg-role-admin/10 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-role-admin">
                      <ShieldCheck className="h-5 w-5" />
                      <span className="text-sm font-semibold">{copy.adminPermissionsTitle}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-5">
                      {copy.adminPermissionsDescription}
                    </p>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? copy.saving
                : editingUser
                  ? messages.common.actions.saveChanges
                  : formData.role === 'STUDENT'
                    ? copy.createStudentAction
                    : formData.role === 'LECTURER'
                      ? copy.createLecturerAction
                      : formData.role === 'TRUONG_KHOA'
                        ? copy.createDeanAction
                        : copy.createUser}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}

      {/* One-time office-issued credential handoff: shown exactly once. */}
      <Modal
        isOpen={Boolean(issuedCredential)}
        onClose={() => setIssuedCredential(null)}
        title={copy.credentialTitle}
        closeLabel={copy.closeDialog}
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">{copy.credentialDescription}</p>
          {issuedCredential ? (
            <>
              <p className="font-mono text-sm text-foreground">{issuedCredential.email}</p>
              <div className="flex items-center gap-2">
                <code
                  id="issued-temporary-secret"
                  className="min-w-0 flex-1 truncate rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-sm font-semibold text-foreground"
                >
                  {issuedCredential.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (!navigator.clipboard) {
                      toast.error(copy.copyFailed);
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(issuedCredential.secret);
                      toast.success(copy.copied);
                    } catch {
                      toast.error(copy.copyFailed);
                    }
                  }}
                >
                  {copy.copyAction}
                </Button>
              </div>
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs font-medium text-status-warning-foreground"
              >
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {copy.credentialShownOnce}
              </p>
            </>
          ) : null}
        </div>
      </Modal>
    </AdminFrame>
  );
}
