import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { StatePanel, UiText } from '../../components/Ui';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { LanesCopy } from '../../i18n/lanes-messages';
import { laneApi, type AdmissionApp, type CareerApp, type LoanRequest } from './lane-api';
import {
  CAREERS_NEXT_STATUS,
  NEEDS_TEXT,
  admissionsActions,
  careersActions,
  libraryActions,
  type QueueAction,
} from './lane-model';
import {
  ConfirmSheet,
  LaneShell,
  QueueCard,
  StatusFilter,
  laneStyles,
  useActionRunner,
  useLaneRequest,
  useLanesCopy,
  type ActionRunner,
  type PendingAction,
} from './lane-ui';
import { HandoffLink } from './HandoffLink';

interface DeskProps<T extends { id: string }> {
  title: string;
  copy: LanesCopy;
  statuses: readonly string[];
  items: readonly T[];
  loading: boolean;
  error: string | null;
  status: string;
  onStatus: (value: string) => void;
  onReload: () => void;
  runner: ActionRunner;
  webPath: string;
  renderItem: (item: T) => ReactNode;
}

/** Queue frame shared by the three staff desks: status filter, list, confirmation sheet, web hand-off. */
function Desk<T extends { id: string }>({ title, copy, statuses, items, loading, error, status, onStatus, onReload, runner, webPath, renderItem }: DeskProps<T>) {
  return (
    <LaneShell title={title} loading={loading} error={error} onRetry={onReload} banner={runner.banner}>
      <View>
        <StatusFilter copy={copy} statuses={statuses} value={status} onChange={onStatus} />
        {items.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}
        <View style={laneStyles.stack}>{items.map(renderItem)}</View>
        <UiText variant="bodySmall" tone="muted">{copy.webForAttachments}</UiText>
        <HandoffLink label={copy.openOnWeb} path={webPath} />
      </View>
      <ConfirmSheet runner={runner} copy={copy} />
    </LaneShell>
  );
}

const ACTION_LABEL = (copy: LanesCopy, action: QueueAction): string => ({
  claim: copy.claim,
  return: copy.returnApplication,
  accept: copy.accept,
  reject: copy.reject,
  approve: copy.approve,
  issue: copy.issue,
  returnLoan: copy.returnLoan,
  cancel: copy.cancelRequest,
  toReviewing: copy.toReviewing,
  toInterview: copy.toInterview,
  toOffer: copy.toOffer,
})[action];

const action = (copy: LanesCopy, kind: QueueAction, subject: string, run: (text: string) => Promise<unknown>): PendingAction => ({
  label: ACTION_LABEL(copy, kind),
  subject,
  needsText: NEEDS_TEXT.has(kind),
  textLabel: kind === 'return' ? copy.note : copy.reason,
  run,
});

export function ApplyReviewScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const [status, setStatus] = useState('');
  const request = useLaneRequest(() => laneApi.admissionsQueue(status || undefined), `apply:${status}`);
  const runner = useActionRunner(copy, () => void request.reload());
  const items = useMemo(() => request.data ?? [], [request.data]);

  const run = (kind: QueueAction, row: AdmissionApp): PendingAction => {
    const subject = row.fullName ?? row.applicantEmail ?? row.id;
    if (kind === 'claim') return action(copy, kind, subject, () => laneApi.admissionsClaim(row));
    if (kind === 'return') return action(copy, kind, subject, (text) => laneApi.admissionsReturn(row, text));
    return action(copy, kind, subject, () => laneApi.admissionsDecide(row, kind === 'accept' ? 'ACCEPTED' : 'REJECTED'));
  };

  return (
    <Desk<AdmissionApp>
      title={copy.titles['staff.applyReview']}
      copy={copy}
      statuses={['SUBMITTED', 'IN_REVIEW', 'RETURNED', 'ACCEPTED', 'REJECTED']}
      items={items}
      loading={request.loading}
      error={request.error}
      status={status}
      onStatus={setStatus}
      onReload={() => void request.reload()}
      runner={runner}
      webPath="/apply/review"
      renderItem={(row) => (
        <QueueCard
          key={row.id}
          title={row.fullName ?? row.applicantEmail ?? row.id}
          status={row.status}
          copy={copy}
          lines={[
            row.applicantEmail,
            row.intendedMajor ? `${copy.major}: ${row.intendedMajor}` : null,
            row.submittedAt ? `${copy.submittedAt}: ${formatDateTime(row.submittedAt)}` : null,
            fillCopy(copy.attachments, { n: row.attachments?.length ?? 0 }),
          ]}
          actions={admissionsActions(row.status).map((kind) => ({
            key: kind,
            label: ACTION_LABEL(copy, kind),
            variant: kind === 'accept' ? 'primary' : kind === 'reject' || kind === 'return' ? 'destructive' : 'secondary',
            onPress: () => runner.request(run(kind, row)),
          }))}
        />
      )}
    />
  );
}

