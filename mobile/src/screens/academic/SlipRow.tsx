import { useRef, useState } from 'react';

import { FileRow, type FileRowStatus } from '../../components/ui/file-row';
import { getFileAdapter } from '../../files/file-adapter';
import { isDeviceOffline, saveRegistrationSlip } from './academic-api';
import { useAcademicCopy } from './academic-ui';

type SlipNotice = 'blank' | 'unavailable' | 'offline' | 'saved' | 'failed';
type SlipState = { status: FileRowStatus; notice?: SlipNotice };

/** Registration slip download. Never reports success unless the file adapter did. */
export function SlipRow({ semesterId }: { semesterId: string | null }) {
  const { copy } = useAcademicCopy();
  const available = getFileAdapter().capability('save').available;
  const [state, setState] = useState<SlipState>(available ? { status: 'ready', notice: 'blank' } : { status: 'unavailable', notice: 'unavailable' });
  const inFlight = useRef(false);

  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: 'busy' });
    try {
      if (await isDeviceOffline()) {
        setState({ status: 'failed', notice: 'offline' });
        return;
      }
      const result = await saveRegistrationSlip(semesterId);
      if (result.status === 'done') setState({ status: 'ready', notice: 'saved' });
      else if (result.status === 'cancelled') setState({ status: 'ready', notice: 'blank' });
      else if (result.status === 'unavailable') setState({ status: 'unavailable', notice: 'unavailable' });
      else setState({ status: 'failed', notice: 'failed' });
    } finally {
      inFlight.current = false;
    }
  };

  const statusLabel = state.notice === 'blank' ? ' '
    : state.notice === 'unavailable' ? copy.slipUnavailable
      : state.notice === 'offline' ? copy.offline
        : state.notice === 'saved' ? copy.slipSaved
          : state.notice === 'failed' ? copy.slipFailed : undefined;

  return (
    <FileRow
      name={copy.slipName}
      status={state.status}
      statusLabel={state.status === 'busy' ? copy.slipDownloading : statusLabel}
      actions={[{ key: 'download', label: copy.slipDownload, onPress: () => void download(), disabled: !available || state.status === 'busy' }]}
    />
  );
}
