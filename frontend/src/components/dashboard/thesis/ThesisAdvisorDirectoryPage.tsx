'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Plus,
  Search,
  Users,
  UsersRound,
} from 'lucide-react';
import { LocalizedLink } from '@/components/LocalizedLink';
import { LinkButton } from '@/components/ui/link-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { useAuth, useRequireAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import { thesisWorkflowEn, thesisWorkflowVi } from '@/i18n/messages-thesis-workflow';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { lecturersApi, departmentsApi, fetchAllPages } from '@/lib/api';
import { thesisApi, type ThesisRound, type ThesisTopic } from '@/lib/thesis-api';
import type { Lecturer, Department } from '@/types/api';
import { normalizeVietnameseText } from '@/lib/registration-browse';
import { cn } from '@/lib/utils';

/** Cards rendered before the reader asks for more. */
const GRID_PAGE_SIZE = 12;
/** Supervision ceiling the directory assumes when a topic projection is absent. */
const DEFAULT_MAX_TOPICS = 5;

interface AdvisorWorkload {
  topicCount: number;
  maxTopics: number;
}

function getAdvisorFullName(lec: Lecturer): string {
  const parts = [lec.user?.lastName, lec.user?.firstName].map((part) => part?.trim()).filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' ').trim();
  }
  // The record's own identifier, never a guessed name.
  return lec.employeeId || '—';
}

function getAdvisorDisplayName(lec: Lecturer): string {
  const name = getAdvisorFullName(lec);
  const title = lec.title?.trim();
  // Stored names may already include the exact title. Require a name boundary
  // so matching title letters never hide part of a person's name.
  if (!title || name === title || (name.startsWith(title) && /^\s/.test(name.slice(title.length)))) {
    return name;
  }
  return `${title} ${name}`;
}

function getInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase());
  if (letters.length === 0) return '—';
  return `${letters[0]}${letters[letters.length - 1]}`;
}

function workloadFor(map: Map<string, AdvisorWorkload>, lecturerId: string): AdvisorWorkload {
  return map.get(lecturerId) || { topicCount: 0, maxTopics: DEFAULT_MAX_TOPICS };
}

// ---------------------------------------------------------------------------
// Local presentation primitives (single design language, no vendor UI kit)
// ---------------------------------------------------------------------------

function StatusPill({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold', statusToneClass(tone), className)}>
      {children}
    </span>
  );
}

function AdvisorAvatar({ lecturer, size = 'md' }: { lecturer: Lecturer; size?: 'sm' | 'md' | 'lg' }) {
  const src = lecturer.user?.avatar || '';
  const name = getAdvisorFullName(lecturer);
  const sizeClass =
    size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-9 w-9 text-xs' : 'h-11 w-11 text-sm';

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-primary font-bold text-primary-foreground',
        sizeClass,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={256} height={256} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{getInitials(name)}</span>
      )}
    </span>
  );
}

