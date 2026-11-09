// Shared building blocks for the content and service screens: list frame with
// pull-to-refresh and paging, detail frame, flash notices, confirmation, status
// chips, and the file rows for download and upload.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import type { PerformanceListProps } from '../../components/perf/performance-list';
import { DataList, Dialog, Notice, FileRow, StatusPill } from '../../components/ui/index';
import type { FileRowAction, FileRowProps } from '../../components/ui/index';
import { ResponsiveContent } from '../../components/ui/ResponsiveContent';
import { apiClient } from '../../api/client';
import { chromeFor } from '../../design/chrome';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { getFileAdapter } from '../../files/file-adapter';
import type { PickedFile } from '../../files/file-adapter';
import { contentMessages } from '../../i18n/content-messages';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import {
  checkPickedFile,
  downloadToDevice,
  pickForUpload,
  transferStateOf,
  uploadPicked,
  type AttachmentPolicy,
  type DownloadedBytes,
  type FileProblem,
  type TransferState,
} from './attachment-transfer';
import { statusTone } from './content-rules';
import { contentApi } from './content-api';
import { contentErrorMessage } from './content-errors';
import type { PagedList } from './use-paged-list';

export const isPreviewMode = (): boolean => apiClient.mode === 'preview';

export function useContentCopy() {
  const locale = useLocale();
  return { ...locale, copy: contentMessages[locale.locale] };
}

/* ---------- flash notice ---------- */

export interface Flash {
  tone: 'success' | 'error';
  message: string;
}

export function useFlash() {
  const [flash, setFlash] = useState<Flash | null>(null);
  const success = useCallback((message: string) => setFlash({ tone: 'success', message }), []);
  const fail = useCallback((message: string) => setFlash({ tone: 'error', message }), []);
  const clear = useCallback(() => setFlash(null), []);
  return { flash, success, fail, clear };
}

export function FlashNotice({ flash }: { flash: Flash | null }) {
  return flash ? <Notice tone={flash.tone === 'error' ? 'error' : 'success'} message={flash.message} /> : null;
}

/* ---------- confirmation ---------- */

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function useConfirm(): { ask: (request: ConfirmRequest) => void; dialog: ReactElement } {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const dialog = (
    <Dialog
      visible={request !== null}
      title={request?.title ?? ''}
      description={request?.description}
      confirmLabel={request?.confirmLabel ?? ''}
      cancelLabel={request?.cancelLabel}
      destructive={request?.destructive}
      onCancel={close}
      onConfirm={() => {
        const run = request?.onConfirm;
        close();
        run?.();
      }}
    />
  );
  return { ask: setRequest, dialog };
}

/* ---------- status chip and rows ---------- */

export function StatusChip({ code, labels }: { code: string | null | undefined; labels: Readonly<Record<string, string>> }) {
  if (!code) return null;
  return <StatusPill label={labels[code] ?? code} tone={statusTone(code)} />;
}

export function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  const { window } = useTheme();
  if (!value) return null;
  const stacked = window.fontScale >= 1.3 || window.width < 360;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.metaRow, stacked ? styles.metaRowStacked : undefined]}>
      <UiText variant="bodySmall" tone="muted" style={[styles.metaLabel, stacked ? styles.metaLabelStacked : undefined]}>{label}</UiText>
      <UiText variant="bodySmall" style={styles.metaValue}>{value}</UiText>
    </View>
  );
}

export type ContentIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Decorative icon chip for content rows and detail summaries. */
export function ContentIconChip({ icon, onBrand = false }: { icon: ContentIconName; onBrand?: boolean }) {
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  return (
    <View accessible={false} importantForAccessibility="no" style={[styles.iconChip, { backgroundColor: onBrand ? chrome.overlay : colors.primaryFixed }]}>
      <MaterialCommunityIcons color={onBrand ? chrome.onSurface : colors.primary} name={icon} size={20} />
    </View>
  );
}

/** Decorative forward cue for a card that is already an accessible button. */
export function ContentChevron() {
  const { colors } = useTheme();
  return <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={colors.textMuted} name="chevron-right" size={20} />;
}

/** The trailing action used by compact rows; its accessible name is supplied by the screen. */
export function ContentIconAction({
  accessibilityLabel,
  icon,
  onPress,
  disabled = false,
}: {
  accessibilityLabel: string;
  icon: ContentIconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconAction, {
        backgroundColor: pressed ? colors.surface : colors.primaryFixed,
        borderColor: colors.outlineVariant,
      }, disabled ? styles.iconActionDisabled : undefined]}
    >
      <MaterialCommunityIcons color={disabled ? colors.textMuted : colors.primary} name={icon} size={20} />
    </Pressable>
  );
}

