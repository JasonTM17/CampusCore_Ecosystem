import { useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Card, UiText } from '../../components/Ui';
import { ResponsiveContent } from '../../components/ui/ResponsiveContent';
import { chromeFor } from '../../design/chrome';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';

export interface AccountFrameProps {
  title: string;
  subtitle?: string;
  /** Blocking error for the form; announced and scrolled into view. */
  error?: string | null;
  children: ReactNode;
}

/**
 * Frame for the signed-out account screens. Matches the institutional brand
 * header and centered form card of SignInScreen.
 */
export function AccountFrame({ title, subtitle, error, children }: AccountFrameProps) {
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const { locale } = useLocale();
  const insets = useContext(SafeAreaInsetsContext);
  const scrollRef = useRef<ScrollView>(null);
  const portalSubtitle = locale === 'vi' ? 'Cổng thông tin đào tạo' : 'Academic information portal';

  useEffect(() => {
    if (!error) return;
    scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    void AccessibilityInfo.announceForAccessibility?.(error);
  }, [error]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <View
        style={[
          styles.brandRow,
          {
            backgroundColor: chrome.surface,
            paddingTop: (insets?.top ?? 0) + tokens.spacing.lg,
          },
        ]}
      >
        <Image
          accessibilityLabel="HCMUTE"
          accessibilityRole="image"
          source={require('../../../assets/hcmute-logo.png')}
          resizeMode="contain"
          style={styles.brandMark}
        />
        <View style={styles.brandCopy}>
          <UiText variant="headlineMedium" style={{ color: chrome.onSurface }}>
            CampusUTE
          </UiText>
          <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>
            {portalSubtitle}
          </UiText>
        </View>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: tokens.spacing.xl + (insets?.bottom ?? 0),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ResponsiveContent>
            <Card style={styles.formCard}>
              <View
                style={[
                  styles.cardHeading,
                  {
                    borderBottomColor:
                      scheme === 'dark'
                        ? tokens.colorsDark.outlineVariant
                        : tokens.colors.outlineVariant,
                  },
                ]}
              >
                <UiText accessibilityRole="header" variant="headlineLarge" style={styles.title}>
                  {title}
                </UiText>
                {subtitle ? (
                  <UiText variant="bodySmall" tone="muted">
                    {subtitle}
                  </UiText>
                ) : null}
              </View>
              {error ? (
                <View
                  accessible
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                  style={[
                    styles.error,
                    {
                      backgroundColor: colors.errorFixed,
                      borderColor: colors.error,
                    },
                  ]}
                >
                  <UiText variant="bodySmall" tone="error">
                    {error}
                  </UiText>
                </View>
              ) : null}
              {children}
            </Card>
          </ResponsiveContent>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  brandMark: {
    backgroundColor: tokens.colors.card,
    borderRadius: tokens.radii.control,
    height: 56,
    width: 56,
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
    gap: tokens.spacing.xs,
  },
  content: {
    paddingHorizontal: tokens.layout.mobileGutter,
    paddingTop: tokens.spacing.xl,
  },
  formCard: {
    padding: tokens.spacing.lg,
  },
  cardHeading: {
    gap: tokens.spacing.xs,
    paddingBottom: tokens.spacing.md,
    marginBottom: tokens.spacing.md,
    borderBottomWidth: 1,
  },
  title: {
    marginBottom: 0,
  },
  error: {
    borderLeftWidth: 3,
    borderRadius: tokens.radii.control,
    borderWidth: 1,
    marginBottom: tokens.spacing.md,
    padding: tokens.spacing.sm,
  },
});
