import { useMemo, useState } from 'react';

import { FileRow, type FileRowStatus } from '../../components/ui/file-row';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { shareTimetable, timetableShareCapability } from './academic-api';
import type { AcademicEnrollment, AcademicSemester } from './academic-model';
import { buildTimetableExport, icsDataUri } from './ical-export';
import { useAcademicCopy } from './academic-ui';

export interface ScheduleExportProps {
  enrollments: readonly AcademicEnrollment[];
  semester: AcademicSemester | undefined;
}

/** ICS export of the selected term. Shares through the file adapter and reports only what it returned. */
export function ScheduleExport({ enrollments, semester }: ScheduleExportProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const available = timetableShareCapability().available;
  const [state, setState] = useState<{ status: FileRowStatus; notice?: 'shared' | 'unavailable' | 'failed' }>({ status: 'ready' });
  const bundle = useMemo(
    () => buildTimetableExport(enrollments, semester, locale, copy.calendarName),
    [enrollments, semester, locale, copy.calendarName],
  );
  if (bundle.eventCount === 0) return null;

  const run = async () => {
    setState({ status: 'busy' });
    const result = await shareTimetable(icsDataUri(bundle.content), bundle.filename);
    if (result.status === 'done') setState({ status: 'ready', notice: 'shared' });
    else if (result.status === 'cancelled') setState({ status: 'ready' });
    else if (result.status === 'unavailable') setState({ status: 'unavailable', notice: 'unavailable' });
    else setState({ status: 'failed', notice: 'failed' });
  };

  const status: FileRowStatus = available ? state.status : 'unavailable';
  const label = !available || state.notice === 'unavailable'
    ? copy.exportUnavailable
    : state.notice === 'shared'
      ? copy.exportShared
      : state.notice === 'failed'
        ? copy.exportFailed
        : fillCopy(countForm(bundle.eventCount, copy.exportReadyOne, copy.exportReady), { n: formatNumber(bundle.eventCount) });
  return (
    <FileRow
      name={bundle.filename}
      status={status}
      statusLabel={label}
      actions={[{ key: 'export', label: copy.exportIcs, onPress: () => void run(), disabled: !available }]}
    />
  );
}