/** Locally composed brand summary, preserving the title's header role. */
export function ContentHero({
  title,
  eyebrow,
  description,
  detail,
  detailLive = false,
  icon,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  detail?: string;
  detailLive?: boolean;
  icon?: ContentIconName;
  children?: ReactNode;
}) {
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  return (
    <View style={[styles.hero, { backgroundColor: chrome.surface }]}>
      {icon ? <ContentIconChip icon={icon} onBrand /> : null}
      <View style={styles.heroCopy}>
        {eyebrow ? <UiText variant="meta" style={[styles.heroEyebrow, { color: chrome.accent }]}>{eyebrow}</UiText> : null}
        <UiText accessibilityRole="header" variant="headlineMedium" style={{ color: chrome.onSurface }}>{title}</UiText>
        {description ? <UiText variant="bodySmall" style={[styles.heroDetail, { color: chrome.onSurfaceMuted }]}>{description}</UiText> : null}
        {detail ? <UiText accessibilityLiveRegion={detailLive ? 'polite' : undefined} variant="bodySmall" style={[styles.heroDetail, { color: chrome.onSurfaceMuted }]}>{detail}</UiText> : null}
        {children}
      </View>
    </View>
  );
}

/* ---------- list frame ---------- */

export interface ListFrameProps<T> {
  title: string;
  eyebrow?: string;
  description?: string;
  list: PagedList<T>;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement | null;
  emptyTitle: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  /** Replaces the empty title when a filter is active. */
  emptyFilteredTitle?: string;
  /** Page-specific heading shown when the first read fails. */
  errorTitle?: string;
  /** Page-specific retry sentence; falls back to the classified list error. */
  errorDescription?: string;
  filtered?: boolean;
  /** Rows to render instead of `list.items`, for client-side filters. */
  items?: readonly T[];
  header?: ReactNode;
  flash?: Flash | null;
  accessibilityLabel?: string;
  icon?: ContentIconName;
}

/** One list screen: header, filters, notices and a paged, refreshable list. */
export function ListFrame<T>({
  title,
  eyebrow,
  description,
  list,
  keyOf,
  renderItem,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  emptyFilteredTitle,
  errorTitle,
  errorDescription,
  filtered = false,
  items,
  header,
  flash,
  accessibilityLabel,
  icon,
}: ListFrameProps<T>) {
  const { colors } = useTheme();
  const { copy, t } = useContentCopy();
  const rows = items ?? list.items;
  const shownCount = rows.length;
  const count = list.total !== undefined && !filtered
    ? fillCopy(copy.listCount, { shown: shownCount, total: list.total })
    : null;
  const error = list.error ? (errorDescription ?? list.error) : list.loadMoreError;

  const head = (
    <View style={styles.head}>
      <ContentHero title={title} eyebrow={eyebrow} description={description} detail={count ?? undefined} detailLive={count !== null} icon={icon} />
      {list.warning ? <Notice tone="warning" message={list.warning} /> : null}
      <FlashNotice flash={flash ?? null} />
      {header}
      {filtered && shownCount === 0 && list.hasMore && !list.loadingMore && !error ? (
        <Button label={t('loadMore')} variant="secondary" onPress={list.loadMore} />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.frame, { backgroundColor: colors.background }]}>
      <ResponsiveContent style={styles.frameInner}>
        <DataList
          data={rows}
          keyExtractor={keyOf}
          renderItem={(item) => renderItem(item)}
          loading={list.loading}
          error={error}
          errorTitle={list.error ? errorTitle : undefined}
          onRetry={list.loadMoreError ? list.loadMore : list.refresh}
          refreshing={list.refreshing}
          onRefresh={list.preview ? undefined : list.refresh}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          onLoadMore={list.loadMore}
          emptyTitle={filtered && emptyFilteredTitle ? emptyFilteredTitle : emptyTitle}
          emptyDescription={emptyDescription}
          emptyActionLabel={emptyActionLabel}
          onEmptyAction={onEmptyAction}
          header={head}
          accessibilityLabel={accessibilityLabel ?? title}
        />
      </ResponsiveContent>
    </View>
  );
}

/** Frame for a detail view: scrollable, with a 44dp back control in the header. */
export function DetailFrame<T>({ title, backLabel, onBack, children, list }: { title: string; backLabel?: string; onBack: () => void; children: ReactNode; list?: PerformanceListProps<T> }) {
  const { copy } = useContentCopy();
  const label = backLabel ?? copy.back;
  return (
    <ScreenShell
      title={title}
      list={list}
      headerAction={<Button label={label} accessibilityLabel={label} variant="text" onPress={onBack} />}
    >
      {list ? <View style={styles.detailHead}>{children}</View> : children}
    </ScreenShell>
  );
}

