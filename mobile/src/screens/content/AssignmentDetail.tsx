import { cardRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, DataNotice, Field, StatePanel, UiText } from '../../components/Ui';
import type { MobileLearningAssignment, MobileLearningFeedback, MobileLearningRevision, MobileLearningSubmission } from '../../api/client';
import { readQueryCache, writeQueryCache } from '../../hooks/query-cache';
import type { PickedFile } from '../../files/file-adapter';
import { fillCopy } from '../../i18n/academic-messages';
import { learningMessages } from '../../i18n/learning-messages';
import { COURSEWORK_POLICY, toUploadPart } from './attachment-transfer';
import { contentApi } from './content-api';
import { contentErrorMessage, errorCode } from './content-errors';
import { deadlinePassed, hasSubmissionContent, joinMeta, submissionPhase } from './content-rules';
import {
  AttachmentRow,
  ContentHero,
  DetailFrame,
  FilePicker,
  FlashNotice,
  MetaRow,
  StatusChip,
  isPreviewMode,
  useConfirm,
  useContentCopy,
  useFlash,
} from './content-ui';
import { useContentQuery } from './use-content-query';

const TEXT_MAX = 20000;
const draftKey = (assignmentId: string) => `learning.draft.${assignmentId}`;

export interface AssignmentDetailProps {
  assignment: MobileLearningAssignment;
  onBack: () => void;
  /** Re-reads the assignment list so the row shows the new submission status. */
  onChanged: () => void;
}