function QuotaBar({ topicCount, maxTopics, label }: AdvisorWorkload & { label: string }) {
  const isAvailable = topicCount < maxTopics;
  const percent = maxTopics > 0 ? Math.min(100, Math.round((topicCount / maxTopics) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label.replace('{count}', String(topicCount)).replace('{max}', String(maxTopics))}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div
        className={cn('h-full rounded-full transition-[width]', isAvailable ? 'bg-primary' : 'bg-status-neutral')}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
}

function Segmented<T extends string>({ value, onChange, options, ariaLabel }: SegmentedProps<T>) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + offset + options.length) % options.length;
    onChange(options[nextIndex].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-background hover:text-foreground',
            )}
          >
            {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface TableColumn<T> {
  key: string;
  title: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
}

function DataTable<T>({ columns, rows, rowKey, caption }: DataTableProps<T>) {
  return (
    <>
      {/* Desktop: full-width table with horizontal scroll fallback */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[880px] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/70 last:border-b-0 hover:bg-secondary/30">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn('px-4 py-3 align-middle', column.align === 'right' && 'text-right')}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile: one card per row, reusing each column's renderer */}
      <div className="space-y-3 md:hidden" role="list" aria-label={caption}>
        {rows.map((row) => (
          <div key={rowKey(row)} role="listitem" className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
            <dl className="space-y-3">
              {columns.map((column) => (
                <div key={column.key} className={cn(column.align === 'right' && 'text-right')}>
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {column.title}
                  </dt>
                  <dd className="mt-1">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ThesisAdvisorDirectoryPage() {
  const { user, isLoading: authLoading, hasAccess, isForbidden } = useRequireAuth();
  const { messages, locale } = useI18n();
  const searchParams = useSearchParams();
  const preselectedRoundId = searchParams.get('roundId') || '';

  const userRoles = user?.roles || (user?.role ? [user.role] : []);
  const isStudent = userRoles.includes('STUDENT');

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [topics, setTopics] = useState<ThesisTopic[]>([]);
  // 'failed' is an outage; 'ready' with an empty list is a genuinely
  // unpopulated directory. The two never render the same message.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  // Filtering states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('all');
  const [quotaFilter, setQuotaFilter] = useState<'all' | 'available' | 'full'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Pagination states
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [gridVisibleCount, setGridVisibleCount] = useState(GRID_PAGE_SIZE);

  // Modal detail state
  const [selectedAdvisor, setSelectedAdvisor] = useState<Lecturer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadFailedMessage = messages.thesis.loadFailed;

  useEffect(() => {
    let active = true;

    // The directory endpoint is intentionally staff-only (PeopleReadController
    // pins STUDENT -> 403 in its boundary tests). Firing it for a student would
    // manufacture a 403 and an outage-looking error state, so students get the
    // honest restricted panel instead (rendered below, before any data is used).
    if (isStudent) {
      return () => {
        active = false;
      };
    }

    async function loadData() {
      setLoadState('loading');
      setError('');

      const [lecResult, deptRes, roundsList] = await Promise.all([
        // The directory is the one required input. Its failure is reported
        // below; it is never silently replaced with invented faculty.
        // Walk every page: a limit-100 fetch truncated the directory at
        // lecturer #100 so later advisors were unsearchable and unassignable.
        fetchAllPages<Lecturer>((p, l) => lecturersApi.getAll({ page: p, limit: l }))
          .then((data) => ({ ok: true as const, data }))
          .catch(() => ({ ok: false as const, data: [] as Lecturer[] })),
        // Departments, rounds and topics only enrich the directory; losing
        // them degrades the enrichment, it does not invent a person.
        departmentsApi.getAll({ limit: 50 }).catch(() => ({ data: [] as Department[] })),
        thesisApi.listRounds().catch(() => [] as ThesisRound[]),
      ]);

      if (!active) return;

      setDepartments(Array.isArray(deptRes?.data) ? deptRes.data : []);

      if (!lecResult.ok) {
        setLecturers([]);
        setError(loadFailedMessage);
        setLoadState('failed');
        return;
      }

      setLecturers(lecResult.data);
      setLoadState('ready');

      const targetRound =
        roundsList.find((r) => r.id === preselectedRoundId) || roundsList[0];
      if (targetRound) {
        const topicList = await thesisApi
          .listTopics(targetRound.id, 'PUBLISHED')
          .catch(() => [] as ThesisTopic[]);
        if (active) setTopics(topicList);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [locale, preselectedRoundId, reloadToken, loadFailedMessage, isStudent]);

  // Advisor workload calculation (how many published topics each lecturer supervises)
  const advisorWorkloadMap = useMemo(() => {
    const map = new Map<string, AdvisorWorkload>();
    // topic.createdBy is the creator's User id (a lecturerId-claim variant is
    // possible), so resolve both identifiers back to the owning Lecturer row.
    const ownerByCreator = new Map<string, string>();
    lecturers.forEach((lec) => {
      ownerByCreator.set(lec.id, lec.id);
      if (lec.user?.id) {
        ownerByCreator.set(lec.user.id, lec.id);
      }
    });
    const credit = (creatorId: string | null | undefined) => {
      const ownerId = creatorId ? ownerByCreator.get(creatorId) : undefined;
      if (!ownerId) {
        return;
      }
      const current = map.get(ownerId) || { topicCount: 0, maxTopics: DEFAULT_MAX_TOPICS };
      map.set(ownerId, { ...current, topicCount: current.topicCount + 1 });
    };
    topics.forEach((topic) => {
      // ThesisTopic payloads do not carry supervisors yet; the optional
      // projection credits every listed supervisor when it ever arrives.
      const supervisors = (topic as ThesisTopic & { supervisors?: Array<{ lecturerId: string }> })
        .supervisors;
      if (supervisors && supervisors.length > 0) {
        supervisors.forEach((sup) => credit(sup.lecturerId));
      } else {
        credit(topic.createdBy);
      }
    });
    return map;
  }, [topics, lecturers]);

  // Filtered lecturers list based on search, department, and quota
  const filteredLecturers = useMemo(() => {
    const normalizedQuery = normalizeVietnameseText(searchQuery.trim());
    const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
    return lecturers.filter((lec) => {
      // 1. Multi-token diacritic-folded search filter across full name, title,
      // employeeId, email, specialization, and department name.
      const haystack = normalizeVietnameseText(
        [
          getAdvisorFullName(lec),
          lec.title || '',
          lec.employeeId || '',
          lec.user?.email || '',
          lec.specialization || '',
          lec.department?.name || '',
        ].join(' '),
      );
      const matchQuery =
        queryTokens.length === 0 || queryTokens.every((token) => haystack.includes(token));

      // 2. Department filter
      const matchDept = selectedDepartmentId === 'all' || lec.departmentId === selectedDepartmentId;

      // 3. Quota filter
      const workload = workloadFor(advisorWorkloadMap, lec.id);
      const isAvailable = workload.topicCount < workload.maxTopics;
      const matchQuota =
        quotaFilter === 'all' ||
        (quotaFilter === 'available' && isAvailable) ||
        (quotaFilter === 'full' && !isAvailable);

      return matchQuery && matchDept && matchQuota;
    });
  }, [lecturers, searchQuery, selectedDepartmentId, quotaFilter, advisorWorkloadMap]);

  // Statistics counters
  const stats = useMemo(() => {
    const total = lecturers.length;
    const available = lecturers.filter((l) => {
      const w = workloadFor(advisorWorkloadMap, l.id);
      return w.topicCount < w.maxTopics;
    }).length;
    return {
      total,
      available,
      departmentsCount: departments.length,
      activeTopicsCount: topics.length,
    };
  }, [lecturers, departments, topics, advisorWorkloadMap]);

  // A narrowing filter re-pages the result set from the top.
  useEffect(() => {
    setTablePage(1);
    setGridVisibleCount(GRID_PAGE_SIZE);
  }, [searchQuery, selectedDepartmentId, quotaFilter]);

  const retryLoad = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const isVi = locale === 'vi';
  const copy = isVi ? thesisWorkflowVi.advisorDirectory : thesisWorkflowEn.advisorDirectory;
  const st = messages.common.states;

  const departmentName = (departmentId?: string) => {
    if (!departmentId) return '—';
    const dept = departments.find((d) => d.id === departmentId);
    if (!dept) return departmentId;
    return (isVi ? dept.nameVi || dept.name : dept.nameEn || dept.name) || departmentId;
  };

  const pageCount = Math.max(1, Math.ceil(filteredLecturers.length / tablePageSize));
  const currentTablePage = Math.min(tablePage, pageCount);
  const pagedLecturers = filteredLecturers.slice(
    (currentTablePage - 1) * tablePageSize,
    currentTablePage * tablePageSize,
  );
  const visibleLecturers = filteredLecturers.slice(0, gridVisibleCount);
  const filtersActive =
    searchQuery.trim() !== '' || selectedDepartmentId !== 'all' || quotaFilter !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedDepartmentId('all');
    setQuotaFilter('all');
  };

  const openAdvisor = (lecturer: Lecturer) => {
    setSelectedAdvisor(lecturer);
    setIsModalOpen(true);
  };

  if (authLoading) {
    return <LoadingState label={messages.thesis.loading} />;
  }

  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  if (isStudent) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
          title={copy.title}
          description={copy.description}
        />
        <EmptyState
          icon={UsersRound}
          title={copy.studentEmptyTitle}
          description={copy.studentEmptyDescription}
        />
        <div>
          <LinkButton href="/dashboard/thesis/topics">
            {copy.openTopicCatalog}
          </LinkButton>
        </div>
      </div>
    );
  }

  const tableColumns: TableColumn<Lecturer>[] = [
    {
      key: 'name',
      title: copy.table.name,
      render: (record) => {
        const name = getAdvisorDisplayName(record);
        return (
          <div className="flex items-center gap-3">
            <AdvisorAvatar lecturer={record} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground">
                {name}
              </div>
              <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <span>{record.employeeId || '—'}</span>
                {record.user?.email ? (
                  <>
                    <span aria-hidden="true">•</span>
                    <span className="truncate" title={record.user.email}>{record.user.email}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'department',
      title: copy.table.department,
      render: (record) => (
        <StatusPill tone="info">{departmentName(record.departmentId)}</StatusPill>
      ),
    },
    {
      key: 'specialization',
      title: copy.table.specialization,
      render: (record) => (
        <div className="max-w-xs truncate text-xs text-foreground" title={record.specialization || undefined}>
          {record.specialization || '—'}
        </div>
      ),
    },
    {
      key: 'workload',
      title: copy.table.workload,
      render: (record) => {
        const workload = workloadFor(advisorWorkloadMap, record.id);
        const isAvailable = workload.topicCount < workload.maxTopics;
        return (
          <div className="w-36 space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span>{workload.topicCount}/{workload.maxTopics} {copy.quotaTopicSuffix}</span>
              <span className={isAvailable ? 'text-status-success-foreground' : 'text-muted-foreground'}>
                {isAvailable ? copy.statusAvailable : copy.statusFull}
              </span>
            </div>
            <QuotaBar {...workload} label={copy.quotaBarLabel} />
          </div>
        );
      },
    },
    {
      key: 'action',
      title: copy.table.actions,
      align: 'right',
      render: (record) => (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9 px-3 text-xs" onClick={() => openAdvisor(record)}>
            {copy.table.details}
          </Button>
          <LinkButton
            href={`/dashboard/thesis?advisorId=${record.id}&action=propose`}
            size="sm"
            className="h-9 px-3 text-xs"
          >
            {copy.table.select}
          </LinkButton>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 pb-12">
      {/* Top Header & Breadcrumb Navigation */}
      <PageHeader
        eyebrow={
          <SectionEyebrow>
            <LocalizedLink href="/dashboard/thesis" className="flex items-center gap-1 hover:underline">
              <span>{messages.thesis.title}</span>
              <span aria-hidden="true">/</span>
              <span>{copy.breadcrumb}</span>
            </LocalizedLink>
          </SectionEyebrow>
        }
        title={copy.pageTitle}
        tabLabel={copy.tabLabel}
        description={copy.pageDescription}
        actions={
          <div className="flex items-center gap-3">
            <LinkButton href="/dashboard/thesis" variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{copy.backToThesis}</span>
            </LinkButton>
            {isStudent ? (
              <LinkButton href="/dashboard/thesis?action=propose" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{copy.proposeTopic}</span>
              </LinkButton>
            ) : null}
          </div>
        }
      />

      {/* Executive Faculty & Defense Council Banner */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="flex flex-col justify-center space-y-2.5 p-6 lg:col-span-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                {copy.council.eyebrow}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {copy.council.badge}
              </span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {copy.council.title}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {copy.council.description}
            </p>
          </div>
          <div className="relative h-48 min-h-[160px] overflow-hidden border-t border-border/60 lg:col-span-4 lg:h-full lg:border-l lg:border-t-0">
            <picture className="absolute inset-0 block">
              <source srcSet="/images/banners/thesis_evaluation_council.webp" type="image/webp" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/banners/thesis_evaluation_council.jpg"
                alt={copy.council.imageAlt}
                width={2172}
                height={724}
                className="h-full w-full object-cover object-center transition duration-500 hover:scale-105"
              />
            </picture>
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent lg:hidden" />
            <div className="absolute bottom-2 left-3 rounded-md bg-background/85 px-2 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur-xs">
              {copy.council.imageCaption}
            </div>
          </div>
        </div>
      </div>

      {loadState === 'loading' ? (
        <LoadingState label={messages.thesis.loading} />
      ) : loadState === 'failed' ? (
        // An outage is an outage: the directory is not rendered at all, so a
        // failure can never be mistaken for "no advisors exist".
        <ErrorState
          title={copy.loadErrorTitle}
          description={`${error} ${copy.loadErrorSuffix}`}
          onRetry={retryLoad}
        />
      ) : (
        <>
          {/* Overview Stat Ribbon - Stitch Style */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.statsTotalFaculty}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.statsDepartments}
              </p>
              <p className="mt-1 text-2xl font-bold text-primary">{stats.departmentsCount}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.statsAcceptingStudents}
              </p>
              <p className="mt-1 text-2xl font-bold text-status-success-foreground">{stats.available}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.statsActiveTheses}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{stats.activeTopicsCount}</p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-2xs md:flex-row">
            <div className="flex w-full flex-1 flex-wrap items-center gap-3 md:w-auto">
              <div className="w-full sm:w-72">
                <Input
                  type="search"
                  aria-label={copy.searchLabel}
                  placeholder={copy.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  icon={<Search className="h-4 w-4" aria-hidden="true" />}
                  endAction={
                    searchQuery ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setSearchQuery('')}
                      >
                        {copy.clearSearch}
                      </Button>
                    ) : undefined
                  }
                />
              </div>

              <div className="w-full sm:w-60">
                <Select
                  aria-label={copy.departmentFilterLabel}
                  value={selectedDepartmentId}
                  onChange={(e) => setSelectedDepartmentId(e.target.value)}
                  options={[
                    { value: 'all', label: copy.allDepartments },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: (isVi ? d.nameVi || d.name : d.nameEn || d.name) || d.name,
                    })),
                  ]}
                />
              </div>

              <div className="w-full sm:w-48">
                <Select
                  aria-label={copy.quotaFilterLabel}
                  value={quotaFilter}
                  onChange={(e) => setQuotaFilter(e.target.value as 'all' | 'available' | 'full')}
                  options={[
                    { value: 'all', label: copy.allQuotas },
                    { value: 'available', label: copy.quotaAvailable },
                    { value: 'full', label: copy.quotaFull },
                  ]}
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
              <Segmented
                ariaLabel={copy.displayModeLabel}
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: 'grid', icon: <LayoutGrid className="h-4 w-4" />, label: copy.viewGrid },
                  { value: 'table', icon: <List className="h-4 w-4" />, label: copy.viewTable },
                ]}
              />
            </div>
          </div>

          {lecturers.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={copy.emptyDirectoryTitle}
              description={copy.emptyDirectoryDescription}
            />
          ) : filteredLecturers.length === 0 ? (
            <EmptyState
              icon={Search}
              title={copy.emptyMatchTitle}
              description={copy.emptyMatchDescription}
              action={
                filtersActive ? (
                  <Button type="button" variant="outline" onClick={resetFilters}>
                    {copy.clearFilters}
                  </Button>
                ) : undefined
              }
            />
          ) : viewMode === 'grid' ? (
            /* High-fidelity Card Grid */
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {visibleLecturers.map((lec) => {
                  const workload = workloadFor(advisorWorkloadMap, lec.id);
                  const isAvailable = workload.topicCount < workload.maxTopics;
                  const fullName = getAdvisorDisplayName(lec);

                  return (
                    <Card
                      key={lec.id}
                      className="flex flex-col justify-between rounded-xl border-border/90 shadow-2xs transition-all duration-200 hover:border-primary hover:shadow-md"
                    >
                      <div className="flex h-full flex-col p-5">
                        <div>
                          {/* Top row: Avatar + Name + Department */}
                          <div className="flex items-start gap-3.5">
                            <AdvisorAvatar lecturer={lec} size="lg" />
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-base font-bold text-foreground" title={fullName}>
                                {fullName}
                              </h3>
                              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate" title={departmentName(lec.departmentId)}>{departmentName(lec.departmentId)}</span>
                              </p>
                              <div className="mt-1.5">
                                <StatusPill tone={isAvailable ? 'success' : 'neutral'}>
                                  {isAvailable ? copy.cardAvailable : copy.cardFullQuota}
                                </StatusPill>
                              </div>
                            </div>
                          </div>

                          {/* Contact Info */}
                          <div className="mt-4 space-y-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2 truncate">
                              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate" title={lec.user?.email || undefined}>{lec.user?.email || '—'}</span>
                            </div>
                            <div className="flex items-center gap-2 truncate">
                              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate" title={lec.office || undefined}>{lec.office || '—'}</span>
                            </div>
                          </div>

                          {/* Research Specialization */}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {lec.specialization ? (
                              <StatusPill
                                tone="neutral"
                                className="max-w-full truncate"
                              >
                                <span className="truncate" title={lec.specialization}>
                                  {lec.specialization}
                                </span>
                              </StatusPill>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </div>

                          {/* Supervision Quota & Metrics */}
                          <div className="mt-4 rounded-lg border border-border/70 bg-secondary/40 p-2.5">
                            <div className="mb-1.5 flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <span>{copy.cardAdvising}</span>
                              </span>
                              <span className="font-bold text-foreground">
                                {workload.topicCount} / {workload.maxTopics} {copy.cardThesesSuffix}
                              </span>
                            </div>
                            <QuotaBar {...workload} label={copy.quotaBarLabel} />
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 min-w-0 flex-1 basis-32 rounded-lg text-xs font-semibold"
                            onClick={() => openAdvisor(lec)}
                          >
                            {copy.viewBio}
                          </Button>
                          <LinkButton
                            href={`/dashboard/thesis?advisorId=${lec.id}&action=propose`}
                            className="h-9 min-w-0 flex-1 basis-32 justify-center rounded-lg text-xs font-semibold"
                          >
                            {copy.cardSelect}
                          </LinkButton>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {filteredLecturers.length > visibleLecturers.length ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGridVisibleCount((count) => count + GRID_PAGE_SIZE)}
                  >
                    {copy.loadMore
                      .replace('{visible}', String(visibleLecturers.length))
                      .replace('{total}', String(filteredLecturers.length))}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            /* High-density data table */
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
              <DataTable
                columns={tableColumns}
                rows={pagedLecturers}
                rowKey={(row) => row.id}
                caption={copy.table.caption}
              />

              <div className="flex flex-col items-center justify-between gap-3 border-t border-border/70 px-4 py-3 sm:flex-row">
                <p className="text-xs text-muted-foreground">
                  {st.showingResults}{' '}
                  {(currentTablePage - 1) * tablePageSize + 1}
                  {' – '}
                  {(currentTablePage - 1) * tablePageSize + pagedLecturers.length} {st.of}{' '}
                  {filteredLecturers.length} {st.results}
                </p>

                <div className="flex items-center gap-2">
                  <div className="w-36">
                    <Select
                      aria-label={copy.rowsPerPage}
                      value={String(tablePageSize)}
                      onChange={(e) => {
                        setTablePageSize(Number(e.target.value) || 10);
                        setTablePage(1);
                      }}
                      options={[
                        { value: '10', label: st.perPage10 },
                        { value: '25', label: st.perPage25 },
                        { value: '50', label: st.perPage50 },
                      ]}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={st.goToPreviousPage}
                    disabled={currentTablePage <= 1}
                    onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className="text-xs font-semibold text-foreground">
                    {st.page} {currentTablePage} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={st.goToNextPage}
                    disabled={currentTablePage >= pageCount}
                    onClick={() => setTablePage((page) => Math.min(pageCount, page + 1))}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Advisor Detail Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          selectedAdvisor
            ? getAdvisorDisplayName(selectedAdvisor)
            : undefined
        }
        className="max-w-2xl"
      >
        {selectedAdvisor ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <AdvisorAvatar lecturer={selectedAdvisor} size="lg" />
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">
                  {selectedAdvisor.employeeId || '—'} • {copy.modalFacultyMember}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{departmentName(selectedAdvisor.departmentId)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-secondary/40 p-3 text-xs">
              <div>
                <span className="block text-muted-foreground">{copy.modalDepartment}</span>
                <span className="font-semibold text-foreground">{departmentName(selectedAdvisor.departmentId)}</span>
              </div>
              <div>
                <span className="block text-muted-foreground">{copy.modalEmail}</span>
                <span className="font-semibold text-foreground">{selectedAdvisor.user?.email || '—'}</span>
              </div>
              <div>
                <span className="block text-muted-foreground">{copy.modalOffice}</span>
                <span className="font-semibold text-foreground">{selectedAdvisor.office || '—'}</span>
              </div>
              <div>
                <span className="block text-muted-foreground">{copy.modalPhone}</span>
                <span className="font-semibold text-foreground">{selectedAdvisor.phone || '—'}</span>
              </div>
            </div>

            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {copy.modalResearchHeading}
              </h4>
              <p className="text-sm leading-relaxed text-foreground">
                {selectedAdvisor.specialization || '—'}
              </p>
            </div>

            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {copy.modalSupervisionHeading}
              </h4>
              <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/40 p-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">
                    {copy.modalSupervisedTopics}
                  </span>
                  <span className="text-foreground">
                    {workloadFor(advisorWorkloadMap, selectedAdvisor.id).topicCount} /{' '}
                    {workloadFor(advisorWorkloadMap, selectedAdvisor.id).maxTopics}
                  </span>
                </div>
                <QuotaBar {...workloadFor(advisorWorkloadMap, selectedAdvisor.id)} label={copy.quotaBarLabel} />
              </div>
            </div>

            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {copy.modalGuidelinesHeading}
              </h4>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>
                  {copy.modalGuidelineOne}
                </li>
                <li>
                  {copy.modalGuidelineTwo}
                </li>
                <li>
                  {copy.modalGuidelineThree}
                </li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                {copy.modalClose}
              </Button>
              <LinkButton
                href={`/dashboard/thesis?advisorId=${selectedAdvisor.id}&action=propose`}
                onClick={() => setIsModalOpen(false)}
              >
                {copy.modalProposeWithAdvisor}
              </LinkButton>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