/* ---------- files ---------- */

export interface AttachmentRowProps {
  name: string;
  sizeBytes?: number | null;
  /** Fetches the bytes through the authenticated client. */
  fetchBytes: (signal?: AbortSignal) => Promise<DownloadedBytes>;
  extraActions?: readonly FileRowAction[];
}

/** A stored file with a download action; the default adapter makes it a graceful "not supported here". */
export function AttachmentRow({ name, sizeBytes, fetchBytes, extraActions = [] }: AttachmentRowProps) {
  const { copy } = useContentCopy();
  const [state, setState] = useState<TransferState>({ status: 'idle' });
  const activeDownload = useRef<AbortController | null>(null);
  const adapter = getFileAdapter();
  const canSave = adapter.capability('save').available;

  useEffect(() => () => {
    activeDownload.current?.abort();
    activeDownload.current = null;
  }, []);

  const download = useCallback(async () => {
    activeDownload.current?.abort();
    const controller = new AbortController();
    activeDownload.current = controller;
    setState({ status: 'busy' });
    const outcome = await downloadToDevice(adapter, fetchBytes, name, controller.signal);
    if (activeDownload.current !== controller) return;
    activeDownload.current = null;
    setState(transferStateOf(outcome));
  }, [adapter, fetchBytes, name]);

  const status = !canSave ? 'unavailable'
    : state.status === 'busy' ? 'busy'
    : state.status === 'failed' ? 'failed'
    : state.status === 'unavailable' ? 'unavailable'
    : 'ready';
  const statusLabel = state.status === 'done' ? copy.fileSaved
    : status === 'unavailable' ? copy.fileUnavailable
    : status === 'failed' ? copy.fileFailed
    : undefined;
  const actions: FileRowAction[] = [
    ...(canSave ? [{ key: 'download', label: copy.fileSave, onPress: () => void download() }] : []),
    ...extraActions,
  ];
  return <ContentFileRow name={name} sizeBytes={sizeBytes} status={status} statusLabel={statusLabel} actions={actions} />;
}

/** File row used locally by content screens until the shared FileRow accepts a leading icon. */
function ContentFileRow(props: FileRowProps) {
  return (
    <View style={styles.attachmentRow}>
      <ContentIconChip icon="file-outline" />
      <View style={styles.attachmentFile}>
        <FileRow {...props} />
      </View>
    </View>
  );
}

function problemMessage(copy: (typeof contentMessages)['vi'], problem: FileProblem, tooLargeMessage?: string): string {
  return problem === 'too_large' ? tooLargeMessage ?? copy.fileTooLarge : problem === 'type' ? copy.fileType : copy.fileEmpty;
}

export interface FilePickerProps {
  policy: AttachmentPolicy;
  file: PickedFile | null;
  onChange: (file: PickedFile | null) => void;
  /** Shown on the picked file, for example a failed upload; the file is kept. */
  status?: 'ready' | 'busy' | 'failed';
  statusLabel?: string;
  /** Overrides the shared oversize copy for a lane with its own ceiling. */
  tooLargeMessage?: string;
  extraActions?: readonly FileRowAction[];
  disabled?: boolean;
}

/** Choose and show one file. With the default adapter the choose control explains that it is not supported. */
export function FilePicker({ policy, file, onChange, status = 'ready', statusLabel, tooLargeMessage, extraActions = [], disabled = false }: FilePickerProps) {
  const { copy } = useContentCopy();
  const adapter = getFileAdapter();
  const capability = adapter.capability('pick');
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const pick = useCallback(async () => {
    setProblem(null);
    const outcome = await pickForUpload(adapter, policy);
    if (!mounted.current) {
      if (outcome.status === 'picked') outcome.file.release?.();
      return;
    }
    if (outcome.status === 'picked') onChange(outcome.file);
    else if (outcome.status === 'invalid') setProblem(problemMessage(copy, outcome.problem, tooLargeMessage));
    else if (outcome.status === 'failed') setProblem(copy.fileFailed);
    else if (outcome.status === 'unavailable') setProblem(copy.pickUnavailable);
  }, [adapter, copy, onChange, policy, tooLargeMessage]);

  if (file) {
    const check = checkPickedFile(file, policy);
    return (
      <ContentFileRow
        name={file.name}
        sizeBytes={file.sizeBytes}
        status={check.ok ? status : 'failed'}
        statusLabel={check.ok ? statusLabel : problemMessage(copy, check.problem, tooLargeMessage)}
        actions={[
          ...extraActions,
          { key: 'remove', label: copy.removeFile, onPress: () => { file.release?.(); onChange(null); }, disabled },
        ]}
      />
    );
  }
  return (
    <View style={styles.pickRow}>
      <Button
        label={copy.pickFile}
        variant="secondary"
        disabled={disabled || !capability.available}
        onPress={() => void pick()}
      />
      {!capability.available || problem ? (
        <UiText variant="bodySmall" tone={problem ? 'error' : 'muted'} accessibilityLiveRegion="polite">
          {problem ?? copy.pickUnavailable}
        </UiText>
      ) : null}
    </View>
  );
}

