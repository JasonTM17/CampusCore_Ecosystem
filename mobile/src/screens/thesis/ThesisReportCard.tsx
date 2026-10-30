import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Card, Field, SectionHeading, UiText } from '../../components/Ui';
import { IconChip } from '../../components/ui/index';
import { Dialog } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { getFileAdapter, type PickedFile } from '../../files/file-adapter';
import { fillThesisCopy, type ThesisCopy } from '../../i18n/thesis-messages';
import { thesisApi } from './thesis-api';
import { pickReportFile, saveReportFile, toReportPart } from './thesis-files';
import {
  THESIS_REPORT_NOTE_MAX,
  THESIS_REPORT_TITLE_MAX,
  canWriteReport,
  isAbortLike,
  planReportSave,
  thesisErrorMessage,
  validateReportInput,
  type ThesisGroup,
  type ThesisReport,
} from './thesis-model';
import { QueryNotices, useThesisUi } from './thesis-ui';
import { useThesisReport } from './use-thesis';

type Notice = { tone: 'success' | 'error'; text: string } | null;

export interface ThesisReportCardProps {
  group: ThesisGroup;
  isLeader: boolean;
  /** Called after a change so the progress read can revalidate. */
  onChanged?: () => void;
}

function formatSize(bytes: number | null | undefined, format: (value: number) => string): string {
  return typeof bytes === 'number' && bytes > 0 ? format(bytes) : '';
}

/**
 * Report of an approved group: link and file attachments through the file
 * adapter (graceful when the device cannot pick or save), cancellable upload,
 * and non-destructive edits. Only the leader writes; members read.
 */
