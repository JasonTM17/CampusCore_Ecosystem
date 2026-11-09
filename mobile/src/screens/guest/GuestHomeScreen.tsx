import { useContext } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, UiText } from '../../components/Ui';
import { IconChip, StatusPill } from '../../components/ui/institutional';
import type { UiIconName } from '../../components/ui/institutional';
import { chromeFor } from '../../design/chrome';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme, useThemedStyles } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';
import type { ScreenName } from '../../navigation/routes';
import type { MobileScreenProps } from '../../navigation/types';

type GuestHomeCopy = (typeof shellMessages)['vi']['guestHome'];
type RoleKey = keyof GuestHomeCopy['roles'];
type HubEntryKey = keyof GuestHomeCopy['hub']['entries'];

const ROLE_KEYS: readonly RoleKey[] = ['student', 'lecturer', 'admin'];
const ROLE_ICONS: Record<RoleKey, UiIconName> = {
  student: 'school-outline',
  lecturer: 'account-tie-outline',
  admin: 'shield-account-outline',
};

const HUB_ICONS: Record<HubEntryKey, UiIconName> = {
  news: 'newspaper-variant-outline',
  docs: 'book-open-page-variant-outline',
  events: 'calendar-star-outline',
  library: 'bookshelf',
  admissions: 'clipboard-list-outline',
  learning: 'school-outline',
  careers: 'briefcase-outline',
  dashboard: 'view-dashboard-outline',
  lecturer: 'account-group-outline',
  admin: 'cog-outline',
  login: 'login',
};

/** Web hub public section: available modules link, planned modules stay disabled. */
const PUBLIC_MODULES: readonly { key: HubEntryKey; target?: ScreenName }[] = [
  { key: 'news', target: 'news' },
  { key: 'docs', target: 'docs' },
  { key: 'events' },
  { key: 'library' },
  { key: 'admissions' },
];

/**
 * Web hub workspace section as a guest sees it: every available entry still
 * needs a session, so the card carries the sign-in label and opens /sign-in.
 */
const WORKSPACE_MODULES: readonly { key: HubEntryKey; signInRequired: boolean }[] = [
  { key: 'dashboard', signInRequired: true },
  { key: 'learning', signInRequired: false },
  { key: 'careers', signInRequired: false },
  { key: 'lecturer', signInRequired: true },
  { key: 'admin', signInRequired: true },
  { key: 'login', signInRequired: false },
];

const PLANNED_MODULES: ReadonlySet<HubEntryKey> = new Set<HubEntryKey>([
  'events',
  'library',
  'admissions',
  'learning',
  'careers',
]);

const roleTone = (role: RoleKey, colors: ThemeColors) => {
  switch (role) {
    case 'student':
      return { fill: colors.primaryFixed, ink: colors.primary };
    case 'lecturer':
      return { fill: colors.successFixed, ink: colors.success };
    case 'admin':
      return { fill: colors.warningFixed, ink: colors.warning };
  }
};

/**
 * Guest landing (web `/`) and module hub (web `/hub`) in one public screen: a
 * signed-out session reaches this from `/` while every signed-in session keeps
 * the historical role-home redirect. Content, wording and order follow the web
 * catalogue; every sign-in entry routes to the existing `/sign-in` screen.
 */
