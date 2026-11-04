'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, Download, FileText, Printer, Save, Send, Users } from 'lucide-react';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { LinkButton } from '@/components/ui/link-button';
import { metricToneClass } from '@/components/ui/status';
import { useRequireAuth } from '@/context/AuthContext';
import { sectionsApi } from '@/lib/api';
import { getLocalizedFlatLabel } from '@/lib/academic-content';
import { GradeUpdate, SectionGrades } from '@/types/api';
import { GradeImportPanel } from '@/components/lecturer/GradeImportPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { UnsavedChangesConfirmDialog } from '@/components/ui/unsaved-changes-confirm';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes-guard';
import { useI18n } from '@/i18n';
import { campusErrorMessage } from '@/lib/campus-error';
import { campusTodayIso } from '@/lib/attendance-checkin';
import {
  calculateGrade,
  computeGradeSummary,
  downloadCsvFile,
  generateGradeCsv,
} from '@/lib/grade-export';
import { toast } from 'sonner';

function hasCompletedGrade(update: GradeUpdate | undefined) {
  return Boolean(update && update.processScore !== null && update.finalExamScore !== null);
}

function createGradeDrafts(enrollments: SectionGrades['enrollments']) {
  const drafts = new Map<string, GradeUpdate>();
  enrollments.forEach((enrollment) => {
    drafts.set(enrollment.id, {
      enrollmentId: enrollment.id,
      processScore: enrollment.processScore ?? null,
      finalExamScore: enrollment.finalExamScore ?? null,
      ...(typeof enrollment.version === 'number' ? { version: enrollment.version } : {}),
    });
  });
  return drafts;
}

function applyImportedGradeRows(
  previous: Map<string, GradeUpdate>,
  rows: { enrollmentId: string; processScore: number; finalExamScore: number }[],
) {
  const next = new Map(previous);
  for (const row of rows) {
    const current = next.get(row.enrollmentId) ?? {
      enrollmentId: row.enrollmentId,
      processScore: null,
      finalExamScore: null,
    };
    next.set(row.enrollmentId, {
      ...current,
      processScore: row.processScore,
      finalExamScore: row.finalExamScore,
    });
  }
  return next;
}

function preserveGradeDraftRows(
  nextGrades: Map<string, GradeUpdate>,
  updates: GradeUpdate[],
) {
  const next = new Map(nextGrades);
  updates.forEach((update) => next.set(update.enrollmentId, update));
  return next;
}

function buildGradeSaveRows(
  enrollments: SectionGrades['enrollments'],
  editedIds: Set<string>,
  grades: Map<string, GradeUpdate>,
) {
  const editedRows = enrollments.filter((enrollment) => editedIds.has(enrollment.id));
  const clearedRows = editedRows.filter((enrollment) => {
    const update = grades.get(enrollment.id);
    const nowEmpty = !update || (update.processScore === null && update.finalExamScore === null);
    const hadSaved = enrollment.processScore !== null || enrollment.finalExamScore !== null;
    return nowEmpty && hadSaved;
  });
  const clearedIds = new Set(clearedRows.map((enrollment) => enrollment.id));
  const partialRows = editedRows.filter(
    (enrollment) => !clearedIds.has(enrollment.id) && !hasCompletedGrade(grades.get(enrollment.id)),
  );
  const updates: GradeUpdate[] = [
    ...editedRows
      .filter((enrollment) => hasCompletedGrade(grades.get(enrollment.id)))
      .map((enrollment) => grades.get(enrollment.id))
      .filter((update): update is GradeUpdate => hasCompletedGrade(update)),
    ...clearedRows.map((enrollment) => {
      const update = grades.get(enrollment.id);
      return {
        enrollmentId: enrollment.id,
        processScore: null,
        finalExamScore: null,
        ...(typeof update?.version === 'number' ? { version: update.version } : {}),
      };
    }),
  ];

  return { editedRows, partialRows, updates };
}

function isStaleVersionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { data?: { code?: unknown } } }).response;
  return response?.data?.code === 'STALE_VERSION';
}

// Score drafts stay strings until commit so "9." and empty inputs survive
// keystrokes instead of snapping to 0 and stamping an F per character.
function isGradeComplete(update: GradeUpdate | undefined) {
  return hasCompletedGrade(update);
}

// Integer-cent average of two stored NUMERIC(4,2) scores: matches the
// backend's BigDecimal HALF_UP-at-2dp exactly (float (p+f)/2 lands just
// below a .005 tie and flips the letter grade, e.g. 3.99+4.00).
function totalScore(update: GradeUpdate | undefined) {
  return hasCompletedGrade(update)
    ? Math.round((Math.round(update!.processScore! * 100) + Math.round(update!.finalExamScore! * 100)) / 2) / 100
    : null;
}

function formatVietnameseName(name: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const vietnameseSurnames = new Set([
    'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan',
    'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Đoàn', 'Trịnh',
  ]);
  const lastToken = parts[parts.length - 1];
  if (vietnameseSurnames.has(lastToken)) {
    return [lastToken, ...parts.slice(0, parts.length - 1)].join(' ');
  }
  return name;
}

