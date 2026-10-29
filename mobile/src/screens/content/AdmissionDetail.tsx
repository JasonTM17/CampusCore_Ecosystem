import { cardRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, DataNotice, Field, UiText } from '../../components/Ui';
import { DateField } from '../../components/ui/index';
import type { MobileAdmissionForm } from '../../api/client';
import { admissionsMessages } from '../../i18n/admissions-messages';
import { fillCopy } from '../../i18n/academic-messages';
import { DOCUMENT_POLICY } from './attachment-transfer';
import { contentApi, type AdmissionApplicationView, type AttachmentInfo } from './content-api';
import { admissionPhase, canChangeAttachments, missingAdmissionFields, type AdmissionRequiredField } from './content-rules';
import {
  AttachmentRow,
  ContentHero,
  DetailFrame,
  FlashNotice,
  MetaRow,
  StatusChip,
  UploadPicker,
  useContentCopy,
  type Flash,
} from './content-ui';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export interface AdmissionDetailProps {
  application: AdmissionApplicationView;
  busy: boolean;
  preview: boolean;
  flash: Flash | null;
  onBack: () => void;
  onSave: (form: MobileAdmissionForm) => void;
  onSubmit: (form: MobileAdmissionForm) => void;
  onWithdraw: () => void;
  onUploaded: () => void;
  onDeleteFile: (file: AttachmentInfo) => void;
}

/** One application: editable form while draft or returned, read-only after, with files and review history. */
export function AdmissionDetail(props: AdmissionDetailProps) {
  const { application, busy, preview, flash, onBack, onSave, onSubmit, onWithdraw, onUploaded, onDeleteFile } = props;
  const { locale, formatDate, formatDateTime, copy: shared } = useContentCopy();
  const copy = admissionsMessages[locale];
  const phase = admissionPhase(application.status);
  const editable = phase === 'editable' || phase === 'returned';
  const attachments = application.attachments ?? [];
  const filesLocked = !canChangeAttachments(phase);

  return (
    <DetailFrame title={copy.title} onBack={onBack}
      list={{ data: [...(cardRows("section-1", attachments, (item, index) => String(item.id ?? index), <>
          <UiText accessibilityRole="header" variant="headlineSmall">{shared.attachments}</UiText>
          {attachments.length === 0 ? <UiText variant="bodySmall" tone="muted">{shared.noAttachments}</UiText> : null}
          </>, (file) => (
            <AttachmentRow
              key={file.id}
              name={file.fileName ?? file.id}
              sizeBytes={file.sizeBytes}
              fetchBytes={() => contentApi.admissionsDownload(application.id, file.id)}
              extraActions={filesLocked || preview ? [] : [{ key: 'delete', label: copy.deleteFile, onPress: () => onDeleteFile(file), disabled: busy }]}
            />
          ), {footer: <>
          {!filesLocked && !preview ? (
            <UploadPicker
              intent={`admissions:${application.id}`}
              policy={DOCUMENT_POLICY}
              disabled={busy}
              upload={(part, key) => contentApi.admissionsUpload(application.id, part, key)}
              onUploaded={onUploaded}
            />
          ) : null}
        </>})),
...(cardRows("section-2", application.reviews, (item, index) => String(item.id ?? index), <>
          <UiText accessibilityRole="header" variant="headlineSmall">{copy.reviews}</UiText>
          {application.reviews.length === 0 ? <UiText variant="bodySmall" tone="muted">{copy.emptyReviews}</UiText> : null}
          </>, (review) => (
            <View key={review.id} accessible style={{ gap: 2, minHeight: 44, justifyContent: 'center' }}>
              <UiText variant="label">{`${copy.reviewActions[review.action] ?? review.action} · ${formatDateTime(review.createdAt)}`}</UiText>
              {review.note ? <UiText variant="bodySmall">{review.note}</UiText> : null}
            </View>
          ), {}))], keyExtractor: (row) => row.key, renderItem: renderVirtualRow, footer: <><View style={{ gap: 12 }}>

        {!(phase === 'terminal') ? (
          <Button label={copy.withdraw} variant="secondary" disabled={busy || preview} onPress={onWithdraw} />
        ) : null}
      </View>
    </> }}
    >
      <View style={{ gap: 12 }}>
        <DataNotice message={copy.simulatedBanner} />
        <FlashNotice flash={flash} />
        <Card>
          <ContentHero title={application.cycle} icon="file-document-edit-outline" detail={fillCopy(copy.version, { n: application.version })}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <StatusChip code={application.status} labels={copy.statusLabels} />
            </View>
          </ContentHero>
          {phase === 'returned' ? <UiText variant="label" tone="warning" style={{ marginTop: 8 }}>{copy.returnedHint}</UiText> : null}
          {phase === 'locked' ? <UiText variant="label" tone="muted" style={{ marginTop: 8 }}>{copy.locked}</UiText> : null}
          {phase === 'terminal' ? <UiText variant="label" tone="muted" style={{ marginTop: 8 }}>{copy.terminal}</UiText> : null}
          {application.decision ? (
            <MetaRow label={copy.decision} value={`${copy.statusLabels[application.decision] ?? application.decision}${application.decisionAt ? `, ${formatDate(application.decisionAt)}` : ''}`} />
          ) : null}
        </Card>

        {editable ? (
          <AdmissionForm
            key={`${application.id}:${application.version}`}
            application={application}
            busy={busy}
            preview={preview}
            resubmit={phase === 'returned'}
            onSave={onSave}
            onSubmit={onSubmit}
          />
        ) : (
          <Card>
            <UiText accessibilityRole="header" variant="headlineSmall">{copy.form}</UiText>
            <View style={{ gap: 4, marginTop: 8 }}>
              <MetaRow label={copy.fullName} value={application.fullName} />
              <MetaRow label={copy.dateOfBirth} value={application.dateOfBirth ? formatDate(application.dateOfBirth) : null} />
              <MetaRow label={copy.schoolName} value={application.schoolName} />
              <MetaRow label={copy.intendedMajor} value={application.intendedMajor} />
              <MetaRow label={copy.essay} value={application.essay} />
            </View>
          </Card>
        )}

        </View></DetailFrame>
  );
}

