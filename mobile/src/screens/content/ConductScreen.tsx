import { cardRows } from './content-card-rows';
import { contentRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Card, DataNotice, Divider, MetricCard, ProgressBar, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import { ChartSummary } from '../../components/ui/chart-summary';
import { ChoiceField } from '../../components/ui/choice-field';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from './content-api';
import { joinMeta } from './content-rules';
import { isPreviewMode, useContentCopy } from './content-ui';
import { previewConduct } from './preview-data';
import { conductRankKey, conductSemesterName, conductStatusKey, parseConduct } from './records-model';
import { useContentQuery } from './use-content-query';

function validCertificateUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Conduct score read model: cumulative average, per-term criteria and approved activities. */
export function ConductScreen(_props: MobileScreenProps) {
  const { locale, copy: shared, formatDate, formatNumber, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const preview = isPreviewMode();
  const query = useContentQuery<unknown>('content.conduct', () => contentApi.conduct());
  const [termId, setTermId] = useState('');
  const [certificateErrorId, setCertificateErrorId] = useState<string | null>(null);

  const raw = preview ? previewConduct(locale) : query.data;
  const model = useMemo(() => (raw === undefined ? null : parseConduct(raw)), [raw]);
  const malformed = !preview && query.data !== undefined && model === null;
  const term = model ? model.terms.find((entry) => entry.id === termId) ?? model.terms[0] ?? null : null;
  const semesterLabel = (name: string | null | undefined) => conductSemesterName(name, locale);
  const trend = model ? [...model.terms].reverse().filter((entry) => entry.totalScore !== null).map((entry) => ({ label: semesterLabel(entry.semesterName), value: entry.totalScore as number })) : [];
  const failure = preview ? null : malformed ? copy.conductMalformed : query.error;

  const rankLabel = (classification: string | null, classificationVi: string | null): string => {
    const key = conductRankKey(classification) ?? conductRankKey(classificationVi);
    if (key) return copy.conductClassifications[key];
    const rawLabel = locale === 'vi' ? classificationVi ?? classification : classification ?? classificationVi;
    return rawLabel?.trim() ? rawLabel : copy.conductClassifications.NOT_CLASSIFIED;
  };
  const statusLabel = (status: string | null): string => copy.conductStatuses[conductStatusKey(status)] ?? copy.conductStatuses.UNKNOWN;

  const activities = term?.activities ?? [];
  const bonusPoints = activities.reduce((sum, activity) => sum + (activity.points ?? 0), 0);
  const cumulative = model?.cumulativeAverage ?? null;
  const cumulativeRank = rankLabel(null, model?.cumulativeClassificationVi ?? null);
  const scholarship = cumulative === null ? null : cumulative >= 70;
  const scaleBands = [
    { key: 'XUAT_SAC', range: fillCopy(copy.conductScaleRange, { min: formatNumber(90), max: formatNumber(100) }), note: copy.conductNotePriority, tone: 'success' as const },
    { key: 'TOT', range: fillCopy(copy.conductScaleRange, { min: formatNumber(80), max: formatNumber(89) }), note: copy.conductNoteReady, tone: 'primary' as const },
    { key: 'KHA', range: fillCopy(copy.conductScaleRange, { min: formatNumber(65), max: formatNumber(79) }), note: copy.conductNoteCompleted, tone: 'warning' as const },
    { key: 'TRUNG_BINH', range: fillCopy(copy.conductScaleRange, { min: formatNumber(50), max: formatNumber(64) }), note: copy.conductNoteMeets, tone: 'neutral' as const },
    { key: 'YEU', range: fillCopy(copy.conductScaleBelow, { n: formatNumber(50) }), note: copy.conductNoteWarning, tone: 'neutral' as const },
  ];

  return (
    <ScreenShell title={copy.conductTitle}
      list={{ data: [...((!preview && query.isLoading) ? [] : (failure) ? [] : (!model || (model.terms.length === 0 && model.cumulativeAverage === null)) ? [] : (term) ? cardRows("section-1", (term.activities.length === 0) ? [] : term.activities, (item, index) => String(item.id ?? index), <>
              <UiText accessibilityRole="header" variant="headlineSmall">{semesterLabel(term.semesterName)}</UiText>
              <UiText variant="bodyMedium" tone="primary">
                {joinMeta([
                  `${copy.conductTotal}: ${formatNumber(term.totalScore, { maximumFractionDigits: 1 })}`,
                  rankLabel(term.classification, term.classificationVi),
                ])}
              </UiText>
              <View style={styles.termMeta}>
                {term.status ? <StatusPill label={`${copy.conductStatus}: ${statusLabel(term.status)}`} tone={conductStatusKey(term.status) === 'APPROVED' ? 'success' : 'neutral'} /> : null}
                {term.evaluatorName ? <UiText variant="bodySmall" tone="muted">{`${copy.conductEvaluator}: ${term.evaluatorName}`}</UiText> : null}
              </View>
              <SectionHeading title={copy.conductCriteria} />
              {term.criteria.length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.conductNoCriteria}</UiText>
              ) : term.criteria.map((criterion) => {
                const name = locale === 'vi' ? criterion.nameVi ?? criterion.code : criterion.nameEn ?? criterion.nameVi ?? criterion.code;
                const description = criterion.description ?? copy.conductCriteriaDescriptions[criterion.code] ?? '—';
                const ratio = criterion.maxScore > 0 ? Math.round((criterion.score / criterion.maxScore) * 100) : 0;
                return (
                  <View
                    key={criterion.code}
                    accessible
                    accessibilityLabel={`${name}, ${formatNumber(criterion.score)} / ${formatNumber(criterion.maxScore)} ${copy.conductScoreUnit}, ${copy.conductReached} ${ratio}%`}
                    style={styles.criterion}
                  >
                    <UiText variant="bodyMedium">{name}</UiText>
                    <UiText variant="bodySmall" tone="muted">{description}</UiText>
                    <UiText variant="meta" tone="muted">{`${formatNumber(criterion.score)} / ${formatNumber(criterion.maxScore)} ${copy.conductScoreUnit} · ${copy.conductReached} ${ratio}%`}</UiText>
                    <ProgressBar value={ratio} />
                  </View>
                );
              })}
              <Divider />
              <SectionHeading title={copy.conductActivities} />
              {term.activities.length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.conductNoActivities}</UiText>
              ) : <UiText variant="meta" tone="muted">{fillCopy(copy.conductActivityCount, { n: formatNumber(term.activities.length) })}</UiText>}</>, (activity) => (
              <View key={activity.id} style={styles.activity}>
                <View
                  accessible
                  accessibilityLabel={joinMeta([activity.title, activity.category, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null])}
                  style={styles.activityCopy}
                >
                  <UiText variant="label">{activity.title}</UiText>
                  <UiText variant="bodySmall" tone="muted">
                    {joinMeta([activity.category, activity.organizer, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null])}
                  </UiText>
                </View>
                {validCertificateUrl(activity.certificateUrl) ? (
                  <Button
                    label={copy.conductCertificate}
                    accessibilityLabel={`${copy.conductCertificate}: ${activity.title}`}
                    variant="text"
                    onPress={() => {
                      const url = validCertificateUrl(activity.certificateUrl);
                      if (!url) return;
                      setCertificateErrorId(null);
                      void Linking.openURL(url).catch(() => setCertificateErrorId(activity.id));
                    }}
                  />
                ) : null}
                {certificateErrorId === activity.id ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{copy.conductCertificateOpenFailed}</UiText> : null}
              </View>
              ), {}) : [])], keyExtractor: (row) => row.key, renderItem: renderVirtualRow, footer: <>
    </> }}
    >
      {query.warning && !preview ? <View style={styles.notice}><DataNotice message={query.warning} /></View> : null}
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : (<>{failure ? (
        <StatePanel kind="error" title={shared.errorTitle} description={failure} actionLabel={t('retry')} onAction={() => void query.reload()} />
      ) : (<>{!model || (model.terms.length === 0 && model.cumulativeAverage === null) ? (
        <StatePanel kind="empty" title={copy.conductEmpty} />
      ) : (<><View style={styles.stack}>
          <View style={styles.metrics}>
            <MetricCard
              label={copy.conductCurrentTerm}
              value={formatNumber(term?.totalScore, { maximumFractionDigits: 1 })}
              detail={term ? `${semesterLabel(term.semesterName)} · ${rankLabel(term.classification, term.classificationVi)}` : undefined}
              style={styles.metric}
            />
            <MetricCard
              label={copy.conductCumulative}
              value={formatNumber(cumulative, { maximumFractionDigits: 1 })}
              detail={`${copy.conductRankPrefix} ${cumulativeRank}`}
              style={styles.metric}
            />
            <MetricCard
              label={copy.conductActivitiesTitle}
              value={formatNumber(activities.length)}
              detail={`+${formatNumber(bonusPoints, { maximumFractionDigits: 1 })} ${copy.conductBonusPoints}`}
              style={styles.metric}
            />
          </View>
          <View style={styles.scholarshipRow} accessible accessibilityLabel={`${copy.conductScholarshipCheck} ${scholarship === null ? '—' : scholarship ? copy.conductEligible : copy.conductScholarshipBelow}. ${copy.conductRequirement}`}>
            <UiText variant="bodySmall" tone="muted">{copy.conductScholarshipCheck}</UiText>
            {scholarship === null
              ? <UiText variant="bodySmall">—</UiText>
              : <StatusPill label={scholarship ? copy.conductEligible : copy.conductScholarshipBelow} tone={scholarship ? 'success' : 'neutral'} />}
            <UiText variant="meta" tone="muted">{`(${copy.conductRequirement})`}</UiText>
          </View>
          <Card>
            <UiText accessibilityRole="header" variant="headlineSmall">{copy.conductScaleTitle}</UiText>
            {scaleBands.map((band) => (
              <View key={band.key} style={styles.scaleRow} accessible accessibilityLabel={`${copy.conductClassifications[band.key]}, ${band.range}, ${band.note}`}>
                <StatusPill label={copy.conductClassifications[band.key]} tone={band.tone} />
                <UiText variant="meta" style={styles.scaleRange}>{band.range}</UiText>
                <UiText variant="bodySmall" tone="muted" style={styles.scaleNote}>{band.note}</UiText>
              </View>
            ))}
          </Card>
          {trend.length > 1 ? <ChartSummary title={copy.conductHistory} series={trend} /> : null}
          {model.terms.length > 0 ? (
            <ChoiceField
              label={copy.conductTerm}
              display="sheet"
              value={term?.id ?? ''}
              options={model.terms.map((entry) => ({ value: entry.id, label: semesterLabel(entry.semesterName) }))}
              onChange={setTermId}
            />
          ) : null}
          </View></>)}</>)}</>)}</ScreenShell>
  );
}

const styles = StyleSheet.create({
  notice: { marginBottom: tokens.spacing.sm },
  stack: { gap: tokens.spacing.md },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  metric: { flexBasis: 150, flexGrow: 1 },
  scholarshipRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  scaleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  scaleRange: { fontVariant: ['tabular-nums'] },
  scaleNote: { flex: 1, minWidth: 120 },
  criterion: { gap: 2, marginBottom: tokens.spacing.sm },
  termMeta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  activity: { gap: 2, minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.xs },
  activityCopy: { gap: 2 },
});
