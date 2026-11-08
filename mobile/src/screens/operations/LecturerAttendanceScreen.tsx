import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Button, Notice, StatePanel, StatStrip, UiText } from '../../components/Ui';
import { DateField } from '../../components/ui/date-field';
import { Dialog, SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import { campusIsoDate, countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import { useStableCallback } from '../../hooks/use-stable-callback';
import { AttendanceRosterRow } from './AttendanceRosterRow';
import { StaleAttendanceError, lecturerApi, type AttendanceSheet } from './lecturer-api';
import { attendanceCsvFilename, generateAttendanceCsv } from './lecturer-csv';
import {
  attendanceChangeCount,
  attendanceMetrics,
  baselineOf,
  buildAttendanceRecords,
  buildRosterRows,
  commitRows,
  courseTitle,
  filterRoster,
  isStaleAttendance,
  savedBaseline,
  setAllStatus,
  setRowStatus,
  windowOf,
  type AttendanceBaseline,
  type MarkStatus,
  type RosterRow,
} from './lecturer-model';
import { CsvExport, OpsShell, SectionPicker, isOpsPreview, useOpsQuery } from './lecturer-ui';
import { opsErrorMessage, useOpsCopy } from './shared/helpers';
import { previewRoster, previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

const PAGE_SIZE = 30;
const EMPTY_BASELINE: AttendanceBaseline = { roster: [], marks: {}, notes: {} };

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; count: number } | { kind: 'error'; message: string };

export function LecturerAttendanceScreen(_props: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const { formatNumber } = useLocale();
  const preview = isOpsPreview();
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const sectionsQuery = useOpsQuery('lecturer:schedule', () => lecturerApi.schedule(), copy);
  const sections = useMemo(() => (preview ? previewSchedule : sectionsQuery.data ?? []), [preview, sectionsQuery.data]);

  const [picked, setPicked] = useState(typeof params.sectionId === 'string' ? params.sectionId : '');
  const sectionId = sections.some((section) => section.sectionId === picked) ? picked : sections[0]?.sectionId ?? '';
  const section = sections.find((item) => item.sectionId === sectionId);
  const today = campusIsoDate();
  const [date, setDate] = useState(today);
  const sheetKey = `${sectionId}:${date}`;
  const currentSheetKey = useRef(sheetKey);
  currentSheetKey.current = sheetKey;

  const sheetQuery = useOpsQuery(
    `lecturer:sheet:${sheetKey}`,
    () => lecturerApi.attendanceSheet(sectionId, date),
    copy,
    Boolean(sectionId),
  );

  const sheet: AttendanceSheet | undefined = useMemo(() => {
    if (preview) return { sectionId, date, roster: previewRoster, marks: [] };
    const data = sheetQuery.data;
    return data && data.sectionId === sectionId && data.date === date ? data : undefined;
  }, [preview, sheetQuery.data, sectionId, date]);

  const [rows, setRows] = useState<RosterRow[]>([]);
  const [baseline, setBaseline] = useState<AttendanceBaseline>(EMPTY_BASELINE);
  const [loadedKey, setLoadedKey] = useState('');
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<'markAll' | 'reload' | null>(null);
  const editRevisionByKey = useRef<Record<string, number>>({});
  // A dirty sheet stays keyed to its own (section, date) while the lecturer
  // looks at another one, so switching never silently discards marks.
  const draftsRef = useRef<Record<string, { rows: RosterRow[]; baseline: AttendanceBaseline }>>({});
  const saveFlights = useRef(new Set<string>());

  const applySheet = (next: AttendanceSheet) => {
    delete draftsRef.current[`${next.sectionId}:${next.date}`];
    setRows(buildRosterRows(next.roster, next.marks));
    setBaseline(baselineOf(next.roster, next.marks));
    setLoadedKey(`${next.sectionId}:${next.date}`);
    setRemoteChanged(false);
  };

  useEffect(() => {
    if (!sheet) return;
    if (loadedKey !== sheetKey) {
      const draft = draftsRef.current[sheetKey];
      if (draft) {
        setRows(draft.rows);
        setBaseline(draft.baseline);
        setLoadedKey(sheetKey);
        setRemoteChanged(isStaleAttendance(draft.baseline, sheet.roster, sheet.marks));
        setSave({ kind: 'idle' });
        setPages(1);
        return;
      }
      applySheet(sheet);
      setSave({ kind: 'idle' });
      setPages(1);
      return;
    }
    if (isStaleAttendance(baseline, sheet.roster, sheet.marks)) {
      if (attendanceChangeCount(rows, baseline) === 0) applySheet(sheet);
      else setRemoteChanged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, sheetKey]);

  const changes = useMemo(() => attendanceChangeCount(rows, baseline), [rows, baseline]);
  const metrics = useMemo(() => attendanceMetrics(rows), [rows]);
  const visible = useMemo(() => filterRoster(rows, search), [rows, search]);
  const { rows: shown, hasMore } = windowOf(visible, pages, PAGE_SIZE);
  const ready = loadedKey === sheetKey;
  const busy = save.kind === 'saving';

  const switchSheet = useStableCallback((nextSectionId: string, nextDate: string) => {
    if (nextSectionId === sectionId && nextDate === date) return;
    if (loadedKey === sheetKey) {
      if (changes > 0) draftsRef.current[sheetKey] = { rows, baseline };
      else delete draftsRef.current[sheetKey];
    }
    if (nextSectionId !== sectionId) {
      setPicked(nextSectionId);
      setSearch('');
    }
    if (nextDate !== date) setDate(nextDate);
  });

  const lastRouteSection = useRef(params.sectionId);
  useEffect(() => {
    if (typeof params.sectionId === 'string' && params.sectionId && params.sectionId !== lastRouteSection.current) {
      lastRouteSection.current = params.sectionId;
      switchSheet(params.sectionId, date);
    }
  }, [params.sectionId, date, switchSheet]);

  const change = useStableCallback((studentId: string, status: MarkStatus | null) => {
    const activeSheetKey = currentSheetKey.current;
    editRevisionByKey.current[activeSheetKey] = (editRevisionByKey.current[activeSheetKey] ?? 0) + 1;
    setRows((current) => setRowStatus(current, studentId, status));
    setSave({ kind: 'idle' });
  });

  const applyMarkAll = () => {
    editRevisionByKey.current[sheetKey] = (editRevisionByKey.current[sheetKey] ?? 0) + 1;
    setRows((current) => setAllStatus(current, 'PRESENT', new Set(visible.map((row) => row.studentId))));
    setSave({ kind: 'idle' });
  };

  const markAll = () => {
    if (changes > 0) {
      setPendingDiscard('markAll');
      return;
    }
    applyMarkAll();
  };

  const applyReloadSheet = () => {
    setSave({ kind: 'idle' });
    if (sheet) applySheet(sheet);
    void sheetQuery.reload();
  };

  const reloadSheet = () => {
    if (changes > 0) {
      setPendingDiscard('reload');
      return;
    }
    applyReloadSheet();
  };

  const confirmDiscard = () => {
    const action = pendingDiscard;
    setPendingDiscard(null);
    if (action === 'markAll') applyMarkAll();
    if (action === 'reload') applyReloadSheet();
  };
  // The pull refreshes the two live reads this screen shows: the section list and
  // the active sheet. The spinner tracks exactly those two reloads, so it never
  // spins for a background revalidation the user did not ask for.
  const refreshAll = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all([sectionsQuery.reload(), sheetQuery.reload()]).finally(() => setRefreshing(false));
  };

  const saveAttendance = async () => {
    const records = buildAttendanceRecords(rows);
    if (records.length === 0) {
      setSave({ kind: 'error', message: copy.nothingToSave });
      return;
    }
    const savingKey = sheetKey;
    if (saveFlights.current.has(savingKey)) return;
    saveFlights.current.add(savingKey);
    const savingRevision = editRevisionByKey.current[savingKey] ?? 0;
    setSave({ kind: 'saving' });
    try {
      const count = await lecturerApi.saveAttendance(sectionId, date, records, baseline);
      const unchanged = (editRevisionByKey.current[savingKey] ?? 0) === savingRevision;
      if (unchanged) delete draftsRef.current[savingKey];
      if (currentSheetKey.current !== savingKey) return;
      setSave({ kind: 'saved', count });
      if (unchanged) {
        setRows(commitRows(rows));
        setBaseline(savedBaseline(rows));
        setRemoteChanged(false);
      }
      void sheetQuery.reload();
    } catch (error) {
      if (currentSheetKey.current !== savingKey) return;
      if (error instanceof StaleAttendanceError) {
        setRemoteChanged(true);
        setSave({ kind: 'idle' });
      } else {
        setSave({ kind: 'error', message: opsErrorMessage(copy, error, copy.saveFailed) });
      }
    } finally {
      saveFlights.current.delete(savingKey);
    }
  };

  const buildCsv = () =>
    generateAttendanceCsv({
      sectionNumber: section?.sectionNumber ?? sectionId,
      courseCode: section?.courseCode,
      courseName: section ? courseTitle(section, locale) : undefined,
      date,
      semesterName: section?.semesterName,
      metrics: { total: metrics.total, present: metrics.present, absent: metrics.absent, late: metrics.late, excused: metrics.excused, rate: metrics.rate },
      students: rows.map((row) => ({ studentId: row.studentId, studentCode: row.studentCode, studentName: row.name, status: row.status, notes: row.notes })),
      locale,
    });

  const queryError = preview ? null : sectionsQuery.error ?? sheetQuery.error;
  const loading = !preview && (sectionsQuery.isLoading || (Boolean(sectionId) && !ready && !queryError));

  return (
    <OpsShell
      title={copy.attendanceTitle}
      loading={loading}
      error={queryError}
      warning={preview ? null : sectionsQuery.warning ?? sheetQuery.warning}
      onRetry={() => { void sectionsQuery.reload(); void sheetQuery.reload(); }}
      onRefresh={preview ? undefined : refreshAll}
      refreshing={!preview && refreshing}

      list={{ data: shown, keyExtractor: (item, index) => String(item.studentId),
        renderItem: ({ item: row }) => (
                  <AttendanceRosterRow key={row.studentId} row={row} copy={copy} onChange={change} disabled={busy} />
                ),
        footer: <>{sections.length === 0 ? null : (<View>{rows.length === 0 ? null : (<View><View style={[styles.stack, { marginTop: 12 }]}>
                {hasMore ? <Button label={copy.loadMore} variant="secondary" onPress={() => setPages((current) => current + 1)} /> : null}
              </View>

              <View style={styles.saveBar}>
                {save.kind === 'error' ? <Notice tone="error" message={save.message} /> : null}
                {save.kind === 'saved' ? <Notice tone="success" message={fillCopy(countForm(save.count, copy.savedOne, copy.saved), { n: formatNumber(save.count) })} /> : null}
                {changes > 0 ? (
                  <UiText variant="bodySmall" tone="muted">
                    {fillCopy(countForm(changes, copy.unsavedOne, copy.unsaved), { n: formatNumber(changes) })}
                  </UiText>
                ) : null}
                <Button
                  icon="content-save-outline"
                  label={copy.save}
                  loading={busy}
                  disabled={preview || changes === 0 || remoteChanged}
                  onPress={() => void saveAttendance()}
                />
                <CsvExport name={attendanceCsvFilename(section?.sectionNumber || sectionId, date)} build={buildCsv} rows={rows.length} />
              </View>
            </View>)}
        </View>)}
    </>,
      }}
    >
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptySchedule} />
      ) : (<View>
          <SectionPicker sections={sections} value={sectionId} onChange={(next) => switchSheet(next, date)} />
          <DateField label={copy.date} value={date} max={today} required onChange={(next) => next && switchSheet(sectionId, next)} />
          {rows.length === 0 ? (
            <StatePanel kind="empty" title={copy.rosterEmpty} />
          ) : (<View>
              <StatStrip
                style={styles.stats}
                items={[
                  { icon: 'account-check-outline', label: copy.statusPresent, value: formatNumber(metrics.present) },
                  { icon: 'account-remove-outline', label: copy.statusAbsent, value: formatNumber(metrics.absent) },
                  { icon: 'clock-alert-outline', label: copy.statusLate, value: formatNumber(metrics.late) },
                  { icon: 'percent-outline', label: copy.rateLabel, value: `${formatNumber(metrics.rate, { maximumFractionDigits: 0 })}%` },
                ]}
              />
              {remoteChanged ? (
                <Notice
                  tone="warning"
                  message={copy.stale}
                  actionLabel={busy ? undefined : copy.reload}
                  onAction={busy ? undefined : reloadSheet}
                />
              ) : null}
              <SearchBar
                value={search}
                onChangeText={(value) => { setSearch(value); setPages(1); }}
                placeholder={copy.searchStudents}
                accessibilityLabel={copy.searchStudents}
                style={styles.searchBar}
              />
              <Button
                icon="check-all"
                label={search.trim() ? fillCopy(copy.markAllPresentScoped, { n: formatNumber(visible.length) }) : copy.markAllPresent}
                variant="secondary"
                onPress={markAll}
                disabled={busy || visible.length === 0}
              />
              <View style={[styles.stack, { marginTop: 12 }]}>
                {visible.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
                </View></View>)}</View>)}
      <Dialog
        visible={pendingDiscard !== null}
        title={copy.discardUnsavedTitle}
        description={copy.discardUnsavedBody}
        confirmLabel={copy.discardUnsavedConfirm}
        cancelLabel={copy.discardUnsavedCancel}
        destructive
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDiscard(null)}
      />
    </OpsShell>
  );
}
