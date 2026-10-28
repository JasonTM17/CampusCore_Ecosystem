import { Children } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useWindowClass } from '../../design/theme';

/** Wraps each child in a ~48% cell on medium/expanded; compact keeps stacking. */
export function ResponsiveGrid({ children }: { children: ReactNode }) {
  const { class: windowClass } = useWindowClass();
  if (windowClass === 'compact') return <>{children}</>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {Children.map(children, (child, index) => (
        <View key={index} style={{ width: '48%' }}>{child}</View>
      ))}
    </View>
  );
}
