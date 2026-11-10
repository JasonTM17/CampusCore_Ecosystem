import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiText } from '../../components/ui/UiText';
import { useTheme } from '../../design/theme';
import { minTapTarget, tokens } from '../../design/tokens';
import { countForm } from '../../i18n/locale';
import { fillCopy } from '../../i18n/academic-messages';
import { DAY_ORDER, type AgendaItem } from './academic-model';
import { useAcademicCopy } from './academic-ui';

const DAY_WIDTH = 112;
const TIME_WIDTH = 56;
const shrinkLabel = { numberOfLines: 1 as const, adjustsFontSizeToFit: true };

export interface WeekGridProps {
  items: readonly AgendaItem[];
  todayDow: number;
  expandedId: string | null;
  onToggle: (id: string) => void;
}

function sectionSuffix(courseCode: string, sectionNumber: string): string {
  if (!sectionNumber) return '';
  const escaped = courseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sectionNumber.replace(new RegExp(`^${escaped}[-\\s]?`), '') || sectionNumber;
}

function gridRoom(item: AgendaItem): string {
  if (item.building && item.roomNumber) return `${item.building}-${item.roomNumber}`;
  return item.roomNumber || item.room;
}

function startSlots(items: readonly AgendaItem[]): string[] {
  return [...new Set(items.map((item) => item.startTime.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

/** Days across, start times down. A meeting that covers a later slot stays visible there without a second control. */
export function WeekGrid({ items, todayDow, expandedId, onToggle }: WeekGridProps) {
  const { copy } = useAcademicCopy();
  const { colors } = useTheme();
  const slots = useMemo(() => startSlots(items), [items]);
  const byDay = useMemo(() => {
    const groups = new Map<number, AgendaItem[]>();
    for (const item of items) {
      const group = groups.get(item.dayOfWeek) ?? [];
      group.push(item);
      groups.set(item.dayOfWeek, group);
    }
    return groups;
  }, [items]);

  return (
    <View style={styles.grid}>
      <ScrollView
        horizontal
        testID="week-grid"
        accessibilityLabel={copy.weeklyGrid}
        nestedScrollEnabled
        showsHorizontalScrollIndicator
      >
        <View>
          <View style={styles.row}>
            <View style={styles.timeCol}>
              <UiText variant="label" tone="muted" {...shrinkLabel}>{copy.grid.hourLabel}</UiText>
            </View>
            {DAY_ORDER.map((day, index) => {
              const isToday = day === todayDow;
              const label = copy.dayShort[index] ?? '';
              return (
                <View key={`head-${day}`} style={styles.dayCol}>
                  <View style={[styles.dayHeader, { backgroundColor: isToday ? colors.primaryFixed : colors.card, borderColor: isToday ? colors.primary : colors.outlineVariant }]}>
                    <UiText variant="label" tone={isToday ? 'primary' : 'default'} accessibilityLabel={isToday ? `${label}, ${copy.today}` : label} {...shrinkLabel}>
                      {label}
                    </UiText>
                    {isToday ? (
                      <View style={[styles.todayBadge, { backgroundColor: colors.primary }]}>
                        <UiText variant="meta" tone="onPrimary" {...shrinkLabel}>{copy.today}</UiText>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          {slots.map((slot) => (
            <View key={slot} style={[styles.row, styles.dataRow]}>
              <View style={styles.timeCol}>
                <UiText variant="meta" tone="muted" {...shrinkLabel}>{slot}</UiText>
              </View>
              {DAY_ORDER.map((day) => {
                const dayItems = byDay.get(day) ?? [];
                const starters = dayItems.filter((item) => item.startTime === slot);
                const covered = starters.length === 0
                  ? dayItems.filter((item) => item.startTime < slot && slot < item.endTime)
                  : [];
                return (
                  <View key={`${day}-${slot}`} style={styles.dayCol}>
                    {starters.length > 0 ? starters.map((item) => {
                      const room = gridRoom(item);
                      const expanded = expandedId === item.id;
                      const suffix = sectionSuffix(item.courseCode, item.sectionNumber);
                      const shift = item.startTime.localeCompare('12:00') < 0
                        ? copy.grid.morningLabel
                        : item.startTime.localeCompare('18:00') < 0
                          ? copy.grid.afternoonLabel
                          : copy.grid.eveningLabel;
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.courseCode} ${item.courseName}, ${item.startTime} – ${item.endTime}${room ? `, ${room}` : ''}`}
                          accessibilityState={{ expanded }}
                          onPress={() => onToggle(item.id)}
                          style={styles.blockHit}
                        >
                          <View style={[styles.block, { backgroundColor: colors.primaryFixed, borderColor: colors.outlineVariant, borderLeftColor: colors.primary }]}>
                            <View style={styles.codeRow}>
                              <UiText variant="label" tone="primary" style={styles.code} {...shrinkLabel}>{item.courseCode}</UiText>
                              {suffix ? (
                                <View style={[styles.suffix, { borderColor: colors.outlineVariant, backgroundColor: colors.card }]}>
                                  <UiText variant="meta" {...shrinkLabel}>{suffix}</UiText>
                                </View>
                              ) : null}
                            </View>
                            <UiText variant="meta" tone="muted" style={styles.meta}>
                              {item.startTime}–{item.endTime}{room ? ` · ${room}` : ''}
                            </UiText>
                            <UiText variant="meta" tone="primary" {...shrinkLabel}>{shift}</UiText>
                            {expanded ? (
                              <View style={styles.detail}>
                                <UiText variant="bodySmall">{item.courseName}</UiText>
                                {item.sectionNumber ? <UiText variant="bodySmall">{copy.sectionLabel}: {item.sectionNumber}</UiText> : null}
                                {item.lecturer ? <UiText variant="bodySmall">{copy.lecturer}: {item.lecturer}</UiText> : null}
                                {item.credits > 0 ? <UiText variant="bodySmall">{fillCopy(countForm(item.credits, copy.creditsOne, copy.credits), { n: item.credits })}</UiText> : null}
                              </View>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    }) : covered.length > 0 ? (
                      <View style={[styles.continuation, { backgroundColor: colors.primaryFixed, borderLeftColor: colors.primary }]}>
                        {covered.map((item) => (
                          <UiText key={item.id} variant="meta" tone="muted" {...shrinkLabel}>{item.courseCode}</UiText>
                        ))}
                      </View>
                    ) : (
                      <View style={[styles.emptyCell, { borderColor: colors.outlineVariant, backgroundColor: colors.card }]} />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {slots.length === 0 ? <UiText variant="bodySmall" tone="muted" style={styles.emptyCopy}>{copy.noMeetings}</UiText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { marginTop: tokens.spacing.sm, minWidth: 0 },
  row: { alignItems: 'stretch', flexDirection: 'row' },
  dataRow: { marginTop: 2 },
  timeCol: { justifyContent: 'center', width: TIME_WIDTH },
  dayCol: { minWidth: 0, paddingHorizontal: 2, width: DAY_WIDTH },
  dayHeader: { alignItems: 'center', borderRadius: tokens.radii.control, borderWidth: 1, justifyContent: 'center', marginBottom: 2, minHeight: minTapTarget, minWidth: 0, paddingHorizontal: 2, paddingVertical: 2 },
  todayBadge: { borderRadius: tokens.radii.control, marginTop: 2, maxWidth: '100%', paddingHorizontal: 4 },
  blockHit: { minHeight: minTapTarget, minWidth: 0 },
  block: { borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, minWidth: 0, paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing.xs },
  codeRow: { alignItems: 'center', flexDirection: 'row', gap: 2, minWidth: 0 },
  code: { flex: 1, minWidth: 0 },
  suffix: { borderRadius: tokens.radii.control, borderWidth: 1, maxWidth: '46%', minWidth: 0, paddingHorizontal: 2 },
  meta: { minWidth: 0 },
  detail: { gap: 2, marginTop: tokens.spacing.xs, minWidth: 0 },
  continuation: { borderLeftWidth: 3, borderRadius: tokens.radii.control, flexGrow: 1, justifyContent: 'center', minHeight: 36, minWidth: 0, paddingHorizontal: 4 },
  emptyCell: { borderRadius: tokens.radii.control, borderStyle: 'dashed', borderWidth: 1, flexGrow: 1, minHeight: 40 },
  emptyCopy: { marginTop: tokens.spacing.sm },
});
