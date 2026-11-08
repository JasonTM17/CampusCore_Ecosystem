import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Button, Card, Notice, ProgressBar, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { Dialog, SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import { campusIsoDate, countForm } from '../../i18n/locale';
import type { MobileScreenProps } from '../../navigation/types';
import { useStableCallback } from '../../hooks/use-stable-callback';
import { GradeRowCard } from './GradeRowCard';
import { lecturerApi, type SectionGradeSheet } from './lecturer-api';
import { calculateGrade, calculateTotalScore, generateGradeCsv, gradeCsvFilename } from './lecturer-csv';
import {
  buildGradeDraft,
  changedGradeRows,
  courseTitle,
  dirtyGradeCount,
  gradedPercent,
  mergeGradeEdits,
  normalizeOperationsSearch,
  sameGradeSheet,
  windowOf,
  type GradeDraft,
  type ScoreEdit,
} from './lecturer-model';
import { CsvExport, HandoffButton, OpsShell, SectionPicker, isOpsPreview, useOpsQuery } from './lecturer-ui';
import { opsErrorMessage, useOpsCopy } from './shared/helpers';
import { previewGrades, previewGrading } from './shared/preview';
import { useOpsStyles } from './shared/styles';

const PAGE_SIZE = 30;
const NO_PROBLEMS: GradeDraft['problems'] = {};
const NO_CHANGED_ROWS: ReadonlySet<string> = new Set();

type Banner = { tone: 'success' | 'error' | 'warning'; message: string } | null;

export function LecturerGradingScreen(_props: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const preview = isOpsPreview();
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const sectionsQuery = useOpsQuery('lecturer:grading', () => lecturerApi.gradingSections(), copy);
  const sections = useMemo(() => (preview ? previewGrading : sectionsQuery.data ?? []), [preview, sectionsQuery.data]);

  const [picked, setPicked] = useState(typeof params.sectionId === 'string' ? params.sectionId : '');
  const sectionId = sections.some((section) => section.sectionId === picked) ? picked : sections[0]?.sectionId ?? '';
  const currentSectionId = useRef(sectionId);
  currentSectionId.current = sectionId;
  const section = sections.find((item) => item.sectionId === sectionId);

  const gradesQuery = useOpsQuery(`lecturer:grades:${sectionId}`, () => lecturerApi.sectionGrades(sectionId), copy, Boolean(sectionId));
  const sheet: SectionGradeSheet | undefined = useMemo(() => {
    if (preview) return { sectionId, rows: previewGrades };
    const data = gradesQuery.data;
    return data && data.sectionId === sectionId ? data : undefined;
  }, [preview, gradesQuery.data, sectionId]);

  const [baselineSheet, setBaselineSheet] = useState<SectionGradeSheet>();
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [staleVersion, setStaleVersion] = useState(false);
  const [changedRows, setChangedRows] = useState<ReadonlySet<string>>(NO_CHANGED_ROWS);
  const [edits, setEdits] = useState<Record<string, ScoreEdit>>({});
  const [problems, setProblems] = useState<GradeDraft['problems']>(NO_PROBLEMS);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Banner>(null);
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const editRevisionBySection = useRef<Record<string, number>>({});
  const writeFlights = useRef(new Set<string>());
  // Only a fetch that actually lands a new sheet may consume a conflict reload.
  const presentedSheet = useRef<SectionGradeSheet | undefined>(undefined);
  // The stale baseline to compare against after the explicit reload returns.
  const pendingReload = useRef<{ sectionId: string; rows: SectionGradeSheet['rows'] } | null>(null);
  // A dirty section keeps its own draft while the lecturer checks another one.
  const draftsRef = useRef<Record<string, {
    baselineSheet: SectionGradeSheet;
    edits: Record<string, ScoreEdit>;
    problems: GradeDraft['problems'];
    remoteChanged: boolean;
  }>>({});

  const rows = useMemo(
    () => baselineSheet?.sectionId === sectionId ? baselineSheet.rows : sheet?.rows ?? [],
    [baselineSheet, sectionId, sheet],
  );

  useEffect(() => {
    if (!sheet) return;
    const landed = sheet !== presentedSheet.current;
    presentedSheet.current = sheet;
    if (!baselineSheet || baselineSheet.sectionId !== sheet.sectionId) {
      setBaselineSheet(sheet);
      setRemoteChanged(false);
      setChangedRows(NO_CHANGED_ROWS);
      return;
    }
    const reload = pendingReload.current;
    if (landed && reload && reload.sectionId === sheet.sectionId) {
      // The explicit reload after a version conflict: adopt the fresh
      // baseline, keep every local edit and flag the rows that moved. The
      // new versions are only used by a later, deliberate save.
      pendingReload.current = null;
      setBaselineSheet(sheet);
      setChangedRows(new Set(changedGradeRows(reload.rows, sheet.rows)));
      setRemoteChanged(false);
      setStaleVersion(false);
      setMessage(null);
      return;
    }
    if (sameGradeSheet(baselineSheet, sheet)) {
      if (remoteChanged) setRemoteChanged(false);
      return;
    }
    if (dirtyGradeCount(baselineSheet.rows, edits) === 0) {
      setBaselineSheet(sheet);
      setRemoteChanged(false);
    } else {
      setRemoteChanged(true);
    }
  }, [baselineSheet, edits, remoteChanged, sheet]);

  useEffect(() => {
    const draft = draftsRef.current[sectionId];
    if (draft) {
      setBaselineSheet(draft.baselineSheet);
      setEdits(draft.edits);
      setProblems(draft.problems);
      setRemoteChanged(draft.remoteChanged);
    } else {
      setEdits({});
      setProblems(NO_PROBLEMS);
      setRemoteChanged(false);
    }
    pendingReload.current = null;
    setStaleVersion(false);
    setChangedRows(NO_CHANGED_ROWS);
    setMessage(null);
    setSearch('');
    setPages(1);
    setBusy(null);
  }, [sectionId]);

  const dirty = dirtyGradeCount(rows, edits);

  const switchSection = (next: string) => {
    if (next === sectionId) return;
    if (baselineSheet && dirtyGradeCount(baselineSheet.rows, edits) > 0) {
      draftsRef.current[sectionId] = { baselineSheet, edits, problems, remoteChanged };
    } else {
      delete draftsRef.current[sectionId];
    }
    setPicked(next);
  };
  const locked = rows.length > 0 && rows.every((row) => row.gradeStatus === 'PUBLISHED' || row.gradeStatus === 'APPEALED');
  const needle = normalizeOperationsSearch(search.trim());
  const visible = needle
    ? rows.filter((row) => normalizeOperationsSearch(`${row.studentName ?? ''} ${row.studentCode ?? ''}`).includes(needle))
    : rows;
  const { rows: shown, hasMore } = windowOf(visible, pages, PAGE_SIZE);

  const enrolled = section?.enrolledCount ?? rows.length;
  const graded = section?.gradedCount ?? rows.filter((row) => row.finalGrade != null).length;
  const status = section?.gradeStatus === 'PUBLISHED' || locked ? 'PUBLISHED' : 'DRAFT';

  const edit = useStableCallback((enrollmentId: string, field: 'processScore' | 'finalExamScore', text: string) => {
    const activeSectionId = currentSectionId.current;
    editRevisionBySection.current[activeSectionId] = (editRevisionBySection.current[activeSectionId] ?? 0) + 1;
    setEdits((current) => ({ ...current, [enrollmentId]: { ...current[enrollmentId], [field]: text } }));
    setMessage(null);
    if (problems[enrollmentId]) {
      setProblems((current) => {
        const { [enrollmentId]: _removed, ...rest } = current;
        return rest;
      });
    }
  });

  const reload = () => { void sectionsQuery.reload(); void gradesQuery.reload(); };
  // The spinner belongs to the lecturer's pull, not to every SWR revalidation.
  const refreshAll = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all([sectionsQuery.reload(), gradesQuery.reload()]).finally(() => setRefreshing(false));
  };
  const reloadGrades = () => {
    delete draftsRef.current[sectionId];
    if (sheet) setBaselineSheet(sheet);
    setEdits({});
    setProblems(NO_PROBLEMS);
    setRemoteChanged(false);
    setStaleVersion(false);
    setChangedRows(NO_CHANGED_ROWS);
    pendingReload.current = null;
    void gradesQuery.reload();
  };

  /**
   * The explicit reload after 409 STALE_VERSION: refetch, keep every local
   * edit, and let the arriving sheet flag the rows that changed. Nothing is
   * retried and no refetched version is attached to the old draft on its own.
   */
  const reloadAfterConflict = () => {
    if (baselineSheet?.sectionId === sectionId) {
      pendingReload.current = { sectionId, rows: baselineSheet.rows };
      void gradesQuery.reload();
      return;
    }
    setStaleVersion(false);
    void gradesQuery.reload();
  };

  const saveScores = async () => {
    const savingSectionId = sectionId;
    const savingRevision = editRevisionBySection.current[savingSectionId] ?? 0;
    const draft = buildGradeDraft(rows, edits);
    if (Object.keys(draft.problems).length > 0) {
      setProblems(draft.problems);
      setMessage({ tone: 'error', message: copy.scoresInvalid });
      return;
    }
    if (draft.changes.length === 0) {
      setMessage({ tone: 'warning', message: copy.nothingChanged });
      return;
    }
    if (writeFlights.current.has(savingSectionId)) return;
    writeFlights.current.add(savingSectionId);
    setBusy('save');
    setMessage(null);
    try {
      await lecturerApi.saveGrades(savingSectionId, draft.changes);
      const unchanged = (editRevisionBySection.current[savingSectionId] ?? 0) === savingRevision;
      if (unchanged) delete draftsRef.current[savingSectionId];
      if (currentSectionId.current !== savingSectionId) return;
      if (unchanged) {
        setEdits({});
        setProblems(NO_PROBLEMS);
      }
      setStaleVersion(false);
      setChangedRows(NO_CHANGED_ROWS);
      setMessage({ tone: 'success', message: fillCopy(countForm(draft.changes.length, copy.scoresSavedOne, copy.scoresSaved), { n: draft.changes.length }) });
      reload();
    } catch (error) {
      if (currentSectionId.current !== savingSectionId) return;
      const conflict = error as { status?: number; code?: string } | null;
      if (conflict?.status === 409 && conflict.code === 'STALE_VERSION') {
        // Keep the whole draft; the button stays disabled until an explicit reload.
        setStaleVersion(true);
        setMessage(null);
        return;
      }
      setMessage({ tone: 'error', message: opsErrorMessage(copy, error, copy.saveScoresFailed) });
      if (conflict?.status === 409) reload();
    } finally {
      writeFlights.current.delete(savingSectionId);
      if (currentSectionId.current === savingSectionId) setBusy(null);
    }
  };

  const publish = async () => {
    const savingSectionId = sectionId;
    if (writeFlights.current.has(savingSectionId)) return;
    writeFlights.current.add(savingSectionId);
    setConfirming(false);
    setBusy('publish');
    setMessage(null);
    try {
      await lecturerApi.publishGrades(savingSectionId);
      if (currentSectionId.current !== savingSectionId) return;
      setMessage({ tone: 'success', message: copy.publishedOk });
      // The section still reads DRAFT until both reads land; the publish lock
      // covers them so the button cannot offer a second, already-published POST.
      await Promise.all([sectionsQuery.reload(), gradesQuery.reload()]);
    } catch (error) {
      if (currentSectionId.current !== savingSectionId) return;
      setMessage({ tone: 'error', message: opsErrorMessage(copy, error, copy.publishFailed) });
      if ((error as { status?: number } | null)?.status === 409) reload();
    } finally {
      writeFlights.current.delete(savingSectionId);
      if (currentSectionId.current === savingSectionId) setBusy(null);
    }
  };

  const buildCsv = () =>
    generateGradeCsv({
      sectionNumber: section?.sectionNumber ?? sectionId,
      courseCode: section?.courseCode,
      courseName: section ? courseTitle(section, locale) : undefined,
      students: mergeGradeEdits(rows, edits).map((row) => {
        const processScore = row.processScore ?? null;
        const finalExamScore = row.finalExamScore ?? null;
        const total = calculateTotalScore(processScore, finalExamScore);
        return {
          studentId: row.studentId ?? row.enrollmentId,
          studentCode: row.studentCode ?? '',
          studentName: row.studentName ?? '',
          processScore,
          finalExamScore,
          letterGrade: total !== null ? calculateGrade(total) : null,
          gradeStatus: row.gradeStatus ?? null,
        };
      }),
      locale,
    });

  const queryError = preview ? null : sectionsQuery.error ?? gradesQuery.error;
  const loading = !preview && (sectionsQuery.isLoading || (Boolean(sectionId) && !sheet && !queryError));
  const canPublish = !preview && Boolean(section?.canPublish) && dirty === 0 && busy === null;
  const publishHint = dirty > 0 ? copy.publishUnsavedFirst : section && !section.canPublish && status !== 'PUBLISHED' ? copy.publishBlocked : null;

  return (
    <OpsShell
      title={copy.gradingTitle}
      eyebrow={section ? `${section.courseCode ?? ''}` : undefined}
      subtitle={section ? courseTitle(section, locale) : undefined}
      loading={loading}
      error={queryError}
      warning={preview ? null : sectionsQuery.warning ?? gradesQuery.warning}
      onRetry={reload}
      onRefresh={preview ? undefined : refreshAll}
      refreshing={!preview && refreshing}

      list={{ data: shown, keyExtractor: (item, index) => String(item.enrollmentId),
        renderItem: ({ item: row }) => (
                <GradeRowCard
                  key={row.enrollmentId}
                  row={row}
                  edit={edits[row.enrollmentId]}
                  problems={problems[row.enrollmentId]}
                  changed={changedRows.has(row.enrollmentId)}
                  copy={copy}
                  onEdit={edit}
                  disabled={busy !== null}
                />
              ),
        footer: <>{sections.length === 0 ? null : (<View>{rows.length === 0 ? null : (<View>
              {hasMore ? <Button label={copy.loadMore} variant="secondary" onPress={() => setPages((current) => current + 1)} /> : null}

              <View style={styles.saveBar}>
                {message ? <Notice tone={message.tone} message={message.message} /> : null}
                {staleVersion ? (
                  <Notice
                    tone="error"
                    message={copy.gradesVersionStale}
                    actionLabel={busy ? undefined : copy.reload}
                    onAction={busy ? undefined : reloadAfterConflict}
                  />
                ) : null}
                {dirty > 0 ? (
                  <UiText variant="bodySmall" tone="muted">
                    {fillCopy(countForm(dirty, copy.changesCountOne, copy.changesCount), { n: dirty })}
                  </UiText>
                ) : null}
                {remoteChanged && !staleVersion ? (
                  <Notice
                    tone="warning"
                    message={copy.gradesStale}
                    actionLabel={busy ? undefined : copy.reload}
                    onAction={busy ? undefined : reloadGrades}
                  />
                ) : null}
                <Button
                  icon="content-save-outline"
                  label={copy.saveScores}
                  loading={busy === 'save'}
                  disabled={preview || dirty === 0 || busy !== null || remoteChanged || staleVersion}
                  onPress={() => void saveScores()}
                />
                <Button
                  icon="cloud-upload-outline"
                  label={copy.publishGrades}
                  variant="secondary"
                  loading={busy === 'publish'}
                  disabled={!canPublish || status === 'PUBLISHED'}
                  onPress={() => setConfirming(true)}
                />
                {publishHint ? <UiText variant="bodySmall" tone="muted">{publishHint}</UiText> : null}
                <CsvExport
                  name={gradeCsvFilename(section?.courseCode ?? 'section', section?.sectionNumber ?? sectionId, campusIsoDate())}
                  build={buildCsv}
                  rows={rows.length}
                />
                <UiText variant="bodySmall" tone="muted">{copy.importPrintWeb}</UiText>
                <HandoffButton label={copy.openOnWeb} path={`/dashboard/lecturer/grades/${encodeURIComponent(sectionId)}`} />
              </View>
            </View>)}
        </View>)}
      <Dialog
        visible={confirming}
        title={copy.publishTitle}
        description={fillCopy(countForm(enrolled, copy.publishBodyOne, copy.publishBody), { n: section?.sectionNumber ?? '', count: enrolled })}
        confirmLabel={copy.publishConfirm}
        cancelLabel={copy.publishCancel}
        onConfirm={() => void publish()}
        onCancel={() => setConfirming(false)}
      />
    </>,
      }}
    >
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptySchedule} />
      ) : (<View>
          <SectionPicker sections={sections} value={sectionId} onChange={switchSection} />
          <Card style={styles.gradingHero}>
            <View style={styles.courseHeader}>
              <View style={styles.topicCopy}>
                <UiText variant="bodySmall" tone="muted">{copy.pendingScores}</UiText>
                <UiText variant="display" tone="primary">{Math.max(enrolled - graded, 0)}</UiText>
              </View>
              <StatusPill
                label={status === 'PUBLISHED' ? copy.published : copy.draft}
                tone={status === 'PUBLISHED' ? 'success' : 'warning'}
                icon={status === 'PUBLISHED' ? 'check-decagram' : 'file-document-edit-outline'}
              />
            </View>
            <ProgressBar label={copy.gradedProgress} value={gradedPercent(graded, enrolled)} />
          </Card>
          {rows.length === 0 ? (
            <StatePanel kind="empty" title={copy.rosterEmpty} />
          ) : (<View>
              <SearchBar
                value={search}
                onChangeText={(value) => { setSearch(value); setPages(1); }}
                placeholder={copy.searchStudents}
                accessibilityLabel={copy.searchStudents}
                style={styles.searchBar}
              />
              {visible.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
              </View>)}</View>)}</OpsShell>
  );
}
