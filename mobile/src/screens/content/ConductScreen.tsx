import { cardRows, contentRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, DataNotice, Divider, MetricCard, ProgressBar, SectionHeading, StatePanel, UiText } from '../../components/Ui';
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
import { parseConduct } from './records-model';
import { useContentQuery } from './use-content-query';

/** Conduct score read model: cumulative average, per-term criteria and recorded activities. */
export function ConductScreen(_props: MobileScreenProps) {
  const { locale, copy: shared, formatDate, formatNumber, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const preview = isPreviewMode();
  const query = useContentQuery<unknown>('content.conduct', () => contentApi.conduct());
  const [termId, setTermId] = useState('');

  const raw = preview ? previewConduct(locale) : query.data;
  const model = useMemo(() => (raw === undefined ? null : parseConduct(raw)), [raw]);
  const malformed = !preview && query.data !== undefined && model === null;
  const term = model ? model.terms.find((entry) => entry.id === termId) ?? model.terms[0] ?? null : null;
  const trend = model ? [...model.terms].reverse().filter((entry) => entry.totalScore !== null).map((entry) => ({ label: entry.semesterName, value: entry.totalScore as number })) : [];
  const failure = preview ? null : malformed ? copy.conductMalformed : query.error;

  return (
    <ScreenShell title={copy.conductTitle}
      list={{ data: [...((!preview && query.isLoading) ? [] : (failure) ? [] : (!model || (model.terms.length === 0 && model.cumulativeAverage === null)) ? [] : (term) ? cardRows("section-1", (term.activities.length === 0) ? [] : term.activities, (item, index) => String(item.id ?? index), <>
              <UiText accessibilityRole="header" variant="headlineSmall">{term.semesterName}</UiText>
              <UiText variant="bodyMedium" tone="primary">
                {joinMeta([
                  `${copy.conductTotal}: ${formatNumber(term.totalScore, { maximumFractionDigits: 1 })}`,
                  locale === 'vi' ? term.classificationVi ?? term.classification : term.classification ?? term.classificationVi,
                ])}
              </UiText>
              <UiText variant="bodySmall" tone="muted">
                {joinMeta([
                  term.status ? `${copy.conductStatus}: ${term.status}` : null,
                  term.evaluatorName ? `${copy.conductEvaluator}: ${term.evaluatorName}` : null,
                ])}
              </UiText>
              <SectionHeading title={copy.conductCriteria} />
              {term.criteria.length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.conductNoCriteria}</UiText>
              ) : term.criteria.map((criterion) => (
                <ProgressBar
                  key={criterion.code}
                  label={`${locale === 'vi' ? criterion.nameVi ?? criterion.code : criterion.nameEn ?? criterion.code} (${formatNumber(criterion.score)}/${formatNumber(criterion.maxScore)})`}
                  value={criterion.maxScore > 0 ? (criterion.score / criterion.maxScore) * 100 : 0}
                />
              ))}
              <Divider />
              <SectionHeading title={copy.conductActivities} />
              {term.activities.length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.conductNoActivities}</UiText>
              ) : null}</>, (activity) => (
                <View
                  key={activity.id}
                  accessible
                  accessibilityLabel={joinMeta([activity.title, activity.category, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null])}
                  style={styles.activity}
                >
                  <UiText variant="label">{activity.title}</UiText>
                  <UiText variant="bodySmall" tone="muted">
                    {joinMeta([activity.category, activity.organizer, activity.activityDate ? formatDate(activity.activityDate) : null, activity.points != null ? fillCopy(copy.conductPoints, { n: formatNumber(activity.points) }) : null])}
                  </UiText>
                </View>
              ), {}) : [])], keyExtractor: (row) => row.key, renderItem: renderVirtualRow, footer: <>
    </> }}
    >
      {query.warning && !preview ? <DataNotice message={query.warning} /> : null}
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : (<>{failure ? (
        <StatePanel kind="error" title={shared.errorTitle} description={failure} actionLabel={t('retry')} onAction={() => void query.reload()} />
      ) : (<>{!model || (model.terms.length === 0 && model.cumulativeAverage === null) ? (
        <StatePanel kind="empty" title={copy.conductEmpty} />
      ) : (<><View style={styles.stack}>
          <MetricCard
            label={copy.conductCumulative}
            value={formatNumber(model.cumulativeAverage, { maximumFractionDigits: 1 })}
            detail={model.cumulativeClassificationVi ?? undefined}
          />
          {trend.length > 1 ? <ChartSummary title={copy.conductHistory} series={trend} /> : null}
          {model.terms.length > 0 ? (
            <ChoiceField
              label={copy.conductTerm}
              display="sheet"
              value={term?.id ?? ''}
              options={model.terms.map((entry) => ({ value: entry.id, label: entry.semesterName }))}
              onChange={setTermId}
            />
          ) : null}
          {term ? null : null}</View></>)}</>)}</>)}</ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: tokens.spacing.md },
  activity: { gap: 2, minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.xs },
});
