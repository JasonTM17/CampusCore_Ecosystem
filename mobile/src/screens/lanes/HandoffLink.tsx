import { useState } from 'react';
import { View } from 'react-native';

import { Button, UiText } from '../../components/Ui';
import { openPortalPath } from '../operations/shared/helpers';
import { useLanesCopy } from './lane-ui';

/** Secondary button that opens the portal route owning the work (`web-same-path`). */
export function HandoffLink({ label, path }: { label: string; path: string }) {
  const { copy } = useLanesCopy();
  const [failed, setFailed] = useState(false);
  return (
    <View>
      <Button
        label={label}
        variant="secondary"
        onPress={() => {
          setFailed(false);
          void openPortalPath(path).then((opened) => setFailed(!opened));
        }}
      />
      {failed ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{copy.webOpenFailed}</UiText> : null}
    </View>
  );
}
