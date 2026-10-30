import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, DataNotice, Field, UiText } from '../../components/Ui';
import { apiClient } from '../../api/client';
import type { MobileAdmissionForm } from '../../api/client';
import { tokens } from '../../design/tokens';
import { admissionsMessages } from '../../i18n/admissions-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { AdmissionDetail } from '../content/AdmissionDetail';
import { contentApi, type AdmissionApplicationView, type AttachmentInfo } from '../content/content-api';
import { contentErrorMessage, errorCode } from '../content/content-errors';
import { joinMeta } from '../content/content-rules';
import { ContentIconChip, DetailFrame, FlashNotice, ListFrame, StatusChip, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { previewAdmissions } from '../content/preview-data';
import { useListQuery } from '../content/use-list-query';

type View_ = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string };

/** Admissions applicant: own applications, draft, submit, withdraw and files. The decision is always labelled simulated. */
export function AdmissionsScreen(_props: MobileScreenProps) {
  const { locale, formatDate, copy: common } = useContentCopy();
  const copy = admissionsMessages[locale];
  const [view, setView] = useState<View_>({ kind: 'list' });
  const [cycle, setCycle] = useState('');
  const [cycleError, setCycleError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const live = apiClient.mode === 'live';

  const previewList = useMemo(() => previewAdmissions(locale), [locale]);
  const apps = useListQuery<AdmissionApplicationView>({
    key: 'content.admissions.mine',
    fetchAll: () => contentApi.admissionsApplications(),
    preview: previewList,
  });

  const run = useCallback(async <T,>(action: () => Promise<T>, ok: string): Promise<T | undefined> => {
    if (busy || !live) return undefined;
    setBusy(true);
    clear();
    try {
      const result = await action();
      success(ok);
      void apps.reload();
      return result;
    } catch (error) {
      const code = errorCode(error);
      fail(
        code === 'APPLICATION_CYCLE_ACTIVE' ? copy.cycleActive
        : code === 'APPLICATION_INCOMPLETE' ? copy.incomplete
        : code === 'STALE_VERSION' ? copy.stale
        : contentErrorMessage(common, error, copy.failed),
      );
      if (code === 'STALE_VERSION') void apps.reload();
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [apps, busy, clear, common, copy, fail, live, success]);

  const selected = view.kind === 'detail' ? apps.items.find((item) => item.id === view.id) ?? null : null;

  const create = async () => {
    const value = cycle.trim();
    if (!value) return setCycleError(copy.required);
    setCycleError(undefined);
    const created = await run(() => contentApi.admissionsCreate(value), copy.created);
    if (created) {
      setCycle('');
      setView({ kind: 'detail', id: created.id });
    }
  };

  const save = (application: AdmissionApplicationView, form: MobileAdmissionForm) =>
    void run(() => contentApi.admissionsSave(application.id, form, application.version), copy.saved);

  const submit = (application: AdmissionApplicationView, form: MobileAdmissionForm) => ask({
    title: copy.submitTitle,
    description: copy.submitBody,
    confirmLabel: copy.submit,
    cancelLabel: common.back,
    onConfirm: () => void run(async () => {
      // The server submits what it stored: save first, then submit the version that save returned.
      const saved = await contentApi.admissionsSave(application.id, form, application.version);
      return contentApi.admissionsSubmit(application.id, saved.version);
    }, copy.submitted),
  });

  const withdraw = (application: AdmissionApplicationView) => ask({
    title: copy.withdrawTitle,
    confirmLabel: copy.withdraw,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(() => contentApi.admissionsWithdraw(application.id, application.version), copy.withdrawn),
  });

  const deleteFile = (application: AdmissionApplicationView, file: AttachmentInfo) => ask({
    title: copy.deleteFileTitle,
    description: file.fileName ?? undefined,
    confirmLabel: copy.deleteFile,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(() => contentApi.admissionsDeleteAttachment(application.id, file.id), copy.fileDeleted),
  });

  if (selected) {
    return (
      <>
        <AdmissionDetail
          application={selected}
          busy={busy}
          preview={!live}
          flash={flash}
          onBack={() => { setView({ kind: 'list' }); clear(); }}
          onSave={(form) => save(selected, form)}
          onSubmit={(form) => submit(selected, form)}
          onWithdraw={() => withdraw(selected)}
          onUploaded={() => { success(common.uploaded); void apps.reload(); }}
          onDeleteFile={(file) => deleteFile(selected, file)}
        />
        {dialog}
      </>
    );
  }

  const banner = <DataNotice message={copy.simulatedBanner} />;

  if (view.kind === 'new') {
    return (
      <>
        <DetailFrame title={copy.newApplication} onBack={() => { setView({ kind: 'list' }); clear(); }}>
          <View style={styles.header}>
            {banner}
            <FlashNotice flash={flash} />
            <Card>
              <Field
                label={copy.cycle}
                placeholder={copy.cyclePlaceholder}
                value={cycle}
                onChangeText={(value) => { setCycle(value); setCycleError(undefined); }}
                error={cycleError}
                editable={!busy}
                autoCapitalize="characters"
              />
              <Button label={copy.createDraft} loading={busy} disabled={busy || !live} onPress={() => void create()} />
            </Card>
          </View>
        </DetailFrame>
        {dialog}
      </>
    );
  }

  return (
    <>
      <ListFrame
        title={copy.title}
        icon="file-document-edit-outline"
        list={apps}
        keyOf={(item) => item.id}
        emptyTitle={copy.emptyApplications}
        flash={flash}
        header={(
          <View style={styles.header}>
            {banner}
            <View style={styles.actions}>
              <Button label={copy.newApplication} disabled={!live} onPress={() => { setView({ kind: 'new' }); clear(); }} />
            </View>
          </View>
        )}
        renderItem={(item) => (
          <Card>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={joinMeta([item.cycle, copy.statusLabels[item.status] ?? item.status, item.fullName])}
              onPress={() => { setView({ kind: 'detail', id: item.id }); clear(); }}
              style={styles.rowMain}
            >
              <ContentIconChip icon="file-document-edit-outline" />
              <View style={styles.rowCopy}>
                <UiText variant="label">{item.cycle}</UiText>
                <UiText variant="bodySmall" tone="muted">
                  {joinMeta([item.fullName, item.submittedAt ? formatDate(item.submittedAt) : null])}
                </UiText>
                <View style={styles.chips}>
                  <StatusChip code={item.status} labels={copy.statusLabels} />
                </View>
              </View>
            </Pressable>
          </Card>
        )}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  actions: { alignItems: 'flex-start', gap: tokens.spacing.sm },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