export function ThesisReportCard({ group, isLeader, onChanged }: ThesisReportCardProps) {
  const { copy, locale } = useThesisUi();
  const approved = group.approvalStatus === 'APPROVED';
  const state = useThesisReport(group.id, approved);
  const { report, preview } = state;
  const writable = canWriteReport(group, isLeader) && !preview;

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [working, setWorking] = useState<'save' | 'upload' | 'download' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Form fields mirror the stored report whenever it changes.
  const stored = useRef<ThesisReport | null | undefined>(undefined);
  useEffect(() => {
    if (stored.current === report) return;
    stored.current = report;
    setTitle(report?.title ?? '');
    setNote(report?.note ?? '');
    setUrl(report?.url ?? '');
  }, [report]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!approved) {
    return (
      <Card style={styles.card}>
        <SectionHeading title={copy.report} />
        <UiText variant="bodySmall" tone="muted">{copy.reportNeedsApproval}</UiText>
      </Card>
    );
  }

  const adapter = getFileAdapter();
  const canPick = adapter.capability('pick').available;
  const canSave = adapter.capability('save').available;
  const hasStoredFile = Boolean(report?.fileName);

  const issueText = (issue: string): string => (
    issue === 'titleLong' ? copy.validation.titleLong
      : issue === 'noteLong' ? copy.validation.noteLong
        : issue === 'urlInvalid' ? copy.validation.urlInvalid
          : copy.validation.artifactRequired
  );

  const pick = async () => {
    setNotice(null);
    const outcome = await pickReportFile(adapter);
    if (outcome.status === 'picked') {
      setPicked(outcome.file);
      setIssues([]);
    } else if (outcome.status === 'unavailable') {
      setNotice({ tone: 'error', text: copy.reportFileUnavailable });
    } else if (outcome.status === 'invalid') {
      setNotice({ tone: 'error', text: copy.validation[outcome.issue] });
    } else if (outcome.status === 'failed') {
      setNotice({ tone: 'error', text: copy.reportFileFailed });
    }
  };

  const save = async () => {
    const input = { title, note, url };
    const found = validateReportInput(input, Boolean(picked) || hasStoredFile);
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    const plan = planReportSave(report, input, Boolean(picked));
    if (plan.steps.length === 0) return;
    setIssues([]);
    setNotice(null);
    const controller = new AbortController();
    abort.current = controller;
    setWorking(picked ? 'upload' : 'save');
    let latest: ThesisReport | null = report;
    try {
      for (const step of plan.steps) {
        if (step === 'file' && picked) {
          latest = await thesisApi.submitReportFile(
            group.id,
            { file: toReportPart(picked), title: plan.title || undefined, note: plan.note || undefined },
            { signal: controller.signal },
          );
        } else if (step === 'link') {
          latest = await thesisApi.submitReportLink(group.id, {
            url: plan.url,
            title: plan.title || undefined,
            note: plan.note || undefined,
          });
        } else if (step === 'patch' && plan.patch) {
          latest = await thesisApi.updateReport(group.id, plan.patch);
        }
        state.setReport(latest);
      }
      setPicked(null);
      setNotice({ tone: 'success', text: report ? copy.reportUpdated : copy.reportSubmitted });
      onChanged?.();
    } catch (error) {
      // A partly applied plan still refreshed the report above; reload settles the rest.
      if (isAbortLike(error)) setNotice(null);
      else setNotice({ tone: 'error', text: thesisErrorMessage(copy, error) });
      void state.reload();
    } finally {
      abort.current = null;
      setWorking(null);
    }
  };

  const download = async () => {
    setNotice(null);
    setWorking('download');
    const outcome = await saveReportFile(
      adapter,
      () => thesisApi.downloadReportFile(group.id),
      report?.fileName ?? 'report',
    );
    setWorking(null);
    if (outcome.status === 'done') setNotice({ tone: 'success', text: copy.reportFileSaved });
    else if (outcome.status === 'unavailable') setNotice({ tone: 'error', text: copy.reportFileUnavailable });
    else if (outcome.status === 'failed') setNotice({ tone: 'error', text: copy.reportFileFailed });
  };

  const removeFile = async () => {
    setConfirmRemove(false);
    setNotice(null);
    setWorking('remove');
    try {
      state.setReport(await thesisApi.removeReportFile(group.id));
      setNotice({ tone: 'success', text: copy.reportFileRemoved });
      onChanged?.();
    } catch (error) {
      setNotice({ tone: 'error', text: thesisErrorMessage(copy, error) });
    } finally {
      setWorking(null);
    }
  };

  const busy = working !== null;
  const errorFor = (issue: string) => (issues.includes(issue) ? issueText(issue) : undefined);

  return (
    <Card style={styles.card}>
      <SectionHeading title={copy.report} />
      <QueryNotices state={{ ...state, preview: false }} copy={copy} />
      {!state.loading && !state.error && !report ? (
        <UiText variant="bodySmall" tone="muted" style={styles.gap}>
          {isLeader ? copy.reportNone : copy.reportOnlyLeader}
        </UiText>
      ) : null}

      {report ? (
        <ReportSummary
          copy={copy}
          report={report}
          formatDateTime={locale.formatDateTime}
          formatSize={(bytes) => formatSize(bytes, locale.formatBytes)}
          fileAction={hasStoredFile ? (
            <Button
              label={working === 'download' ? copy.reportDownloading : copy.reportDownload}
              loading={working === 'download'}
              disabled={busy || !canSave}
              onPress={() => void download()}
              variant="secondary"
            />
          ) : undefined}
        />
      ) : null}

      {report?.url && report.url.toLowerCase().startsWith('https://') ? (
        <Button label={copy.reportOpenLink} onPress={() => { void Linking.openURL(report.url as string).catch(() => undefined); }} variant="text" />
      ) : null}
      {hasStoredFile ? (
        <View style={styles.actions}>
          {writable ? (
            <Button label={copy.reportRemoveFile} disabled={busy} onPress={() => setConfirmRemove(true)} variant="text" />
          ) : null}
        </View>
      ) : null}
      {hasStoredFile && !canSave ? (
        <UiText variant="meta" tone="muted" style={styles.gap}>{copy.reportFileUnavailable}</UiText>
      ) : null}

      {writable ? (
        <View style={styles.form}>
          <Field
            label={copy.reportTitle}
            value={title}
            onChangeText={setTitle}
            maxLength={THESIS_REPORT_TITLE_MAX}
            error={errorFor('titleLong')}
            editable={!busy}
          />
          <Field
            label={copy.reportNote}
            value={note}
            onChangeText={setNote}
            maxLength={THESIS_REPORT_NOTE_MAX}
            multiline
            error={errorFor('noteLong')}
            editable={!busy}
            helperText={fillThesisCopy('{count}/{max}', { count: note.length, max: THESIS_REPORT_NOTE_MAX })}
          />
          <Field
            label={copy.reportUrl}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            helperText={copy.reportUrlHint}
            error={errorFor('urlInvalid') ?? errorFor('artifactRequired')}
            editable={!busy}
          />
          <UiText variant="label" style={styles.gap}>{copy.reportFile}</UiText>
          <UiText variant="meta" tone="muted" style={styles.gap}>{copy.reportFileHint}</UiText>
          {picked ? (
            <UiText variant="bodySmall" style={styles.gap}>
              {`${copy.reportPicked}: ${picked.name}${picked.sizeBytes ? ` (${locale.formatBytes(picked.sizeBytes)})` : ''}`}
            </UiText>
          ) : null}
          {canPick ? (
            <Button label={copy.reportPick} variant="secondary" disabled={busy} onPress={() => void pick()} style={styles.gap} />
          ) : (
            <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.reportFileUnavailable}</UiText>
          )}
          {notice ? (
            <UiText accessibilityRole="alert" variant="bodySmall" tone={notice.tone} style={styles.gap}>{notice.text}</UiText>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={working === 'upload' ? copy.reportUploading : report ? copy.reportUpdate : copy.reportSubmit}
              loading={working === 'save' || working === 'upload'}
              disabled={busy}
              onPress={() => void save()}
            />
            {working === 'upload' ? (
              <Button label={copy.reportUploadCancel} onPress={() => abort.current?.abort()} variant="secondary" />
            ) : null}
          </View>
        </View>
      ) : (
        notice ? <UiText accessibilityRole="alert" variant="bodySmall" tone={notice.tone}>{notice.text}</UiText> : null
      )}

      <Dialog
        visible={confirmRemove}
        title={copy.reportRemoveFileTitle}
        description={copy.reportRemoveFileBody}
        confirmLabel={copy.reportRemoveFile}
        cancelLabel={copy.cancel}
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void removeFile()}
      />
    </Card>
  );
}

