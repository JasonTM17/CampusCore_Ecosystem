import type { ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { GroupCard } from './group-card';

export interface VirtualRow { key: string; render: () => ReactElement | null }
export const renderVirtualRow = ({ item }: { item: VirtualRow }) => item.render();

/** Descriptors hold data/closures only. Native row trees are created inside the render window. */
export function contentRows<T>(prefix: string, data: readonly T[], key: (item: T, index: number) => string,
  render: (item: T, index: number) => ReactElement | null): VirtualRow[] {
  return data.map((item, index) => ({ key: `${prefix}:${key(item, index)}`, render: () => render(item, index) }));
}

export function cardRows<T>(prefix: string, data: readonly T[], key: (item: T, index: number) => string,
  header: ReactElement, render: (item: T, index: number) => ReactElement | null,
  options: { style?: StyleProp<ViewStyle>; footer?: ReactElement } = {}): VirtualRow[] {
  const hasFooter = Boolean(options.footer);
  return [
    { key: `${prefix}:header`, render: () => <GroupCard edge={data.length || hasFooter ? 'start' : 'single'} style={options.style}>{header}</GroupCard> },
    ...contentRows(prefix, data, key, (item, index) => <GroupCard edge={index === data.length - 1 && !hasFooter ? 'end' : 'middle'} style={options.style}>{render(item, index)}</GroupCard>),
    ...(options.footer ? [{ key: `${prefix}:footer`, render: () => <GroupCard edge="end" style={options.style}>{options.footer}</GroupCard> }] : []),
  ];
}
