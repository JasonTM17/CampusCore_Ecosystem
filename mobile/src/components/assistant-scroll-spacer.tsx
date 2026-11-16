import { View } from 'react-native';

import { ASSISTANT_FAB_SCROLL_INSET } from './assistant-fab-insets';

/** Bottom clearance so the assistant FAB never overlaps the last row. */
export function AssistantScrollSpacer() {
  return <View testID="assistant-scroll-spacer" style={{ height: ASSISTANT_FAB_SCROLL_INSET }} />;
}
