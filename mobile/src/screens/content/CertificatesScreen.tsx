import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ProgressBar, ScreenShell, StatePanel, UiText } from '../../components/Ui';
import { apiClient } from '../../api/client';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi } from '../academic/academic-api';
import { contentApi } from './content-api';
import { MetaRow, isPreviewMode, useContentCopy } from './content-ui';
import { previewConduct, previewCurriculum } from './preview-data';
import { composeCertificateInfo, parseConduct } from './records-model';
import { useContentQuery } from './use-content-query';

/**
 * Certificate information composed from the conduct summary and the curriculum.
 * There is no certificate endpoint, so no request, status or document is shown:
 * only facts the two sources returned, and a pointer to the issuing office.
 */
export function CertificatesScreen({ navigation }: MobileScreenProps) {
  const { locale, copy: shared, formatNumber, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const preview = isPreviewMode();
  const conductQuery = useContentQuery<unknown>('content.certificates.conduct', () => contentApi.conduct());
  const curriculumQuery = useContentQuery('content.certificates.curriculum', () => academicApi.curriculum());

  const info = useMemo(() => {
    const conduct = parseConduct(preview ? previewConduct(locale) : conductQuery.data);
    const curriculum = preview ? previewCurriculum : curriculumQuery.data ?? null;
    return composeCertificateInfo(conduct, curriculum, locale);
  }, [conductQuery.data, curriculumQuery.data, locale, preview]);

  const loading = !preview && apiClient.mode === 'live' && (conductQuery.isLoading || curriculumQuery.isLoading);
  const failure = preview ? null : conductQuery.error && curriculumQuery.error ? conductQuery.error : null;
  const reload = () => { void conductQuery.reload(); void curriculumQuery.reload(); };
  const missing = copy.missing;

  return (
    <ScreenShell title={copy.certificatesTitle}>
      {loading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : failure ? (
        <StatePanel kind="error" title={shared.errorTitle} description={failure} actionLabel={t('retry')} onAction={reload} />
      ) : !info.hasData ? (
        <StatePanel kind="empty" title={copy.certificatesEmpty} />
      ) : (
        <View style={styles.stack}>
          <Card>
            <MetaRow label={copy.certificatesStudent} value={info.fullName ?? missing} />
            <MetaRow label={copy.certificatesCode} value={info.studentCode ?? missing} />
            <MetaRow label={copy.certificatesProgram} value={info.programName ?? missing} />
            <MetaRow
              label={copy.certificatesConduct}
              value={info.conductAverage === null
                ? missing
                : `${formatNumber(info.conductAverage, { maximumFractionDigits: 1 })}${info.conductClassificationVi && locale === 'vi' ? ` · ${info.conductClassificationVi}` : ''}`}
            />
            <MetaRow label={copy.certificatesMandatory} value={curriculumQuery.data || preview ? formatNumber(info.mandatoryRemaining) : missing} />
            {info.creditsRequired ? (
              <ProgressBar
                label={`${copy.certificatesCredits}: ${fillCopy(copy.certificatesCreditsOf, { earned: formatNumber(info.creditsEarned), total: formatNumber(info.creditsRequired) })}`}
                value={(info.creditsEarned / info.creditsRequired) * 100}
              />
            ) : null}
          </Card>
          <UiText variant="bodySmall" tone="muted">{copy.certificatesNote}</UiText>
          <Button
            label={copy.certificatesOpenCurriculum}
            variant="secondary"
            onPress={() => navigation.navigate('curriculum')}
          />
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: tokens.spacing.md },
});
