import { useState } from 'react';

import { FileRow, type FileRowStatus } from '../../components/ui/file-row';
import { getFileAdapter } from '../../files/file-adapter';
import { isDeviceOffline, saveRegistrationSlip } from './academic-api';
import { useAcademicCopy } from './academic-ui';

type SlipState = { status: FileRowStatus; label?: string };

/** Registration slip download. Never reports success unless the file adapter did. */
export function SlipRow({ semesterId }: { semesterId: string | null }) {
  const { copy } = useAcademicCopy();
  const available = getFileAdapter().capability('save').available;
  const [state, setState] = useState<SlipState>(available ? { status: 'ready', label: ' ' } : { status: 'unavailable', label: copy.slipUnavailable });

  const download = async () => {
    setState({ status: 'busy' });
    if (await isDeviceOffline()) {
      setState({ status: 'failed', label: copy.offline });
      return;
    }
    const result = await saveRegistrationSlip(semesterId);
    if (result.status === 'done') setState({ status: 'ready', label: copy.slipSaved });
    else if (result.status === 'cancelled') setState({ status: 'ready', label: ' ' });
    else if (result.status === 'unavailable') setState({ status: 'unavailable', label: copy.slipUnavailable });
    else setState({ status: 'failed', label: copy.slipFailed });
  };

  return (
    <FileRow
      name={copy.slipName}
      status={state.status}
      statusLabel={state.label}
      actions={[{ key: 'download', label: copy.slipDownload, onPress: () => void download(), disabled: !available }]}
    />
  );
}