/** One assignment: open or save a draft, submit, resubmit when returned, and read revisions and feedback. */
export function AssignmentDetail({ assignment, onBack, onChanged }: AssignmentDetailProps) {
  const { locale, formatDateTime, formatNumber, copy: shared } = useContentCopy();
  const copy = learningMessages[locale];
  const preview = isPreviewMode();
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const [submissionId, setSubmissionId] = useState<string | null>(assignment.mySubmissionId ?? null);
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState(false);
  // The typed answer survives a failed save or submit, and a trip back to the list.
  const [text, setText] = useState(() => readQueryCache<string>(draftKey(assignment.id)) ?? '');
  const [file, setFile] = useState<PickedFile | null>(null);

  const submissionQuery = useContentQuery<MobileLearningSubmission>(
    `content.learning.submission.${submissionId}.${token}`,
    () => contentApi.learningSubmission(submissionId as string),
    submissionId !== null,
  );
  const revisionsQuery = useContentQuery<MobileLearningRevision[]>(
    `content.learning.revisions.${submissionId}.${token}`,
    () => contentApi.learningRevisions(submissionId as string),
    submissionId !== null,
  );
  const feedbackQuery = useContentQuery<MobileLearningFeedback[]>(
    `content.learning.feedback.${submissionId}.${token}`,
    () => contentApi.learningFeedback(submissionId as string),
    submissionId !== null,
  );

  const submission = submissionQuery.data ?? null;
  const phase = submissionPhase(submission?.status ?? assignment.mySubmissionStatus);
  const canWrite = !preview && assignment.status === 'PUBLISHED' && (submissionId === null || phase === 'draft' || phase === 'returned');
  const late = deadlinePassed(assignment.deadlineAt);
  const revisions = revisionsQuery.data ?? [];
  const feedback = feedbackQuery.data ?? [];

  const changeText = (value: string) => {
    setText(value);
    writeQueryCache(draftKey(assignment.id), value);
  };
  const forgetDraft = () => {
    setFile(null);
    writeQueryCache(draftKey(assignment.id), '');
  };

  const failure = useCallback((error: unknown) => {
    const code = errorCode(error);
    fail(
      code === 'NOT_ENROLLED' || code === 'ENROLLMENT_NOT_ACTIVE' ? copy.notEnrolled
      : code === 'DEADLINE_PASSED' || code === 'ASSIGNMENT_NOT_OPEN' ? copy.pastDeadline
      : contentErrorMessage(shared, error, copy.submitFailed),
    );
  }, [copy, fail, shared]);

  const run = useCallback(async (action: () => Promise<unknown>, ok: string, afterSuccess?: () => void) => {
    if (busy || preview) return;
    setBusy(true);
    clear();
    try {
      await action();
      success(ok);
      afterSuccess?.();
      setToken((value) => value + 1);
      onChanged();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  }, [busy, clear, failure, onChanged, preview, success]);

  const input = () => ({ textBody: text.trim(), ...(file ? { file: toUploadPart(file) } : {}) });
  const needsContent = () => {
    if (hasSubmissionContent(text, file !== null)) return false;
    fail(copy.needContent);
    return true;
  };

  const startDraft = () => void run(async () => {
    const created = await contentApi.learningOpenDraft(assignment);
    setSubmissionId(created.id);
  }, copy.saved);

  const saveDraft = () => {
    if (!submissionId || needsContent()) return;
    void run(() => contentApi.learningSaveDraft(submissionId, input()), copy.saved, forgetDraft);
  };

  const submit = () => {
    if (!submissionId || needsContent()) return;
    ask({
      title: copy.submitTitle,
      description: copy.submitBody,
      confirmLabel: copy.submit,
      cancelLabel: shared.back,
      onConfirm: () => void run(async () => {
        await contentApi.learningSaveDraft(submissionId, input());
        const fresh = await contentApi.learningSubmission(submissionId);
        await contentApi.learningSubmit(assignment.id, fresh.version);
      }, copy.submitted, forgetDraft),
    });
  };

  const resubmit = () => {
    if (!submission || needsContent()) return;
    ask({
      title: copy.submitTitle,
      description: copy.submitBody,
      confirmLabel: copy.resubmit,
      cancelLabel: shared.back,
      onConfirm: () => void run(() => contentApi.learningResubmit(assignment.id, input(), String(submission.version)), copy.submitted, forgetDraft),
    });
  };

  return (
    <DetailFrame title={copy.title} onBack={onBack}
      list={{ data: [...((submissionId !== null) ? cardRows("section-1", revisions, (item, index) => String(item.id ?? index), <>
              <UiText accessibilityRole="header" variant="headlineSmall">{copy.revisions}</UiText>
              {revisions.length === 0 ? <UiText variant="bodySmall" tone="muted">{copy.emptyRevisions}</UiText> : null}
              </>, (revision) => (
                <View key={revision.id} style={{ gap: 4, marginTop: 8 }}>
                  <UiText variant="label">{joinMeta([fillCopy(copy.revision, { n: revision.revisionNo }), formatDateTime(revision.submittedAt)])}</UiText>
                  {revision.textBody ? <UiText variant="bodyMedium">{revision.textBody}</UiText> : null}
                  {revision.fileName ? (
                    <AttachmentRow name={revision.fileName} fetchBytes={() => contentApi.learningDownloadRevision(revision.id)} />
                  ) : null}
                </View>
              ), {}) : []),
...((submissionId !== null) ? cardRows("section-2", feedback, (item, index) => String(item.id ?? index), <>
              <UiText accessibilityRole="header" variant="headlineSmall">{copy.feedback}</UiText>
              {feedback.length === 0 ? <UiText variant="bodySmall" tone="muted">{copy.emptyFeedback}</UiText> : null}
              </>, (entry) => (
                <View key={entry.id} accessible style={{ gap: 2, marginTop: 8 }}>
                  <UiText variant="label">{joinMeta([entry.score != null ? `${copy.score}: ${formatNumber(entry.score)}` : null, formatDateTime(entry.createdAt)])}</UiText>
                  {entry.comment ? <UiText variant="bodyMedium">{entry.comment}</UiText> : null}
                </View>
              ), {}) : [])], keyExtractor: (row) => row.key, renderItem: renderVirtualRow, footer: <>
      {dialog}
    </> }}
    >
      <View style={{ gap: 12 }}>
        <FlashNotice flash={flash} />
        <Card>
          <ContentHero
            title={assignment.title}
            icon="clipboard-text-outline"
            detail={`${copy.deadline}: ${assignment.deadlineAt ? formatDateTime(assignment.deadlineAt) : copy.noDeadline}`}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <StatusChip code={submission?.status ?? assignment.mySubmissionStatus ?? assignment.status} labels={copy.statusLabels} />
            </View>
          </ContentHero>
          {assignment.description ? <UiText variant="bodyLarge" style={{ marginTop: 16 }}>{assignment.description}</UiText> : null}
          <View style={{ gap: 4, marginTop: 8 }}>
            <MetaRow label={copy.maxScore} value={assignment.maxScore != null ? formatNumber(assignment.maxScore) : null} />
          </View>
          {late && canWrite ? <UiText variant="bodySmall" tone="warning" style={{ marginTop: 8 }}>{copy.pastDeadline}</UiText> : null}
        </Card>

        {preview ? <DataNotice message={shared.previewNotice} /> : null}

        {submissionId !== null && submissionQuery.isLoading && !submission ? <StatePanel kind="loading" title={copy.loading} /> : null}
        {submissionId !== null && submissionQuery.error ? (
          <StatePanel kind="error" title={copy.errorTitle} description={submissionQuery.error} actionLabel={copy.retry} onAction={() => void submissionQuery.reload()} />
        ) : null}

        {canWrite && submissionId === null ? (
          <Button label={copy.startDraft} loading={busy} disabled={busy} onPress={startDraft} />
        ) : null}

        {canWrite && submissionId !== null && submission ? (
          <Card>
            <Field
              label={copy.yourAnswer}
              placeholder={copy.answerPlaceholder}
              value={text}
              onChangeText={changeText}
              multiline
              maxLength={TEXT_MAX}
              editable={!busy}
            />
            <FilePicker policy={COURSEWORK_POLICY} file={file} onChange={setFile} disabled={busy} />
            <View style={{ gap: 8, marginTop: 8 }}>
              {phase === 'draft' ? <Button label={copy.saveDraft} variant="secondary" disabled={busy} onPress={saveDraft} /> : null}
              {phase === 'draft' ? <Button label={copy.submit} loading={busy} disabled={busy} onPress={submit} /> : null}
              {phase === 'returned' ? <Button label={copy.resubmit} loading={busy} disabled={busy} onPress={resubmit} /> : null}
            </View>
          </Card>
        ) : null}

        {submissionId !== null ? null : null}</View></DetailFrame>
  );
}
