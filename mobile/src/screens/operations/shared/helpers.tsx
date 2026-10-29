import type { ReactNode } from 'react';
import { Linking } from 'react-native';

import { Button, Card, UiText } from '../../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../../components/perf/list-screen-shell';
import { ListGap, type PerformanceListProps } from '../../../components/perf/performance-list';
import { useLocale } from '../../../i18n/locale-provider';
import { fillCopy } from '../../../i18n/academic-messages';
import { operationsMessages, type OperationsCopy } from '../../../i18n/operations-messages';
import { DEFAULT_PORTAL_URL, portalUrl } from './portal-url';
import { useOpsStyles } from './styles';

export const PORTAL_URL = process.env.EXPO_PUBLIC_PORTAL_URL ?? DEFAULT_PORTAL_URL;

export function useOpsCopy(): { copy: OperationsCopy; locale: 'vi' | 'en' } {
  const { locale } = useLocale();
  return { copy: operationsMessages[locale], locale };
}

/** Opens the portal route that owns the work; resolves false when the link cannot be opened. */
export function openPortalPath(path: string): Promise<boolean> {
  return Linking.openURL(portalUrl(path, PORTAL_URL)).then(() => true, () => false);
}

/**
 * Localised message for a failed read or write; never the raw server text.
 * 409 `GRADES_PUBLISHED_LOCKED` and the other 409/412 conflicts ask for a reload.
 */
export function opsErrorMessage(copy: OperationsCopy, error: unknown, fallback: string): string {
  const status = (error as { status?: number } | null)?.status;
  const code = (error as { code?: string } | null)?.code;
  if (status === 0 || error instanceof TypeError) return copy.offline;
  if (status === 401) return copy.signIn;
  if (status === 403) return copy.denied;
  if (code === 'GRADES_PUBLISHED_LOCKED') return copy.lockedConflict;
  if (status === 409 || status === 412) return copy.conflictReload;
  return fallback;
}

export interface WebOnlyPanelProps<T = unknown> {
  list?: PerformanceListProps<T>;
  title: string;
  /** Portal route that owns the work. */
  path: string;
  children?: ReactNode;
}

/** Honest hand-off for work that stays on the web; shows no data of its own. */
export function WebOnlyPanel<T>({ title, path, children, list }: WebOnlyPanelProps<T>) {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();
  return (
    <ScreenShell title={title} list={list && { ItemSeparatorComponent: ListGap, ...list }}>
      <Card tone="primary" style={styles.webOnlyCard}>
        <UiText variant="headlineSmall">{fillCopy(copy.webOnlyTitle, { title })}</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.webOnlyCopy}>{copy.webOnlyBody}</UiText>
        <Button label={copy.openOnWeb} onPress={() => void openPortalPath(path)} style={styles.submit} />
      </Card>
      {children}
    </ScreenShell>
  );
}
