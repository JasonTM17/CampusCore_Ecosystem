import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { apiClient } from '../../api/client';
import type { LecturerScheduleEntry } from '../../api/client';
import { Button, DataNotice, ScreenShell, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { FileRow, type FileRowStatus } from '../../components/ui/file-row';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { fillCopy } from '../../i18n/academic-messages';
import type { OperationsCopy } from '../../i18n/operations-messages';
import { csvShareAvailable, shareCsv } from './lecturer-api';
import { courseTitle, normalizeDay, type SectionLike } from './lecturer-model';
import { openPortalPath, opsErrorMessage, useOpsCopy } from './shared/helpers';
import { useOpsStyles } from './shared/styles';

export const isOpsPreview = (): boolean => apiClient.mode === 'preview';

/** Live-only query: preview sessions never fetch and screens fall back to labelled preview data. */
export function useOpsQuery<T>(key: string, fetcher: () => Promise<T>, copy: OperationsCopy, enabled = true) {
  return useScreenQuery<T>(key, fetcher, {
    enabled: apiClient.mode === 'live' && enabled,
    errorMessage: copy.errorTitle,
    mapError: (error) => opsErrorMessage(copy, error, copy.generic),
  });
}

export interface OpsShellProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  warning?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}

/** Screen frame with the loading, error, stale-data and preview states in one place. */
export function OpsShell({ title, eyebrow, subtitle, loading = false, error, warning, onRetry, children }: OpsShellProps) {
  const { copy } = useOpsCopy();
  return (
    <ScreenShell title={title} eyebrow={eyebrow} subtitle={subtitle}>
      {isOpsPreview() ? <DataNotice message={copy.previewNotice} /> : null}
      {warning ? <DataNotice message={warning} /> : null}
      {loading || error ? (
        <StatePanel
          kind={loading ? 'loading' : 'error'}
          title={loading ? copy.loading : copy.errorTitle}
          description={loading ? undefined : error ?? undefined}
          actionLabel={loading ? undefined : copy.retry}
          onAction={loading ? undefined : onRetry}
        />
      ) : (
        children
      )}
    </ScreenShell>
  );
}

export function slotText(
  slot: NonNullable<LecturerScheduleEntry['schedules']>[number],
  copy: OperationsCopy,
): string {
  const day = copy.dayLong[normalizeDay(slot.dayOfWeek)] ?? '';
  const room = `${slot.classroom?.building ?? ''} ${slot.classroom?.roomNumber ?? ''}`.trim() || copy.roomPending;
  return `${day} · ${slot.startTime}–${slot.endTime} · ${room}`;
}

export function sectionLabel(section: SectionLike, copy: OperationsCopy, locale: 'vi' | 'en'): string {
  const code = section.courseCode ?? (courseTitle(section, locale) || copy.untitled);
  return section.sectionNumber ? `${code} · ${fillCopy(copy.sectionLine, { n: section.sectionNumber })}` : code;
}

export interface SectionPickerProps {
  sections: readonly SectionLike[];
  value: string;
  onChange: (sectionId: string) => void;
}

export function SectionPicker({ sections, value, onChange }: SectionPickerProps) {
  const { copy, locale } = useOpsCopy();
  if (sections.length < 2) return null;
  return (
    <ChoiceField
      label={copy.sectionPicker}
      display="sheet"
      options={sections.map((section) => ({ value: section.sectionId, label: sectionLabel(section, copy, locale) }))}
      value={value}
      onChange={onChange}
    />
  );
}

export interface HandoffButtonProps {
  label: string;
  /** Portal route that owns the work. */
  path: string;
}

/** Secondary button that opens the portal route; reports a link that could not be opened. */
export function HandoffButton({ label, path }: HandoffButtonProps) {
  const { copy } = useOpsCopy();
  const styles = useOpsStyles();
  const [failed, setFailed] = useState(false);
  return (
    <View>
      <Button
        label={label}
        variant="secondary"
        onPress={() => {
          setFailed(false);
          void openPortalPath(path).then((opened) => setFailed(!opened));
        }}
        style={styles.topButton}
      />
      {failed ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{copy.webOpenFailed}</UiText> : null}
    </View>
  );
}

export interface CsvExportProps {
  name: string;
  /** Built on demand so a large sheet is not generated until the lecturer asks. */
  build: () => string;
  rows: number;
}

/** CSV export through the file adapter; reports only what the adapter returned. */
export function CsvExport({ name, build, rows }: CsvExportProps) {
  const { copy } = useOpsCopy();
  const available = csvShareAvailable();
  const [state, setState] = useState<{ status: FileRowStatus; label?: string }>({ status: 'ready' });
  if (rows === 0) return null;

  const run = async () => {
    setState({ status: 'busy' });
    const result = await shareCsv(build(), name);
    if (result.status === 'done') setState({ status: 'ready', label: copy.exportShared });
    else if (result.status === 'cancelled') setState({ status: 'ready' });
    else if (result.status === 'unavailable') setState({ status: 'unavailable', label: copy.exportUnavailable });
    else setState({ status: 'failed', label: copy.exportFailed });
  };

  const status: FileRowStatus = available ? state.status : 'unavailable';
  const label = available ? state.label ?? fillCopy(copy.exportReady, { n: rows }) : copy.exportUnavailable;
  return (
    <FileRow
      name={name}
      status={status}
      statusLabel={label}
      actions={[{ key: 'export', label: copy.exportCsv, onPress: () => void run(), disabled: !available }]}
    />
  );
}