export function GuestHomeScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const { locale } = useLocale();
  const copy = shellMessages[locale].guestHome;
  const insets = useContext(SafeAreaInsetsContext);
  const year = new Date().getFullYear();

  return (
    <View style={[styles.screen, { paddingLeft: insets?.left ?? 0, paddingRight: insets?.right ?? 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: chrome.surface, paddingTop: (insets?.top ?? 0) + tokens.spacing.lg }]}>
          <View style={styles.brandRow}>
            <Image
              accessibilityLabel={copy.schoolName}
              accessibilityRole="image"
              source={require('../../../assets/hcmute-logo.png')}
              resizeMode="contain"
              style={styles.brandMark}
            />
            <View style={styles.brandCopy}>
              <UiText variant="headlineMedium" style={{ color: chrome.onSurface }}>CampusUTE</UiText>
              <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{copy.brandSubtitle}</UiText>
            </View>
          </View>
          <UiText variant="meta" style={[styles.heroEyebrow, { color: chrome.accent }]}>{copy.eyebrow}</UiText>
          <UiText variant="meta" style={[styles.heroSchool, { color: chrome.onSurfaceMuted }]}>{copy.schoolName}</UiText>
          <UiText accessibilityRole="header" variant="display" style={[styles.heroTitle, { color: chrome.onSurface }]}>{copy.title}</UiText>
          <UiText variant="bodyMedium" style={[styles.heroDescription, { color: chrome.onSurfaceMuted }]}>{copy.description}</UiText>
          <Button
            label={copy.signIn}
            icon="login"
            onPress={() => navigation.navigate('auth.signIn')}
            style={styles.heroAction}
            variant="secondary"
          />
        </View>

        <View style={[styles.body, styles.section]}>
          {ROLE_KEYS.map((role) => {
            const lane = copy.roles[role];
            const tone = roleTone(role, colors);
            return (
              <Card key={role} style={styles.laneCard}>
                <View style={styles.laneHead}>
                  <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.laneMark, { backgroundColor: tone.fill }]}>
                    <MaterialCommunityIcons accessible={false} color={tone.ink} name={ROLE_ICONS[role]} size={22} />
                  </View>
                  <UiText variant="headlineSmall" style={styles.laneTitle}>{lane.title}</UiText>
                </View>
                <UiText variant="bodySmall" tone="muted">{lane.description}</UiText>
                <View style={styles.chipRow}>
                  {lane.rows.map((row) => (
                    <View key={row} style={styles.chip}>
                      <UiText variant="meta" tone="muted">{row}</UiText>
                    </View>
                  ))}
                </View>
                <Pressable
                  accessibilityLabel={lane.action}
                  accessibilityRole="link"
                  onPress={() => navigation.navigate('auth.signIn')}
                  style={({ pressed }) => [styles.laneAction, pressed ? styles.pressed : undefined]}
                  testID={`guest-lane-${role}`}
                >
                  <UiText variant="label" tone="primary">{lane.action}</UiText>
                  <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="arrow-right" size={18} />
                </Pressable>
              </Card>
            );
          })}
        </View>

        <View style={[styles.body, styles.section]}>
          <View style={styles.sectionHead}>
            <UiText variant="meta" tone="primary" style={styles.eyebrow}>{copy.hub.publicSection}</UiText>
            <UiText accessibilityRole="header" variant="headlineMedium">{copy.hub.title}</UiText>
            <UiText variant="bodySmall" tone="muted">{copy.hub.subtitle}</UiText>
          </View>
          {PUBLIC_MODULES.map((module) => (
            <HubCard
              key={module.key}
              entryKey={module.key}
              onOpen={module.target ? () => navigation.navigate(module.target as ScreenName) : undefined}
              planned={PLANNED_MODULES.has(module.key)}
            />
          ))}
          <UiText accessibilityRole="header" variant="headlineSmall" style={styles.workspaceHead}>{copy.hub.signInCta}</UiText>
          {WORKSPACE_MODULES.map((module) => (
            <HubCard
              key={module.key}
              entryKey={module.key}
              onOpen={PLANNED_MODULES.has(module.key) ? undefined : () => navigation.navigate('auth.signIn')}
              planned={PLANNED_MODULES.has(module.key)}
              signInRequired={module.signInRequired}
            />
          ))}
        </View>

        <View style={[styles.pillars, { backgroundColor: chrome.surface }]}>
          <View style={[styles.body, styles.pillarsBody]}>
            <UiText variant="meta" style={[styles.heroEyebrow, { color: chrome.accent }]}>{copy.processKicker}</UiText>
            <View style={styles.pillarList}>
              {copy.processSteps.map((step) => (
                <View key={step} style={styles.pillarRow}>
                  <View accessible={false} importantForAccessibility="no" style={[styles.pillarBar, { backgroundColor: chrome.gold }]} />
                  <UiText variant="bodyLarge" style={{ color: chrome.onSurface, flex: 1 }}>{step}</UiText>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={{ backgroundColor: chrome.surface, paddingBottom: tokens.spacing.lg + (insets?.bottom ?? 0) }}>
          <View style={[styles.body, styles.footerBody]}>
            <View style={styles.footerBrand}>
              <UiText variant="headlineSmall" style={{ color: chrome.onSurface }}>CampusUTE</UiText>
              <UiText variant="meta" style={{ color: chrome.onSurfaceMuted }}>{copy.footer.subtitle}</UiText>
              <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{copy.footer.description}</UiText>
            </View>
            <View style={styles.footerColumn}>
              <UiText variant="label" style={{ color: chrome.onSurface }}>{copy.footer.workspace}</UiText>
              {copy.footer.workspaceLinks.map((label) => (
                <FooterLink key={label} label={label} onPress={() => navigation.navigate('auth.signIn')} />
              ))}
            </View>
            <View style={styles.footerColumn}>
              <UiText variant="label" style={{ color: chrome.onSurface }}>{copy.footer.delivery}</UiText>
              {copy.footer.deliveryLinks.map((label) => (
                <FooterLink key={label} label={label} onPress={() => navigation.navigate('auth.signIn')} />
              ))}
            </View>
            <View style={[styles.footerRule, { backgroundColor: chrome.overlay }]} />
            <UiText variant="meta" style={{ color: chrome.onSurfaceMuted }}>
              {`© ${year} CampusUTE. ${copy.footer.copyright}`}
            </UiText>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function HubCard({
  entryKey,
  planned,
  signInRequired = false,
  onOpen,
}: {
  entryKey: HubEntryKey;
  planned: boolean;
  signInRequired?: boolean;
  onOpen?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { locale } = useLocale();
  const copy = shellMessages[locale].guestHome;
  const entry = copy.hub.entries[entryKey];
  return (
    <Card style={[styles.hubCard, planned ? styles.hubCardPlanned : undefined]}>
      <View style={styles.hubHead}>
        <IconChip icon={HUB_ICONS[entryKey]} size={36} />
        <UiText variant="headlineSmall" style={styles.hubTitle}>{entry.title}</UiText>
      </View>
      <UiText variant="bodySmall" tone="muted">{entry.description}</UiText>
      <View style={styles.hubFoot}>
        {planned ? <StatusPill label={copy.hub.plannedStatus} tone="neutral" /> : signInRequired ? (
          <StatusPill label={copy.hub.signInRequired} tone="neutral" />
        ) : null}
        {onOpen ? (
          <Pressable
            accessibilityLabel={`${copy.hub.open} ${entry.title}`}
            accessibilityRole="link"
            onPress={onOpen}
            style={({ pressed }) => [styles.openAction, pressed ? styles.pressed : undefined]}
            testID={`guest-hub-${entryKey}`}
          >
            <UiText variant="label" tone="primary">{copy.hub.open}</UiText>
            <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="arrow-right" size={18} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.footerLink}>
      <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{label}</UiText>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  hero: { gap: tokens.spacing.sm, paddingBottom: tokens.spacing.xl, paddingHorizontal: tokens.layout.mobileGutter },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md, marginBottom: tokens.spacing.md },
  brandMark: { backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 56, width: 56 },
  brandCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  heroEyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  heroSchool: { letterSpacing: 0.6, textTransform: 'uppercase' },
  heroTitle: { marginTop: tokens.spacing.xs },
  heroDescription: { marginTop: tokens.spacing.xs },
  heroAction: { alignSelf: 'flex-start', marginTop: tokens.spacing.sm },
  body: { alignSelf: 'center', maxWidth: tokens.windowClasses.contentMaxWidth.medium, paddingHorizontal: tokens.layout.mobileGutter, width: '100%' },
  section: { gap: tokens.spacing.md, paddingTop: tokens.spacing.lg },
  laneCard: { gap: tokens.spacing.sm },
  laneHead: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  laneMark: { alignItems: 'center', borderRadius: tokens.radii.control, height: 40, justifyContent: 'center', width: 40 },
  laneTitle: { flex: 1, minWidth: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  chip: { backgroundColor: colors.secondaryContainer, borderRadius: tokens.radii.control, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  laneAction: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, minHeight: minTapTarget, minWidth: minTapTarget },
  sectionHead: { gap: tokens.spacing.xs },
  eyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  hubCard: { gap: tokens.spacing.sm },
  hubCardPlanned: { opacity: 0.7 },
  hubHead: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  hubTitle: { flex: 1, minWidth: 0 },
  hubFoot: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginTop: tokens.spacing.xs },
  openAction: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, minHeight: minTapTarget, minWidth: minTapTarget },
  workspaceHead: { marginTop: tokens.spacing.sm },
  pillars: { marginTop: tokens.spacing.lg },
  pillarsBody: { gap: tokens.spacing.md, paddingVertical: tokens.spacing.lg },
  pillarList: { gap: tokens.spacing.md },
  pillarRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md },
  pillarBar: { borderRadius: tokens.radii.control, height: 24, width: 4 },
  footerBody: { gap: tokens.spacing.md, paddingTop: tokens.spacing.lg },
  footerBrand: { gap: tokens.spacing.xs },
  footerColumn: { gap: tokens.spacing.xs },
  footerLink: { justifyContent: 'center', minHeight: minTapTarget, minWidth: minTapTarget },
  footerRule: { height: 1, marginTop: tokens.spacing.sm },
  pressed: { opacity: 0.88 },
});