export default function SectionGradingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasAccess, isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const { locale, formatDate, formatNumber, messages, href } = useI18n();
  const gradeEntry = messages.teachingPages.gradeEntry;
  const [sectionData, setSectionData] = useState<SectionGrades | null>(null);
  const [grades, setGrades] = useState<Map<string, GradeUpdate>>(new Map());
  const [editedIds, setEditedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  // A background refetch (after save) must not unmount the matrix: the old
  // full LoadingState swap scrolled the lecturer back to the top mid-session.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [staleVersionConflict, setStaleVersionConflict] = useState(false);
  const [remoteChangedRows, setRemoteChangedRows] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [scoreErrors, setScoreErrors] = useState<Map<string, string>>(new Map());
  const publishGuard = useRef({ sectionId: '', ready: false });
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const sectionId = params?.id;
  // Section navigation must never let an old request write into the new
  // sheet: every load/mutation captures the section it started on, and the
  // generation counter rejects anything superseded by a newer request.
  const gradeRequestRef = useRef(0);
  const loadedSectionRef = useRef('');
  const currentSectionRef = useRef('');
  const gradeMutationRef = useRef(0);
  if (currentSectionRef.current !== (sectionId ?? '')) {
    // Bump before the ref flips so a save/publish started on the previous
    // section dies here — section id alone cannot catch an A→B→A detour.
    gradeMutationRef.current += 1;
    currentSectionRef.current = sectionId ?? '';
  }
  const localizedCourseName = useMemo(
    () =>
      sectionData
        ? getLocalizedFlatLabel(
            locale,
            sectionData.courseName,
            sectionData.courseNameEn,
            sectionData.courseNameVi,
            sectionData.courseName,
          )
        : '',
    [locale, sectionData],
  );

  const semesterDisplayName = useMemo(() => {
    if (!sectionData) return '';
    const localizedSemesterName = locale === 'vi' ? sectionData.semesterNameVi : sectionData.semesterNameEn;
    return localizedSemesterName || sectionData.semester || gradeEntry.currentTermFallback;
  }, [gradeEntry.currentTermFallback, locale, sectionData]);

  const lecturerDisplayName = useMemo(() => {
    if (sectionData?.lecturerName) return sectionData.lecturerName;
    if (user?.lastName || user?.firstName) {
      return [user.lastName, user.firstName].filter(Boolean).join(' ');
    }
    return gradeEntry.facultyFallback;
  }, [gradeEntry.facultyFallback, sectionData?.lecturerName, user]);

  const statusLabel = (status: string | null | undefined) =>
    messages.common.statuses[
      (status ?? 'UNKNOWN').toUpperCase() as keyof typeof messages.common.statuses
    ] ?? messages.common.statuses.UNKNOWN;

  // The letterhead must carry the section's real department — a hardcoded
  // faculty name printed the wrong institution on non-IT rosters.
  const printDepartmentName = useMemo(() => {
    if (!sectionData) return gradeEntry.print.department;
    return getLocalizedFlatLabel(
      locale,
      sectionData.departmentName,
      sectionData.departmentNameEn,
      sectionData.departmentNameVi,
      gradeEntry.print.department,
    );
  }, [locale, sectionData, gradeEntry.print.department]);

  const fetchSectionGrades = useCallback(
    async (options?: {
      silent?: boolean;
      preserveLocalRows?: GradeUpdate[];
      preserveMissingLocalRows?: boolean;
      compareBaseline?: SectionGrades;
    }) => {
    const requestId = ++gradeRequestRef.current;
    const loadSectionId = sectionId;
    const isCurrent = () =>
      requestId === gradeRequestRef.current && loadSectionId === currentSectionRef.current;
    publishGuard.current.ready = false;
    if (!loadSectionId) {
      setError(gradeEntry.missingSection);
      setIsLoading(false);
      return;
    }

    if (options?.silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError('');

    // A different section id means the previous roster, drafts and inline
    // errors describe another sheet — drop them before the new load renders.
    if (loadedSectionRef.current !== loadSectionId) {
      setSectionData(null);
      setGrades(new Map());
      setEditedIds(new Set());
      setScoreErrors(new Map());
      setStaleVersionConflict(false);
      setRemoteChangedRows(null);
      // A save/publish of the old section may still be in flight; reset its
      // busy flags here because its finally skips a newer operation's state.
      setIsSaving(false);
      setIsPublishing(false);
    }

    try {
      const data = (await sectionsApi.getSectionGrades(loadSectionId)) as SectionGrades;
      if (!isCurrent()) return;
      loadedSectionRef.current = loadSectionId;
      setSectionData(data);

      const nextGrades = createGradeDrafts(data.enrollments);

      if (options?.compareBaseline) {
        const previousById = new Map(
          options.compareBaseline.enrollments.map((enrollment) => [enrollment.id, enrollment]),
        );
        const latestById = new Map(data.enrollments.map((enrollment) => [enrollment.id, enrollment]));
        const changedRows: string[] = [];
        data.enrollments.forEach((enrollment) => {
          const previous = previousById.get(enrollment.id);
          if (
            !previous
            || previous.version !== enrollment.version
            || (previous.processScore ?? null) !== (enrollment.processScore ?? null)
            || (previous.finalExamScore ?? null) !== (enrollment.finalExamScore ?? null)
            || previous.gradeStatus !== enrollment.gradeStatus
          ) {
            changedRows.push(`${enrollment.studentCode} (${enrollment.studentName})`);
          }
        });
        options.compareBaseline.enrollments.forEach((enrollment) => {
          if (!latestById.has(enrollment.id)) {
            changedRows.push(`${enrollment.studentCode} (${enrollment.studentName})`);
          }
        });
        setRemoteChangedRows(changedRows);
      }

      // LEC-P3-B3: after a partial save the server copy of the skipped rows
      // is older than what is on screen, so overlay the local half-entered
      // drafts instead of wiping them, and keep those rows flagged as edited
      // so the marker and the save-count stay truthful.
      const preservedRows: GradeUpdate[] = [];
      (options?.preserveLocalRows ?? []).forEach((update) => {
        if (nextGrades.has(update.enrollmentId) || options?.preserveMissingLocalRows) {
          preservedRows.push(update);
        }
      });
      const preservedIds = new Set(preservedRows.map((update) => update.enrollmentId));

      setGrades(preserveGradeDraftRows(nextGrades, preservedRows));
      if (options?.preserveLocalRows) {
        setEditedIds(preservedIds);
        // Saved rows keep no stale inline errors; preserved rows keep theirs.
        const keptErrorKeys = new Set<string>();
        preservedIds.forEach((enrollmentId) => {
          keptErrorKeys.add(`${enrollmentId}:processScore`);
          keptErrorKeys.add(`${enrollmentId}:finalExamScore`);
        });
        setScoreErrors((previous) => {
          if (previous.size === 0) return previous;
          const next = new Map(previous);
          Array.from(next.keys()).forEach((key) => {
            if (!keptErrorKeys.has(key)) next.delete(key);
          });
          return next;
        });
      } else {
        setEditedIds(new Set());
      }
    } catch (requestError: any) {
      if (isCurrent()) {
        setError(
          campusErrorMessage(requestError, messages.common.campusErrors, gradeEntry.loadFailed),
        );
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
    },
    [gradeEntry.loadFailed, gradeEntry.missingSection, messages.common.campusErrors, sectionId],
  );

  useEffect(() => {
    if (hasAccess) {
      void fetchSectionGrades();
    }
    return () => {
      gradeRequestRef.current += 1;
    };
  }, [fetchSectionGrades, hasAccess]);

  // Only a real unmount may retire in-flight mutations — bumping the epoch
  // inside the load effect's cleanup would also fire on locale/message-driven
  // reruns and strand the busy flag a still-current save could not release.
  useEffect(() => () => {
    gradeMutationRef.current += 1;
  }, []);

  const hasChanges = editedIds.size > 0;

  // LEC-P3-B1: leaving the sheet with typed scores discards them. The shared
  // guard adds the beforeunload dialog, the in-app confirm for the back link,
  // and — with interceptRouteChanges — covers SPA route changes the browser
  // dialog never sees: sidebar <Link> clicks and browser Back now confirm
  // first. The header back link keeps its explicit requestLeave wiring; the
  // two paths are idempotent against each other.
  const unsaved = useUnsavedChangesGuard({
    isDirty: useCallback(() => editedIds.size > 0, [editedIds]),
    enabled: !isSaving,
    interceptRouteChanges: true,
  });
  const { requestLeave, confirmLeave, cancelLeave, confirmOpen } = unsaved;

  const allGraded = useMemo(() => {
    if (!sectionData || sectionData.enrollments.length === 0) {
      return false;
    }

    return sectionData.enrollments.every((enrollment) =>
      hasCompletedGrade(grades.get(enrollment.id)),
    );
  }, [grades, sectionData]);

  const publishReady = allGraded && !hasChanges && scoreErrors.size === 0
    && !isSaving && !isRefreshing && !isPublishing && !isLoading && !error
    && Boolean(sectionData?.enrollments.some((enrollment) => enrollment.gradeStatus !== 'PUBLISHED'))
    // The data on screen must belong to the route's section — a transient
    // render after navigation could otherwise publish the previous sheet.
    && sectionData?.sectionId === sectionId;
  publishGuard.current = { sectionId: sectionId ?? '', ready: Boolean(publishReady) };

  const markEdited = (enrollmentId: string) => {
    // Invalidate before React renders: confirmation may still be awaiting a reply.
    publishGuard.current.ready = false;
    setEditedIds((previous) => {
      if (previous.has(enrollmentId)) {
        return previous;
      }

      const next = new Set(previous);
      next.add(enrollmentId);
      return next;
    });
  };

  /** Focus the first matching score cell that is actually on screen (the
   *  mobile cards and the desktop table are both mounted, CSS-hidden). */
  const focusCell = (dataCell: string) => {
    if (typeof document === 'undefined') return;
    const candidates = Array.from(
      document.querySelectorAll<HTMLInputElement>(`[data-cell="${dataCell}"]`),
    );
    const visible = candidates.find((el) => el.offsetParent !== null) ?? candidates[0];
    visible?.focus();
    visible?.select();
  };

  const focusFirstInvalidCell = () => {
    const firstErrorKey = scoreErrors.keys().next().value;
    if (firstErrorKey) focusCell(`grade-${firstErrorKey}`);
  };

  const focusFirstPartialCell = () => {
    const partial = sectionData?.enrollments.find(
      (enrollment) => editedIds.has(enrollment.id) && !hasCompletedGrade(grades.get(enrollment.id)),
    );
    if (!partial) return;
    const current = grades.get(partial.id);
    focusCell(`grade-${partial.id}:${current?.processScore == null ? 'processScore' : 'finalExamScore'}`);
  };

  /** Enter / ArrowDown moves to the next student's same column, ArrowUp the
   *  previous one — a 60-row matrix is unusable if every step is two Tabs. */
  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    enrollmentIndex: number,
    field: 'processScore' | 'finalExamScore',
  ) => {
    if (!sectionData || (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const next = sectionData.enrollments[enrollmentIndex + delta];
    if (!next) return;
    focusCell(`grade-${next.id}:${field}`);
  };

  /**
   * A `type="number"` input shows characters it rejects while reporting an empty
   * `value`, so an out-of-range or non-numeric entry used to vanish silently:
   * the lecturer saw the text, no message, and a save that quietly dropped it.
   * `badInput` is the reliable signal that the browser rejected the entry.
   */
  const handleScoreChange = (
    enrollmentId: string,
    field: 'processScore' | 'finalExamScore',
    draft: string,
    badInput = false,
  ) => {
    markEdited(enrollmentId);
    const errorKey = `${enrollmentId}:${field}`;
    const normalizedDraft = draft.replace(',', '.');
    const trimmed = normalizedDraft.trim();
    const parsed = trimmed === '' ? null : Number(normalizedDraft);
    const invalid =
      badInput || (trimmed !== '' && (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 10));

    setScoreErrors((previous) => {
      const next = new Map(previous);
      if (invalid) next.set(errorKey, gradeEntry.invalidScore);
      else next.delete(errorKey);
      return next;
    });
    if (invalid) {
      // Keep the last valid value in state; the inline message explains why.
      return;
    }

    setGrades((previous) => {
      const next = new Map(previous);
      const current = next.get(enrollmentId) ?? { enrollmentId, processScore: null, finalExamScore: null };
      next.set(enrollmentId, { ...current, [field]: parsed });
      return next;
    });
  };

  /** Feedback item 9: an imported sheet lands in the same table the lecturer
   *  reviews, so the existing save path and its validation stay authoritative. */
  const applyImportedRows = (rows: { enrollmentId: string; processScore: number; finalExamScore: number }[]) => {
    setGrades((previous) => applyImportedGradeRows(previous, rows));
    setScoreErrors((previous) => {
      const next = new Map(previous);
      for (const row of rows) {
        next.delete(`${row.enrollmentId}:processScore`);
        next.delete(`${row.enrollmentId}:finalExamScore`);
      }
      return next;
    });
    for (const row of rows) markEdited(row.enrollmentId);
  };

  const handleSave = async () => {
    if (!sectionId || !sectionData || sectionData.sectionId !== sectionId
        || isSaving || isPublishing || isRefreshing || staleVersionConflict) {
      return;
    }
    const saveSectionId = sectionId;
    const saveMutation = ++gradeMutationRef.current;
    const saveIsCurrent = () =>
      saveSectionId === currentSectionRef.current &&
      saveMutation === gradeMutationRef.current;

    // The backend upserts only the rows it receives, so submit just the
    // enrollments the lecturer actually edited instead of the whole roster.
    const { editedRows, partialRows, updates } = buildGradeSaveRows(
      sectionData.enrollments,
      editedIds,
      grades,
    );

    // An out-of-range entry keeps the previous value in state, so saving now
    // would persist something other than what the lecturer sees on screen.
    if (scoreErrors.size > 0) {
      toast.error(gradeEntry.invalidScore);
      focusFirstInvalidCell();
      return;
    }

    // Partial rows cannot be submitted (the backend averages both columns),
    // but dropping them silently made Save look broken. Name them instead.
    if (editedRows.length > 0 && updates.length === 0) {
      toast.error(gradeEntry.partialRowsOnly.replace('{count}', formatNumber(partialRows.length)));
      focusFirstPartialCell();
      return;
    }

    publishGuard.current.ready = false;
    setIsSaving(true);

    try {
      await sectionsApi.updateSectionGrades(saveSectionId, updates);
      if (!saveIsCurrent()) return;
      setStaleVersionConflict(false);
      setRemoteChangedRows(null);
      if (partialRows.length > 0) {
        toast.warning(gradeEntry.partialRowsSkipped.replace('{count}', formatNumber(partialRows.length)));
      }
      toast.success(gradeEntry.saved);
      // LEC-P3-B3: hand the silent refetch the drafts of the rows it skipped
      // so their half-entered scores survive instead of vanishing from the
      // cells behind the warning.
      const skippedDrafts = partialRows
        .map((enrollment) => grades.get(enrollment.id))
        .filter((update): update is GradeUpdate => Boolean(update));
      await fetchSectionGrades({ silent: true, preserveLocalRows: skippedDrafts });
    } catch (requestError: any) {
      if (saveIsCurrent()) {
        if (isStaleVersionError(requestError)) {
          setStaleVersionConflict(true);
          setRemoteChangedRows(null);
        } else {
          toast.error(
            campusErrorMessage(requestError, messages.common.campusErrors, gradeEntry.saveFailed),
          );
        }
      }
    } finally {
      if (saveIsCurrent()) setIsSaving(false);
    }
  };

  const handleReloadStaleGrades = () => {
    if (!sectionId || !sectionData || !staleVersionConflict || isRefreshing) return;
    const localRows = Array.from(editedIds)
      .map((enrollmentId) => grades.get(enrollmentId))
      .filter((update): update is GradeUpdate => Boolean(update));
    setRemoteChangedRows(null);
    void fetchSectionGrades({
      silent: true,
      preserveLocalRows: localRows,
      preserveMissingLocalRows: true,
      compareBaseline: sectionData,
    });
  };

  const rebaseLocalGradeVersions = () => {
    if (!sectionData || remoteChangedRows === null) return;
    const latestById = new Map(sectionData.enrollments.map((enrollment) => [enrollment.id, enrollment]));
    setGrades((previous) => {
      const next = new Map(previous);
      editedIds.forEach((enrollmentId) => {
        const update = previous.get(enrollmentId);
        const latest = latestById.get(enrollmentId);
        if (!update || !latest) return;
        const rebased = { ...update };
        if (typeof latest.version === 'number') {
          rebased.version = latest.version;
        } else {
          delete rebased.version;
        }
        next.set(enrollmentId, rebased);
      });
      return next;
    });
    setStaleVersionConflict(false);
    setRemoteChangedRows(null);
  };

  const handlePublish = async () => {
    if (!sectionId || !publishGuard.current.ready) {
      return;
    }
    const publishSectionId = sectionId;
    const publishMutation = ++gradeMutationRef.current;
    const publishIsCurrent = () =>
      publishSectionId === currentSectionRef.current &&
      publishMutation === gradeMutationRef.current;

    const shouldPublish = await confirm({
      title: gradeEntry.publishTitle,
      message: gradeEntry.publishMessage,
      confirmText: gradeEntry.publishGrades,
    });

    if (!publishIsCurrent()) return;
    if (!shouldPublish || !publishGuard.current.ready || publishGuard.current.sectionId !== publishSectionId) {
      return;
    }

    publishGuard.current.ready = false;
    setIsPublishing(true);

    try {
      await sectionsApi.publishSectionGrades(publishSectionId);
      if (!publishIsCurrent()) return;
      toast.success(gradeEntry.published);
      await fetchSectionGrades();
    } catch (requestError: any) {
      if (publishIsCurrent()) {
        toast.error(
          campusErrorMessage(requestError, messages.common.campusErrors, gradeEntry.publishFailed),
        );
      }
    } finally {
      if (publishIsCurrent()) setIsPublishing(false);
    }
  };

  const gradeSummary = useMemo(() => {
    if (!sectionData) {
      return {
        totalStudents: 0,
        gradedCount: 0,
        ungradedCount: 0,
        passedCount: 0,
        failedCount: 0,
        passRate: 0,
        averageScore: null,
        counts: { 'A+': 0, A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 0 },
      };
    }
    const studentList = sectionData.enrollments.map((enrollment) => {
      const update = grades.get(enrollment.id);
      const proc = update?.processScore ?? enrollment.processScore ?? null;
      const final = update?.finalExamScore ?? enrollment.finalExamScore ?? null;
      const total = totalScore({ enrollmentId: enrollment.id, processScore: proc, finalExamScore: final });
      return {
        studentId: enrollment.id,
        studentCode: enrollment.studentCode,
        studentName: enrollment.studentName,
        processScore: proc,
        finalExamScore: final,
        totalScore: total,
        letterGrade: total !== null ? calculateGrade(total) : null,
      };
    });
    return computeGradeSummary(studentList);
  }, [grades, sectionData]);

  const handleExportCsv = () => {
    if (!sectionData) {
      return;
    }

    const exportStudents = sectionData.enrollments.map((enrollment) => {
      const update = grades.get(enrollment.id);
      const proc = update?.processScore ?? enrollment.processScore ?? null;
      const final = update?.finalExamScore ?? enrollment.finalExamScore ?? null;
      const total = totalScore({ enrollmentId: enrollment.id, processScore: proc, finalExamScore: final });
      return {
        studentId: enrollment.id,
        studentCode: enrollment.studentCode,
        studentName: formatVietnameseName(enrollment.studentName),
        email: enrollment.email,
        processScore: proc,
        finalExamScore: final,
        totalScore: total,
        letterGrade: total !== null ? calculateGrade(total) : null,
        gradeStatus: enrollment.gradeStatus,
      };
    });

    const filename = `Bang_diem_${sectionData.courseCode}_Lop_${sectionData.sectionNumber}_${campusTodayIso()}.csv`;
    const csvContent = generateGradeCsv({
      sectionNumber: sectionData.sectionNumber,
      courseCode: sectionData.courseCode,
      courseName: localizedCourseName,
      semesterName: semesterDisplayName,
      lecturerName: lecturerDisplayName,
      students: exportStudents,
      locale: locale as 'vi' | 'en',
    });

    downloadCsvFile(filename, csvContent);
    toast.success(gradeEntry.exportCsvSuccess);
  };

  const handlePrintRoster = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  if (authLoading) {
    return <LoadingState label={gradeEntry.loading} />;
  }

  if (!hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={<SectionEyebrow>{gradeEntry.eyebrow}</SectionEyebrow>}
          title={gradeEntry.title}
          description={gradeEntry.errorDescription}
          actions={
            <LinkButton
              href="/dashboard/lecturer/grades"
              variant="outline"
              aria-label={gradeEntry.backToGrades}
              title={gradeEntry.backToGrades}
            >
              {gradeEntry.backToGrades}
            </LinkButton>
          }
        />
        <ErrorState
          title={gradeEntry.unavailableTitle}
          description={error}
          onRetry={() => void fetchSectionGrades()}
        />
      </div>
    );
  }

  if (isLoading || !sectionData) {
    return <LoadingState label={gradeEntry.loading} />;
  }

  const today = new Date();
  const printDate = gradeEntry.print.dateTemplate
    .replace('{day}', formatDate(today, { year: undefined, month: undefined, day: 'numeric' }))
    .replace('{month}', formatDate(today, {
      year: undefined,
      day: undefined,
      month: locale === 'vi' ? 'numeric' : 'long',
    }))
    .replace('{year}', formatDate(today, { month: undefined, day: undefined, year: 'numeric' }));

  return (
    <div className="space-y-8">
      <div className="print:hidden">
        <PageHeader
          eyebrow={<SectionEyebrow>{gradeEntry.eyebrow}</SectionEyebrow>}
          title={`${sectionData.courseCode} · ${gradeEntry.sectionPrefix} ${sectionData.sectionNumber}`}
          description={gradeEntry.pageDescription.replace('{courseName}', () => localizedCourseName)}
          actions={
            <div className="flex flex-wrap gap-3">
              <LinkButton
                href="/dashboard/lecturer/grades"
                variant="outline"
                aria-label={gradeEntry.backToGrades}
                title={gradeEntry.backToGrades}
                onClick={(event) => {
                  if (!hasChanges) return;
                  event.preventDefault();
                  requestLeave(() => router.push(href('/dashboard/lecturer/grades')));
                }}
              >
                {gradeEntry.backToGrades}
              </LinkButton>
              <Button
                type="button"
                variant="outline"
                onClick={handleExportCsv}
                disabled={!sectionData || sectionData.enrollments.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                {gradeEntry.exportCsv}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handlePrintRoster}
                disabled={!sectionData || sectionData.enrollments.length === 0}
              >
                <Printer className="mr-2 h-4 w-4" />
                {gradeEntry.print.roster}
              </Button>
              <Button
                type="button"
                variant={hasChanges ? 'default' : 'outline'}
                disabled={!hasChanges || isSaving || isPublishing || isRefreshing || staleVersionConflict}
                onClick={() => void handleSave()}
              >
                <Save className="mr-2 h-4 w-4" />
                {isSaving
                  ? gradeEntry.savingGrades
                  : hasChanges
                    ? `${gradeEntry.saveGrades} (${formatNumber(editedIds.size)})`
                    : gradeEntry.saveGrades}
              </Button>
              <Button
                type="button"
                variant={hasChanges ? 'outline' : 'default'}
                disabled={!publishReady}
                onClick={() => void handlePublish()}
              >
                <Send className="mr-2 h-4 w-4" />
                {isPublishing ? gradeEntry.publishingGrades : gradeEntry.publishGrades}
              </Button>
            </div>
          }
        />
        {staleVersionConflict ? (
          <div role="alert" className="mt-3 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-foreground">
            <p>{gradeEntry.staleVersionMessage}</p>
            {remoteChangedRows !== null ? (
              remoteChangedRows.length > 0 ? (
                <p className="mt-2 break-words text-muted-foreground">
                  {gradeEntry.remoteChangedRows.replace('{rows}', remoteChangedRows.join(', '))}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground">{gradeEntry.noRemoteChangedRows}</p>
              )
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isRefreshing}
                onClick={handleReloadStaleGrades}
              >
                {isRefreshing ? gradeEntry.loading : gradeEntry.reloadStaleGrades}
              </Button>
              {remoteChangedRows !== null ? (
                <Button type="button" disabled={isRefreshing} onClick={rebaseLocalGradeVersions}>
                  {gradeEntry.keepEditsOnLatestVersions}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {hasChanges && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">{gradeEntry.saveBeforePublish}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3 print:hidden">
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">{gradeEntry.students}</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {formatNumber(sectionData.enrollments.length)}
              </div>
            </div>
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('info')}`}>
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">{gradeEntry.gradedRecords}</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {formatNumber(
                  sectionData.enrollments.filter((enrollment) => enrollment.letterGrade).length,
                )}
              </div>
            </div>
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('success')}`}>
              <CheckCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">{gradeEntry.sectionStatus}</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {statusLabel(sectionData.status)}
              </div>
            </div>
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('neutral')}`}>
              <FileText className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {!allGraded ? (
        <Card variant="muted" className="print:hidden">
          <CardContent className="pt-6 text-sm leading-6 text-muted-foreground">
            {gradeEntry.publishWarning}
          </CardContent>
        </Card>
      ) : null}

      {sectionData.enrollments.length === 0 ? (
        <EmptyState
          icon={Users}
          title={gradeEntry.emptyTitle}
          description={gradeEntry.emptyDescription}
        />
      ) : (
        <Card variant="muted" className="print:border-none print:shadow-none print:bg-transparent">
          <CardHeader className="print:hidden">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-xl">{gradeEntry.tableTitle}</CardTitle>
              {isSaving ? null : (
                <GradeImportPanel
                  students={sectionData.enrollments.map((enrollment) => ({
                    enrollmentId: enrollment.id,
                    studentCode: enrollment.studentCode,
                    email: enrollment.email,
                  }))}
                  disabled={isSaving || isPublishing || isRefreshing || sectionData.enrollments.some((enrollment) => enrollment.gradeStatus === 'PUBLISHED')}
                  onApply={applyImportedRows}
                />
              )}
            </div>
          </CardHeader>
          <CardContent className="print:p-0">
            {/* Printable Official Institutional Header - Visible ONLY when printing */}
            <div className="hidden print:block mb-6 border-b-2 border-primary/40 pb-4 text-center">
              <div className="text-xs uppercase font-bold tracking-wider text-muted-foreground">
                {gradeEntry.print.officialHeader}
              </div>
              <div className="text-sm font-extrabold uppercase tracking-wide text-foreground">
                {printDepartmentName}
              </div>
              <h1 className="text-xl font-black text-primary mt-2 uppercase tracking-wide">
                {gradeEntry.print.reportTitle}
              </h1>
              <div className="flex flex-wrap justify-center gap-6 mt-3 text-xs text-foreground font-medium">
                <span><strong>{gradeEntry.print.sectionLabel}</strong> {sectionData.sectionNumber}</span>
                <span><strong>{gradeEntry.print.courseLabel}</strong> {localizedCourseName} ({sectionData.courseCode})</span>
                <span><strong>{gradeEntry.print.semesterLabel}</strong> {semesterDisplayName}</span>
                <span><strong>{gradeEntry.print.lecturerLabel}</strong> {lecturerDisplayName}</span>
                <span><strong>{gradeEntry.students}:</strong> {sectionData.enrollments.length}</span>
                <span><strong>{gradeEntry.print.passRate}:</strong> {gradeSummary.passRate.toFixed(1)}%</span>
                <span><strong>{gradeEntry.print.averageScore}:</strong> {gradeSummary.averageScore !== null ? gradeSummary.averageScore.toFixed(2) : '—'}</span>
              </div>
            </div>

            <div
              className="space-y-3 md:hidden print:hidden"
              role="list"
              aria-label={gradeEntry.tableTitle}
            >
              {sectionData.enrollments.map((enrollment) => {
                const current = grades.get(enrollment.id) ?? {
                  enrollmentId: enrollment.id,
                  processScore: enrollment.processScore ?? null,
                  finalExamScore: enrollment.finalExamScore ?? null,
                };
                const isPublished = enrollment.gradeStatus === 'PUBLISHED';

                return (
                  <article
                    key={`${enrollment.id}-mobile`}
                    className="rounded-lg border border-border/80 bg-card p-5 shadow-xs transition hover:border-primary/40"
                    role="listitem"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-foreground">
                          {formatVietnameseName(enrollment.studentName)}
                        </h3>
                        <p className="mt-1 break-words text-sm text-muted-foreground">
                          {enrollment.studentCode}
                        </p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">
                          {enrollment.email ?? gradeEntry.unavailableEmail}
                        </p>
                        {editedIds.has(enrollment.id) && (
                          <span className="mt-2 inline-flex rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs font-medium text-foreground print:hidden">
                            {gradeEntry.unsavedStatus}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                        {isPublished
                          ? gradeEntry.publishedStatus
                          : statusLabel(enrollment.gradeStatus ?? 'DRAFT')}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 border-t border-border/60 pt-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {gradeEntry.headers.processScore}
                        </span>
                        <Input
                          type="number"
                          min="0"
                          max="10"
                          step="0.1"
                          data-cell={`grade-${enrollment.id}:processScore`}
                          value={current.processScore ?? ''}
                          onChange={(event) =>
                            handleScoreChange(enrollment.id, 'processScore', event.target.value, event.target.validity.badInput)
                          }
                          error={scoreErrors.get(`${enrollment.id}:processScore`)}
                          disabled={isPublished || isSaving || isPublishing || isRefreshing}
                          aria-label={gradeEntry.processScoreLabel.replace('{studentName}', () => formatVietnameseName(enrollment.studentName))}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {gradeEntry.headers.finalExamScore}
                        </span>
                        <Input type="number" min="0" max="10" step="0.1"
                          data-cell={`grade-${enrollment.id}:finalExamScore`}
                          value={current.finalExamScore ?? ''}
                          onChange={(event) =>
                            handleScoreChange(enrollment.id, 'finalExamScore', event.target.value, event.target.validity.badInput)
                          }
                          error={scoreErrors.get(`${enrollment.id}:finalExamScore`)}
                          disabled={isPublished || isSaving || isPublishing || isRefreshing}
                          aria-label={gradeEntry.finalExamScoreLabel.replace('{studentName}', () => formatVietnameseName(enrollment.studentName))} />
                      </label>
                    </div>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {gradeEntry.headers.total}: {totalScore(current) ?? '—'} · {gradeEntry.headers.letter}: {totalScore(current) === null ? '—' : calculateGrade(totalScore(current)!)}
                    </p>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block print:block">
              <table className="w-full min-w-[880px] table-fixed text-sm print:min-w-0">
                <thead>
                  <tr className="border-b border-border/70 text-left text-muted-foreground print:text-foreground">
                    <th className="w-[6%] px-2 py-3.5 text-center font-medium hidden print:table-cell">{gradeEntry.headers.number}</th>
                    <th className="w-[21%] px-3 py-3.5 font-medium print:w-[26%]">{gradeEntry.headers.student}</th>
                    <th className="w-[13%] px-3 py-3.5 font-medium print:w-[16%]">{gradeEntry.headers.studentId}</th>
                    <th className="w-[13%] px-3 py-3.5 text-center font-medium print:w-[14%]">{gradeEntry.headers.processScore}</th>
                    <th className="w-[13%] px-3 py-3.5 text-center font-medium print:w-[14%]">{gradeEntry.headers.finalExamScore}</th>
                    <th className="w-[12%] px-3 py-3.5 text-center font-medium print:w-[15%]">{gradeEntry.headers.total}</th>
                    <th className="w-[10%] px-3 py-3.5 text-center font-medium print:w-[15%]">{gradeEntry.headers.letter}</th>
                    <th className="w-[18%] px-3 py-3.5 text-right font-medium print:hidden">{gradeEntry.headers.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sectionData.enrollments.map((enrollment, enrollmentIndex) => {
                    const current = grades.get(enrollment.id) ?? {
                      enrollmentId: enrollment.id,
                      processScore: enrollment.processScore ?? null,
                      finalExamScore: enrollment.finalExamScore ?? null,
                    };
                    const isPublished = enrollment.gradeStatus === 'PUBLISHED';
                    const isDirtyRow = editedIds.has(enrollment.id);

                    return (
                      <tr
                        key={enrollment.id}
                        className={
                          isDirtyRow
                            ? 'border-l-2 border-l-portal-chrome-accent bg-status-warning/5 transition-colors hover:bg-muted/40 print:border-l-0 print:bg-transparent'
                            : 'transition-colors hover:bg-muted/40'
                        }
                      >
                        <td className="px-2 py-3 text-center hidden print:table-cell font-mono text-xs">
                          {enrollmentIndex + 1}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="font-medium text-foreground">
                            {formatVietnameseName(enrollment.studentName)}
                          </div>
                          {isDirtyRow && (
                            <span className="mt-2 inline-flex rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs font-medium text-foreground print:hidden">
                              {gradeEntry.unsavedStatus}
                            </span>
                          )}
                          <div className="mt-1 truncate text-xs text-muted-foreground print:hidden" title={enrollment.email ?? gradeEntry.unavailableEmail}>
                            {enrollment.email ?? gradeEntry.unavailableEmail}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-muted-foreground print:text-foreground font-mono">
                          {enrollment.studentCode}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="hidden print:inline-block font-semibold text-foreground">
                            {current.processScore !== null ? current.processScore.toFixed(1) : '—'}
                          </span>
                          <div className="mx-auto max-w-[96px] print:hidden">
                            <Input
                              type="number"
                              min="0"
                              max="10"
                              step="0.1"
                              data-cell={`grade-${enrollment.id}:processScore`}
                              value={current.processScore ?? ''}
                              onChange={(event) =>
                                handleScoreChange(enrollment.id, 'processScore', event.target.value, event.target.validity.badInput)
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, enrollmentIndex, 'processScore')}
                              error={scoreErrors.get(`${enrollment.id}:processScore`)}
                              disabled={isPublished || isSaving || isPublishing || isRefreshing}
                              aria-label={gradeEntry.processScoreLabel.replace('{studentName}', () => formatVietnameseName(enrollment.studentName))}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="hidden print:inline-block font-semibold text-foreground">
                            {current.finalExamScore !== null ? current.finalExamScore.toFixed(1) : '—'}
                          </span>
                          <div className="mx-auto max-w-[96px] print:hidden">
                            <Input type="number" min="0" max="10" step="0.1"
                              data-cell={`grade-${enrollment.id}:finalExamScore`}
                              value={current.finalExamScore ?? ''}
                              onChange={(event) =>
                                handleScoreChange(enrollment.id, 'finalExamScore', event.target.value, event.target.validity.badInput)
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, enrollmentIndex, 'finalExamScore')}
                              error={scoreErrors.get(`${enrollment.id}:finalExamScore`)}
                              disabled={isPublished || isSaving || isPublishing || isRefreshing}
                          aria-label={gradeEntry.finalExamScoreLabel.replace('{studentName}', () => formatVietnameseName(enrollment.studentName))} />
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center font-semibold text-foreground">
                          {totalScore(current) ?? '—'}
                        </td>
                        <td className="px-3 py-3.5 text-center font-semibold text-foreground">
                          {totalScore(current) === null ? '—' : calculateGrade(totalScore(current)!)}
                        </td>
                        <td className="px-3 py-3.5 text-right print:hidden">
                          <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {isPublished
                              ? gradeEntry.publishedStatus
                              : statusLabel(enrollment.gradeStatus ?? 'DRAFT')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Official Signature Block - Visible ONLY when printing */}
            <div className="hidden print:grid grid-cols-2 mt-14 text-center">
              <div className="space-y-16">
                <p className="text-xs text-muted-foreground italic">
                  &nbsp;
                </p>
                <div className="space-y-1">
                  <p className="text-sm font-bold uppercase text-foreground">{gradeEntry.print.departmentHeadSignature}</p>
                  <p className="text-xs text-muted-foreground italic">
                    {gradeEntry.print.signatureNotice}
                  </p>
                </div>
              </div>
              <div className="space-y-16">
                <p className="text-xs text-muted-foreground italic">
                  {printDate}
                </p>
                <div className="space-y-1">
                  <p className="text-sm font-bold uppercase text-foreground">{gradeEntry.print.instructorSignature}</p>
                  <p className="text-xs text-muted-foreground italic">
                    {gradeEntry.print.signatureNotice}
                  </p>
                  {lecturerDisplayName && (
                    <p className="pt-10 text-sm font-semibold text-foreground">{lecturerDisplayName}</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {confirmationDialog}
      <UnsavedChangesConfirmDialog
        open={unsaved.confirmOpen}
        title={gradeEntry.unsavedTitle}
        description={gradeEntry.unsavedBody}
        confirmLabel={gradeEntry.confirm.continue}
        cancelLabel={gradeEntry.confirm.keepEditing}
        onConfirm={unsaved.confirmLeave}
        onCancel={unsaved.cancelLeave}
      />
    </div>
  );
}