function AdmissionForm({ application, busy, preview, resubmit, onSave, onSubmit }: {
  application: AdmissionApplicationView;
  busy: boolean;
  preview: boolean;
  resubmit: boolean;
  onSave: (form: MobileAdmissionForm) => void;
  onSubmit: (form: MobileAdmissionForm) => void;
}) {
  const { locale } = useContentCopy();
  const copy = admissionsMessages[locale];
  const [form, setForm] = useState<MobileAdmissionForm>({
    fullName: application.fullName ?? '',
    dateOfBirth: application.dateOfBirth ?? '',
    schoolName: application.schoolName ?? '',
    intendedMajor: application.intendedMajor ?? '',
    essay: application.essay ?? '',
  });
  const [attempted, setAttempted] = useState(false);
  const missing = new Set<AdmissionRequiredField>(attempted ? missingAdmissionFields(form) : []);
  const set = (key: keyof MobileAdmissionForm) => (value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const required = (key: AdmissionRequiredField) => (missing.has(key) ? copy.required : undefined);
  const clean = (): MobileAdmissionForm => ({
    fullName: form.fullName.trim(),
    dateOfBirth: form.dateOfBirth,
    schoolName: form.schoolName.trim(),
    intendedMajor: form.intendedMajor.trim(),
    essay: form.essay.trim(),
  });
  const submit = () => {
    setAttempted(true);
    if (missingAdmissionFields(form).length === 0) onSubmit(clean());
  };

  return (
    <Card>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.form}</UiText>
      <View style={{ marginTop: 8 }}>
        <Field label={copy.fullName} required value={form.fullName} onChangeText={set('fullName')} error={required('fullName')} editable={!busy} autoComplete="name" />
        <DateField label={copy.dateOfBirth} required value={form.dateOfBirth} onChange={set('dateOfBirth')} max={todayIso()} error={required('dateOfBirth')} disabled={busy} />
        <Field label={copy.schoolName} required value={form.schoolName} onChangeText={set('schoolName')} error={required('schoolName')} editable={!busy} />
        <Field label={copy.intendedMajor} required value={form.intendedMajor} onChangeText={set('intendedMajor')} error={required('intendedMajor')} editable={!busy} />
        <Field label={copy.essay} value={form.essay} onChangeText={set('essay')} multiline maxLength={8000} editable={!busy} />
      </View>
      <View style={{ gap: 8 }}>
        <Button label={copy.save} variant="secondary" disabled={busy || preview} onPress={() => onSave(clean())} />
        <Button label={resubmit ? copy.resubmit : copy.submit} loading={busy} disabled={busy || preview} onPress={submit} />
      </View>
    </Card>
  );
}
