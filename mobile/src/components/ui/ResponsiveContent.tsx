import type { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { useWindowClass } from '../../design/theme';
import { tokens } from '../../design/tokens';

/**
 * Centers content on medium/expanded windows (mobile-excellence §2):
 * compact renders full-width; wider classes use the shared semantic width cap.
 */
export function ResponsiveContent({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const window = useWindowClass();
  const maxWidth = window.class === 'compact' ? undefined : tokens.windowClasses.contentMaxWidth[window.class];
  return (
    <View style={[maxWidth ? { alignSelf: 'center', maxWidth, width: '100%' } : undefined, style]}>
      {children}
    </View>
  );
}
