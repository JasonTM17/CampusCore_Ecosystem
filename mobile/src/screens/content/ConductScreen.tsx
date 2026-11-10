import { cardRows } from './content-card-rows';
import { contentRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

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
import { academicApi } from '../academic/academic-api';
import { localizedName } from '../academic/academic-model';
import { useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';
import { conductRankKey, conductSemesterName, conductStatusKey, parseConduct, type ConductActivity, type ConductTerm } from './records-model';
import { ConductActivityDetailSheet } from './ConductActivityDetailSheet';
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
  const { copy: academicCopy } = useAcademicCopy();
  const query = useContentQuery<unknown>('content.conduct', () => contentApi.conduct());
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), academicCopy, !preview);
  const [selectedSemesterId, setSelectedSemesterId] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<ConductActivity | null>(null);
  const [certificateErrorId, setCertificateErrorId] = useState<string | null>(null);

  const raw = preview ? previewConduct(locale) : query.data;
  const model = useMemo(() => (raw === undefined ? null : parseConduct(raw)), [raw]);
  const malformed = !preview && query.data !== undefined && model === null;
  const semesterLabel = (name: string | null | undefined) => conductSemesterName(name, locale);
  const rankLabel = (classification: string | null, classificationVi: string | null): string => {
    const key = conductRankKey(classification) ?? conductRankKey(classificationVi);
    if (key) return copy.conductClassifications[key];
    const rawLabel = locale === 'vi' ? classificationVi ?? classification : classification ?? classificationVi;
    return rawLabel?.trim() ? rawLabel : copy.conductClassifications.NOT_CLASSIFIED;
  };
  const termKey = (entry: ConductTerm) => entry.semesterId ?? entry.id;
  const recordBySemester = useMemo(() => {
    const map = new Map<string, ConductTerm>();
    for (const entry of model?.terms ?? []) map.set(termKey(entry), entry);
    return map;
  }, [model?.terms]);
  const semesterOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { value: string; label: string; record?: ConductTerm }[] = [];
    for (const semester of preview ? [] : semestersQuery.data ?? []) {
      seen.add(semester.id);
      const record = recordBySemester.get(semester.id);
      const name = localizedName(semester, locale, semester.name ?? semester.id);
      options.push({
        value: semester.id,
        label: record?.totalScore == null
          ? conductSemesterName(name, locale)
          : `${conductSemesterName(name, locale)} (${formatNumber(record.totalScore)} ${copy.conductScoreUnit} - ${rankLabel(record.classification, record.classificationVi)})`,
        record,
      });
    }
    for (const entry of model?.terms ?? []) {
      const key = termKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: key,
        label: entry.totalScore == null
          ? semesterLabel(entry.semesterName)
          : `${semesterLabel(entry.semesterName)} (${formatNumber(entry.totalScore)} ${copy.conductScoreUnit} - ${rankLabel(entry.classification, entry.classificationVi)})`,
        record: entry,
      });
    }
    return options;
  }, [copy.conductClassifications, copy.conductScoreUnit, formatNumber, locale, model?.terms, preview, recordBySemester, semestersQuery.data]);
  useEffect(() => {
    if (!model || semesterOptions.length === 0) return;
    if (selectedSemesterId && semesterOptions.some((option) => option.value === selectedSemesterId)) return;
    const preferred =
      recordBySemester.keys().next().value
      ?? semesterOptions[0]?.value
      ?? '';
    if (preferred) setSelectedSemesterId(preferred);
  }, [model, recordBySemester, selectedSemesterId, semesterOptions]);
  const term = model
    ? recordBySemester.get(selectedSemesterId)
      ?? (selectedSemesterId ? null : model.terms[0] ?? null)
    : null;
  const trend = model ? [...model.terms].reverse().filter((entry) => entry.totalScore !== null).map((entry) => ({ label: semesterLabel(entry.semesterName), value: entry.totalScore as number })) : [];
  const failure = preview ? null : malformed ? copy.conductMalformed : query.error;
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
    <>
    <ScreenShell title={copy.conductTitle} eyebrow={copy.conductEyebrow} subtitle={copy.conductDescription}
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
              <UiText variant="bodySmall" tone="muted">{`${copy.conductEarned}: ${formatNumber(term.totalScore)} / 100`}</UiText>
              {term.criteria.length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.conductNoCriteria}</UiText>
              ) : term.criteria.map((criterion, index) => {
                const name = locale === 'vi' ? criterion.nameVi ?? criterion.code : criterion.nameEn ?? criterion.nameVi ?? criterion.code;
                const description = criterion.description ?? copy.conductCriteriaDescriptions[criterion.code] ?? '—';
                const ratio = criterion.maxScore > 0 ? Math.round((criterion.score / criterion.maxScore) * 100) : 0;
                return (
                  <View
                    key={criterion.code}
                    accessible
                    accessibilityLabel={`${index + 1}. ${name}, ${formatNumber(criterion.score)} / ${formatNumber(criterion.maxScore)} ${copy.conductScoreUnit}, ${copy.conductReached} ${ratio}%`}
                    style={styles.criterion}
                  >
                    <View style={styles.criterionHead}>
                      <UiText variant="label" tone="primary" style={styles.criterionIndex}>{index + 1}</UiText>
                      <View style={styles.criterionCopy}>
                        <UiText variant="bodyMedium">{name}</UiText>
                        <UiText variant="bodySmall" tone="muted">{description}</UiText>
                      </View>
                    </View>
                    <UiText variant="meta" tone="muted">{`${formatNumber(criterion.score)} / ${formatNumber(criterion.maxScore)} ${copy.conductScoreUnit} · ${copy.conductReached} ${ratio}%`}</UiText>
                    <ProgressBar value={ratio} />
                  </View>
                );
              })}
              <Divider />
              <SectionHeading title={copy.conductActivities} />
              {term.activities.length === 0 ? (
                <View style={styles.emptyActivities}>
                  <UiText variant="bodySmall" tone="muted">{copy.conductNoActivities}</UiText>
                  <UiText variant="bodySmall" tone="muted">{copy.conductActivitiesEmptyDescription}</UiText>
                </View>
              ) : <UiText variant="meta" tone="muted">{fillCopy(copy.conductActivityCount, { n: formatNumber(term.activities.length) })}</UiText>}</>, (activity) => (
              <View key={activity.id} style={styles.activity}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.conductActivityOpenDetail}, ${joinMeta([activity.title, activity.category, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null, term.status === 'APPROVED' ? copy.conductApprovedBadge : statusLabel(term.status)])}`}
                  onPress={() => {
                    setCertificateErrorId(null);
                    setSelectedActivity(activity);
                  }}
                  style={styles.activityPress}
                >
                  <View style={styles.activityCopy}>
                    <UiText variant="label">{activity.title}</UiText>
                    <UiText variant="bodySmall" tone="muted">
                      {joinMeta([activity.category, activity.organizer, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null])}
                    </UiText>
                  </View>
                </Pressable>
                <StatusPill label={term.status === 'APPROVED' ? copy.conductApprovedBadge : statusLabel(term.status)} tone={term.status === 'APPROVED' ? 'success' : 'neutral'} />
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
          {model.terms.length > 0 ? (
            <Card>
              <UiText accessibilityRole="header" variant="headlineSmall">{copy.conductHistory}</UiText>
              <View style={styles.historyHeader}>
                <UiText variant="meta" tone="muted" style={styles.historySemester}>{copy.conductHistorySemester}</UiText>
                <UiText variant="meta" tone="muted">{copy.conductHistoryTotal}</UiText>
                <UiText variant="meta" tone="muted">{copy.conductHistoryRank}</UiText>
                <UiText variant="meta" tone="muted">{copy.conductHistoryStatus}</UiText>
              </View>
              {model.terms.map((entry) => {
                const rankKey = conductRankKey(entry.classification) ?? conductRankKey(entry.classificationVi);
                const rank = rankLabel(entry.classification, entry.classificationVi);
                const status = entry.status === 'APPROVED' ? copy.conductOfficial : statusLabel(entry.status);
                return (
                  <View
                    key={entry.id}
                    accessible
                    accessibilityLabel={joinMeta([semesterLabel(entry.semesterName), `${formatNumber(entry.totalScore)} ${copy.conductScoreUnit}`, rank, status])}
                    style={styles.historyRow}
                  >
                    <UiText variant="bodySmall" style={styles.historySemester}>{semesterLabel(entry.semesterName)}</UiText>
                    <UiText variant="label">{formatNumber(entry.totalScore)}</UiText>
                    <StatusPill label={rank} tone={rankKey === 'XUAT_SAC' ? 'success' : rankKey === 'TOT' ? 'primary' : rankKey === 'KHA' ? 'warning' : 'neutral'} />
                    <StatusPill label={status} tone={entry.status === 'APPROVED' ? 'success' : 'neutral'} />
                  </View>
                );
              })}
            </Card>
          ) : null}
          {trend.length > 1 ? <ChartSummary title={copy.conductHistory} series={trend} /> : null}
          {semesterOptions.length > 0 ? (
            <ChoiceField
              label={copy.conductTerm}
              display="sheet"
              value={selectedSemesterId}
              options={semesterOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
              onChange={setSelectedSemesterId}
            />
          ) : null}
          </View></>)}</>)}</>)}</ScreenShell>
    <ConductActivityDetailSheet
      activity={selectedActivity}
      termStatus={term?.status ?? null}
      studentCode={model?.studentCode ?? null}
      fullName={model?.fullName ?? null}
      certificateError={selectedActivity ? certificateErrorId === selectedActivity.id : false}
      onClose={() => setSelectedActivity(null)}
      onOpenCertificate={(url) => {
        setCertificateErrorId(null);
        void Linking.openURL(url).catch(() => {
          if (selectedActivity) setCertificateErrorId(selectedActivity.id);
        });
      }}
    />
    </>
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
  criterionHead: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: 2 },
  criterionIndex: { fontVariant: ['tabular-nums'], minWidth: 20 },
  criterionCopy: { flex: 1, gap: 2, minWidth: 0 },
  emptyActivities: { gap: 2 },
  historyHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  historyRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  historySemester: { flex: 1, minWidth: 96 },
  termMeta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  activity: { gap: 2, minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.xs },
  activityPress: { flex: 1, minHeight: tokens.layout.touchTarget, minWidth: 0 },
  activityCopy: { gap: 2, minWidth: 0 },
});