export function CareersDeskScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const [status, setStatus] = useState('');
  const request = useLaneRequest(() => laneApi.careersApplications(status || undefined), `careers:${status}`);
  const runner = useActionRunner(copy, () => void request.reload());
  const items = useMemo(() => request.data ?? [], [request.data]);

  const run = (kind: QueueAction, row: CareerApp): PendingAction => {
    const subject = `${row.candidateEmail ?? row.id} · ${row.opportunityTitle ?? ''}`.trim();
    if (kind === 'reject') return action(copy, kind, subject, (text) => laneApi.careersReject(row, text));
    return action(copy, kind, subject, () => laneApi.careersTransition(row, CAREERS_NEXT_STATUS[kind]));
  };

  return (
    <Desk<CareerApp>
      title={copy.titles['staff.careersDesk']}
      copy={copy}
      statuses={['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN']}
      items={items}
      loading={request.loading}
      error={request.error}
      status={status}
      onStatus={setStatus}
      onReload={() => void request.reload()}
      runner={runner}
      webPath="/careers/desk"
      renderItem={(row) => (
        <QueueCard
          key={row.id}
          title={row.opportunityTitle ?? row.id}
          status={row.status}
          copy={copy}
          lines={[
            row.organizationName ? `${copy.organization}: ${row.organizationName}` : null,
            row.candidateEmail ? `${copy.candidate}: ${row.candidateEmail}` : null,
            row.submittedAt ? `${copy.submittedAt}: ${formatDateTime(row.submittedAt)}` : null,
            fillCopy(copy.attachments, { n: row.attachments?.length ?? 0 }),
          ]}
          actions={careersActions(row.status).map((kind) => ({
            key: kind,
            label: ACTION_LABEL(copy, kind),
            variant: kind === 'toOffer' ? 'primary' : kind === 'reject' ? 'destructive' : 'secondary',
            onPress: () => runner.request(run(kind, row)),
          }))}
        />
      )}
    />
  );
}

export function LibraryDeskScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const [status, setStatus] = useState('');
  const request = useLaneRequest(() => laneApi.libraryRequests(status || undefined), `library:${status}`);
  const runner = useActionRunner(copy, () => void request.reload());
  const items = useMemo(() => request.data ?? [], [request.data]);

  const run = (kind: QueueAction, row: LoanRequest): PendingAction => {
    const subject = `${row.title ?? row.id} · ${row.borrowerEmail ?? ''}`.trim();
    switch (kind) {
      case 'approve': return action(copy, kind, subject, () => laneApi.libraryApprove(row));
      case 'issue': return action(copy, kind, subject, () => laneApi.libraryIssue(row));
      case 'returnLoan': return action(copy, kind, subject, () => laneApi.libraryReturn(row));
      default: return action(copy, 'cancel', subject, (text) => laneApi.libraryCancel(row, text));
    }
  };

  return (
    <Desk<LoanRequest>
      title={copy.titles['staff.libraryDesk']}
      copy={copy}
      statuses={['REQUESTED', 'APPROVED', 'ISSUED', 'RETURNED', 'CANCELLED']}
      items={items}
      loading={request.loading}
      error={request.error}
      status={status}
      onStatus={setStatus}
      onReload={() => void request.reload()}
      runner={runner}
      webPath="/library/desk"
      renderItem={(row) => (
        <QueueCard
          key={row.id}
          title={row.title ?? row.id}
          status={row.status}
          copy={copy}
          lines={[
            row.borrowerEmail ? `${copy.borrower}: ${row.borrowerEmail}` : null,
            row.barcode,
            row.dueAt ? `${copy.dueAt}: ${formatDateTime(row.dueAt)}` : null,
          ]}
          actions={libraryActions(row.status).map((kind) => ({
            key: kind,
            label: ACTION_LABEL(copy, kind),
            variant: kind === 'approve' || kind === 'issue' ? 'primary' : kind === 'cancel' ? 'destructive' : 'secondary',
            onPress: () => runner.request(run(kind, row)),
          }))}
        />
      )}
    />
  );
}
