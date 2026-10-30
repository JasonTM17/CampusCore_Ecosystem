import { Component, Fragment } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useLocale } from '../i18n/locale-provider';
import { StatePanel } from './Ui';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Identity of the protected subtree (e.g. the current route). When it
   * changes, a caught error is cleared so the next screen mounts fresh —
   * the user can also navigate away instead of retrying in place.
   */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Bumped on retry to force a remount of the failed subtree. */
  remount: number;
  /** Last resetKey seen; a new value clears the caught error. */
  seenResetKey?: string;
}

/**
 * Render-error recovery for a routed subtree: the failing tree unmounts and a
 * localized panel offers a retry that remounts it with fresh state. Only the
 * supported React render boundary is caught — native crash recovery is not
 * claimed here, and provider failures above the boundary still propagate.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, remount: 0, seenResetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.seenResetKey) {
      return { error: null, seenResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  private retry = () => {
    this.setState((state) => ({ error: null, remount: state.remount + 1 }));
  };

  render() {
    if (this.state.error) {
      return <ErrorRecovery onRetry={this.retry} />;
    }
    // The key change remounts the subtree on retry rather than resuming a
    // half-rendered tree.
    return <Fragment key={this.state.remount}>{this.props.children}</Fragment>;
  }
}

/**
 * The fallback only depends on theme and locale, which live above the
 * boundary, so a failing provider or screen subtree can never take it down.
 */
function ErrorRecovery({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  return (
    <View style={[styles.host, { backgroundColor: colors.background }]}>
      <StatePanel kind="error" title={t('errorGeneric')} actionLabel={t('retry')} onAction={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: 'center', padding: tokens.layout.mobileGutter },
});
