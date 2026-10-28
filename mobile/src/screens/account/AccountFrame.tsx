import { useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { UiText } from '../../components/Ui';
import { ResponsiveContent } from '../../components/ui/ResponsiveContent';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';

export interface AccountFrameProps {
  title: string;
  /** Blocking error for the form; announced and scrolled into view. */
  error?: string | null;
  children: ReactNode;
}

/**
 * Frame for the signed-out account screens. These routes sit outside the app
 * chrome, so the frame applies the top safe-area inset itself, keeps the
 * focused field above the keyboard and brings a new error back into view.
 */
export function AccountFrame({ title, error, children }: AccountFrameProps) {
  const { colors } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!error) return;
    scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    void AccessibilityInfo.announceForAccessibility?.(error);
  }, [error]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: tokens.spacing.xl + (insets?.bottom ?? 0),
            paddingTop: tokens.spacing.lg + (insets?.top ?? 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ResponsiveContent>
          <UiText accessibilityRole="header" variant="headlineLarge" style={styles.title}>
            {title}
          </UiText>
          {error ? (
            <View
              accessible
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={[styles.error, { backgroundColor: colors.errorFixed, borderColor: colors.error }]}
            >
              <UiText variant="bodySmall" tone="error">{error}</UiText>
            </View>
          ) : null}
          {children}
        </ResponsiveContent>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: tokens.layout.mobileGutter },
  title: { marginBottom: tokens.spacing.lg },
  error: {
    borderLeftWidth: 3,
    borderRadius: tokens.radii.control,
    borderWidth: 1,
    marginBottom: tokens.spacing.md,
    padding: tokens.spacing.sm,
  },
});