function ReportSummary({
  copy,
  report,
  formatDateTime,
  formatSize: size,
  fileAction,
}: {
  copy: ThesisCopy;
  report: ThesisReport;
  formatDateTime: (value: string) => string;
  formatSize: (bytes: number | null | undefined) => string;
  fileAction?: ReactNode;
}) {
  return (
    <View style={styles.gap}>
      {report.title ? <UiText variant="label">{report.title}</UiText> : null}
      {report.note ? <UiText variant="bodySmall" tone="muted">{report.note}</UiText> : null}
      {report.url ? <UiText variant="bodySmall" selectable>{report.url}</UiText> : null}
      {report.fileName ? (
        <View style={styles.fileRow}>
          <IconChip icon="file-document-outline" />
          <View style={styles.fileCopy}>
            <UiText variant="bodySmall">{report.fileName}</UiText>
            {size(report.fileSize) ? <UiText variant="meta" tone="muted">{size(report.fileSize)}</UiText> : null}
          </View>
          {fileAction}
        </View>
      ) : null}
      {report.submittedAt ? (
        <UiText variant="meta" tone="muted">{`${copy.reportSubmittedAt}: ${formatDateTime(report.submittedAt)}`}</UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: tokens.spacing.md },
  gap: { marginBottom: tokens.spacing.sm },
  form: { marginTop: tokens.spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm },
  fileRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, marginVertical: tokens.spacing.xs },
  fileCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
});
