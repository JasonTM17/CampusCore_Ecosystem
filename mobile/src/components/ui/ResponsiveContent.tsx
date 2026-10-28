import type { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { useWindowClass } from '../../design/theme';

/**
 * Centers content on medium/expanded windows (mobile-excellence §2):
 * compact renders full-width like before, medium caps at 720, expanded at 960.
 */
export function ResponsiveContent({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const window = useWindowClass();
  const maxWidth = window.class === 'expanded' ? 960 : window.class === 'medium' ? 720 : undefined;
  return (
    <View style={[maxWidth ? { alignSelf: 'center', maxWidth, width: '100%' } : undefined, style]}>
      {children}
    </View>
  );
}
