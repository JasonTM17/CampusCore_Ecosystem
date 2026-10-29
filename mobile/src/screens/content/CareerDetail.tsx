import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, UiText } from '../../components/Ui';
import { StatusPill } from '../../components/ui/index';
import type { MobileCareerOpportunity } from '../../api/client';
import { careersMessages } from '../../i18n/careers-messages';
import { DOCUMENT_POLICY } from './attachment-transfer';
import { contentApi, type CareerApplicationView } from './content-api';
import { isApplicationWithdrawable } from './content-rules';
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

const COVER_LETTER_MAX = 4000;

export interface OpportunityDetailProps {
  opportunity: MobileCareerOpportunity;
  /** The student already has a live application for this posting. */
  alreadyApplied: boolean;
  busy: boolean;
  preview: boolean;
  flash: Flash | null;
  onBack: () => void;
  onApply: (coverLetter: string) => void;
}

export function OpportunityDetail({ opportunity, alreadyApplied, busy, preview, flash, onBack, onApply }: OpportunityDetailProps) {
  const { locale, formatDate } = useContentCopy();
  const copy = careersMessages[locale];
  const [coverLetter, setCoverLetter] = useState('');
  const open = opportunity.status === 'PUBLISHED';

  return (
    <DetailFrame title={copy.title} onBack={onBack}>
      <View style={{ gap: 12 }}>
        <FlashNotice flash={flash} />
        <Card>
          <ContentHero title={opportunity.title} icon="briefcase-outline" detail={opportunity.organizationName ?? undefined}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              {!open ? <StatusPill label={copy.notOpen} tone="warning" /> : null}
              {alreadyApplied ? <StatusPill label={copy.alreadyApplied} tone="success" /> : null}
            </View>
          </ContentHero>
          {opportunity.description ? <UiText variant="bodyLarge" style={{ marginTop: 16 }}>{opportunity.description}</UiText> : null}
          <View style={{ gap: 4, marginTop: 8 }}>
            <MetaRow label={copy.organization} value={opportunity.organizationName} />
            <MetaRow label={copy.location} value={opportunity.location} />
            <MetaRow label={copy.employmentType} value={opportunity.employmentType} />
            <MetaRow label={copy.salary} value={opportunity.salaryText} />
            <MetaRow label={copy.postedAt} value={opportunity.publishedAt ? formatDate(opportunity.publishedAt) : null} />
          </View>
        </Card>
        {!open ? (
          <UiText variant="label" tone="warning">{copy.notOpen}</UiText>
        ) : alreadyApplied ? (
          <UiText variant="label" tone="success">{copy.alreadyApplied}</UiText>
        ) : (
          <Card>
            <Field
              label={copy.coverLetter}
              placeholder={copy.coverLetterPlaceholder}
              value={coverLetter}
              onChangeText={setCoverLetter}
              multiline
              maxLength={COVER_LETTER_MAX}
              editable={!busy}
            />
            <Button label={copy.apply} loading={busy} disabled={busy || preview} onPress={() => onApply(coverLetter.trim())} />
          </Card>
        )}
      </View>
    </DetailFrame>
  );
}

export interface ApplicationDetailProps {
  application: CareerApplicationView;
  busy: boolean;
  preview: boolean;
  flash: Flash | null;
  onBack: () => void;
  onWithdraw: (application: CareerApplicationView) => void;
  /** Called after an attachment upload so the list can be re-read. */
  onUploaded: () => void;
}

export function ApplicationDetail({ application, busy, preview, flash, onBack, onWithdraw, onUploaded }: ApplicationDetailProps) {
  const { locale, formatDate, copy: shared } = useContentCopy();
  const copy = careersMessages[locale];
  const attachments = application.attachments ?? [];
  const active = isApplicationWithdrawable(application);

  return (
    <DetailFrame title={copy.myApplications} onBack={onBack}>
      <View style={{ gap: 12 }}>
        <FlashNotice flash={flash} />
        <Card>
          <ContentHero
            title={application.opportunityTitle ?? application.opportunityId}
            icon="briefcase-check-outline"
            detail={application.organizationName ?? undefined}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <StatusChip code={application.status} labels={copy.statusLabels} />
            </View>
          </ContentHero>
          <View style={{ gap: 4 }}>
            <MetaRow label={copy.organization} value={application.organizationName} />
            <MetaRow label={copy.submittedAt} value={application.submittedAt ? formatDate(application.submittedAt) : null} />
            <MetaRow label={copy.reason} value={application.moderationReason} />
          </View>
          {application.coverLetter ? <UiText variant="bodyLarge" style={{ marginTop: 16 }}>{application.coverLetter}</UiText> : null}
        </Card>
        <Card>
          <UiText accessibilityRole="header" variant="headlineSmall">{shared.attachments}</UiText>
          {attachments.length === 0 ? <UiText variant="bodySmall" tone="muted">{shared.noAttachments}</UiText> : null}
          {attachments.map((file) => (
            <AttachmentRow
              key={file.id}
              name={file.fileName ?? file.id}
              sizeBytes={file.sizeBytes}
              fetchBytes={() => contentApi.careersDownload(application.id, file.id)}
            />
          ))}
          {active && !preview ? (
            <UploadPicker
              intent={`careers:${application.id}`}
              policy={DOCUMENT_POLICY}
              disabled={busy}
              upload={(part, key) => contentApi.careersUpload(application.id, part, key)}
              onUploaded={onUploaded}
            />
          ) : null}
        </Card>
        {active ? (
          <Button label={copy.withdraw} variant="secondary" loading={busy} disabled={busy || preview} onPress={() => onWithdraw(application)} />
        ) : null}
      </View>
    </DetailFrame>
  );
}