export interface UploadPickerProps<T> {
  /** Names the intent so a retry of the same upload reuses one idempotency key. */
  intent: string;
  policy: AttachmentPolicy;
  upload: (part: { uri: string; name: string; type: string }, idempotencyKey: string, signal?: AbortSignal) => Promise<T>;
  onUploaded: (result: T) => void;
  /** Overrides the shared oversize copy for a lane with its own ceiling. */
  tooLargeMessage?: string;
  disabled?: boolean;
}

/** Pick, then upload now. A failed upload keeps the chosen file so the user can retry. */
export function UploadPicker<T>({ intent, policy, upload, onUploaded, tooLargeMessage, disabled = false }: UploadPickerProps<T>) {
  const { copy } = useContentCopy();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const activeUpload = useRef<AbortController | null>(null);
  const currentFile = useRef<PickedFile | null>(null);

  useEffect(() => () => {
    activeUpload.current?.abort();
    activeUpload.current = null;
    const ownedFile = currentFile.current;
    currentFile.current = null;
    ownedFile?.release?.();
  }, []);

  const send = useCallback(async () => {
    if (!file || activeUpload.current) return;
    const controller = new AbortController();
    activeUpload.current = controller;
    setBusy(true);
    setFailure(null);
    const outcome = await uploadPicked(file, { keys: contentApi.attempts, intent, upload, signal: controller.signal });
    if (activeUpload.current !== controller) return;
    activeUpload.current = null;
    setBusy(false);
    if (outcome.status === 'done') {
      if (currentFile.current === file) currentFile.current = null;
      file.release?.();
      setFile(null);
      onUploaded(outcome.result);
    } else {
      setFailure(contentErrorMessage(copy, outcome.error, copy.uploadFailed));
    }
  }, [copy, file, intent, onUploaded, upload]);

  return (
    <View style={styles.uploadBlock}>
      <FilePicker
        policy={policy}
        file={file}
        onChange={(next) => { currentFile.current = next; setFile(next); setFailure(null); }}
        status={busy ? 'busy' : failure ? 'failed' : 'ready'}
        statusLabel={failure ?? undefined}
        tooLargeMessage={tooLargeMessage}
        disabled={disabled || busy}
        extraActions={[{ key: 'upload', label: copy.uploadFile, onPress: () => void send(), disabled: disabled || busy }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  frameInner: { flex: 1 },
  head: { gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm },
  detailHead: { marginBottom: tokens.spacing.sm },
  hero: { alignItems: 'flex-start', borderRadius: tokens.radii.card, flexDirection: 'row', gap: tokens.spacing.sm, padding: tokens.spacing.md },
  heroCopy: { flex: 1, minWidth: 0 },
  heroEyebrow: { letterSpacing: 0.6, marginBottom: tokens.spacing.xs, textTransform: 'uppercase' },
  heroDetail: { marginTop: tokens.spacing.xs },
  iconChip: { alignItems: 'center', borderRadius: tokens.radii.control, flexShrink: 0, height: 40, justifyContent: 'center', width: 40 },
  iconAction: { alignItems: 'center', borderRadius: tokens.radii.control, borderWidth: 1, minHeight: minTapTarget, minWidth: minTapTarget, justifyContent: 'center' },
  iconActionDisabled: { opacity: 0.65 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  metaRowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  metaLabel: { flexShrink: 1, minWidth: 0 },
  metaLabelStacked: { width: '100%' },
  metaValue: { flex: 1, minWidth: 120 },
  attachmentRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minWidth: 0 },
  attachmentFile: { flex: 1, minWidth: 0 },
  pickRow: { alignItems: 'flex-start', gap: tokens.spacing.xs },
  uploadBlock: { gap: tokens.spacing.xs },
});
