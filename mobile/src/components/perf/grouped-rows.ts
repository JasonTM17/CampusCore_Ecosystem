export type GroupedRow<Group, Item> =
  | { kind: 'header'; key: string; group: Group; empty: boolean }
  | { kind: 'item'; key: string; group: Group; item: Item; index: number; last: boolean };

/** Flatten data, not JSX: one large term/conversation never defeats the render window. */
export function groupedRows<Group, Item>(groups: readonly Group[], groupKey: (group: Group) => string,
  itemsOf: (group: Group) => readonly Item[], itemKey: (item: Item) => string): GroupedRow<Group, Item>[] {
  const rows: GroupedRow<Group, Item>[] = [];
  for (const group of groups) {
    const key = groupKey(group);
    const items = itemsOf(group);
    rows.push({ kind: 'header', key: `${key}:header`, group, empty: items.length === 0 });
    items.forEach((item, index) => rows.push({ kind: 'item', key: `${key}:item:${itemKey(item)}`, group, item, index, last: index === items.length - 1 }));
  }
  return rows;
}
