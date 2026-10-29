import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { chromeFor } from '../../design/chrome';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { RoleName, ThemeColors } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { UiText } from './UiText';
import {
  AVATAR_PALETTE_DARK,
  AVATAR_PALETTE_LIGHT,
  alpha,
  avatarFontSize,
  avatarToneIndex,
  initialsFor,
  resolveAvatarSize,
} from './avatar-utils';
import type { AvatarSize, AvatarToneKey } from './avatar-utils';
import type { UiIconName } from './institutional';

export type { AvatarSize, AvatarToneKey } from './avatar-utils';
export {
  AVATAR_SIZES,
  avatarFontSize,
  avatarToneIndex,
  alpha,
  initialsFor,
  resolveAvatarSize,
} from './avatar-utils';

export type AvatarStatus = 'active' | 'away';

export interface AvatarProps {
  /** Full display name — drives the initials and the spoken label. */
  name?: string;
  /** Explicit initials source when `name` is absent (legacy call sites). */
  label?: string;
  /** Remote or data-URL portrait; falls back to initials while loading or on error. */
  imageUrl?: string | null;
  size?: AvatarSize | number;
  /** Small presence dot anchored bottom-right. */
  status?: AvatarStatus | null;
  /** Role icon chip anchored bottom-left, tinted by the role token. */
  role?: RoleName;
  /** Spoken role text ("Sinh viên", "Giảng viên"…), supplied by the caller. */
  roleLabel?: string;
  /** Brand ring: primary/30 on cards, gold on the navy chrome surface. */
  ring?: boolean;
  /** Set when the avatar sits on the navy chrome surface (profile hero). */
  onBrand?: boolean;
  /** Hide from assistive tech when the person's name renders next to it. */
  decorative?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ROLE_ICONS: Record<RoleName, UiIconName> = {
  student: 'school-outline',
  lecturer: 'account-tie-outline',
  admin: 'shield-account-outline',
  superAdmin: 'shield-crown-outline',
};

/** URLs that already failed once; never retried within the session. */
const failedUrls = new Set<string>();

function resolveTone(
  key: AvatarToneKey,
  colors: ThemeColors,
  roleColors: Record<RoleName, { base: string; solid: string }>,
): { bg: string; ink: string } {
  const bg = key.startsWith('role.')
    ? roleColors[key.slice(5) as RoleName].base
    : colors[key as keyof ThemeColors];
  return { bg, ink: colors.onPrimary };
}

/** One identity portrait: remote image, else deterministic initials. */
export function Avatar({
  name,
  label,
  imageUrl,
  size = 'md',
  status,
  role,
  roleLabel,
  ring = false,
  onBrand = false,
  decorative = false,
  accessibilityLabel,
  testID,
  style,
}: AvatarProps) {
  const { colors, scheme, roleColors } = useTheme();
  const { t } = useLocale();
  const chrome = chromeFor(scheme);
  const [loadFailed, setLoadFailed] = useState(false);

  const px = resolveAvatarSize(size);
  const initials = initialsFor(name, label);
  const palette = scheme === 'dark' ? AVATAR_PALETTE_DARK : AVATAR_PALETTE_LIGHT;
  const tone = resolveTone(palette[avatarToneIndex(name ?? label ?? '', palette.length)], colors, roleColors);

  const uri = imageUrl?.trim() || '';
  const showImage = Boolean(uri) && !failedUrls.has(uri) && !loadFailed;

  const ringColor = onBrand ? chrome.gold : alpha(colors.primary, 0.3);
  const a11y =
    accessibilityLabel ??
    (name
      ? roleLabel
        ? t('avatarLabelRole', { name, role: roleLabel })
        : t('avatarLabel', { name })
      : t('avatarLabelGeneric'));

  const dot = Math.max(9, Math.round(px * 0.24));
  const badgeSize = Math.max(16, Math.round(px * 0.36));

  return (
    <View
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      accessibilityLabel={decorative ? undefined : a11y}
      accessibilityRole={decorative ? undefined : 'image'}
      importantForAccessibility={decorative ? 'no-hide-descendants' : undefined}
      testID={testID}
      style={[styles.wrap, { width: px, height: px }, style]}
    >
      <View
        style={[
          styles.circle,
          {
            backgroundColor: tone.bg,
            borderColor: ringColor,
            borderRadius: px / 2,
            borderWidth: ring ? 2 : 0,
          },
        ]}
      >
        <UiText
          maxFontSizeMultiplier={1.2}
          style={{ color: tone.ink, fontSize: avatarFontSize(px), fontWeight: '600' }}
        >
          {initials}
        </UiText>
        {showImage ? (
          <Image
            accessibilityElementsHidden
            accessible={false}
            importantForAccessibility="no"
            resizeMode="cover"
            source={{ uri }}
            style={styles.photo}
            onError={() => {
              failedUrls.add(uri);
              setLoadFailed(true);
            }}
          />
        ) : null}
      </View>
      {status ? (
        <View
          accessible={false}
          importantForAccessibility="no"
          style={[
            styles.dot,
            {
              backgroundColor: status === 'away' ? colors.warning : colors.success,
              borderColor: onBrand ? chrome.surface : colors.card,
              height: dot,
              width: dot,
            },
          ]}
        />
      ) : null}
      {role ? (
        <View
          accessible={false}
          importantForAccessibility="no"
          style={[
            styles.roleBadge,
            {
              backgroundColor: roleColors[role].solid,
              borderColor: onBrand ? chrome.surface : colors.card,
              height: badgeSize,
              width: badgeSize,
            },
          ]}
        >
          <MaterialCommunityIcons
            accessible={false}
            color={tokens.colors.onPrimary}
            name={ROLE_ICONS[role]}
            size={Math.max(10, Math.round(badgeSize * 0.62))}
          />
        </View>
      ) : null}
    </View>
  );
}

export interface IdentityHeaderProps {
  name: string;
  /** Student/lecturer code shown under the name (or email). */
  subtitle?: string;
  imageUrl?: string | null;
  role?: RoleName;
  roleLabel?: string;
  status?: AvatarStatus | null;
  /** Faculty, class/cohort or status chips like the web profile card. */
  chips?: string[];
  onBrand?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Large identity block (portrait + name + id + chips) for profile headers. */
export function IdentityHeader({
  name,
  subtitle,
  imageUrl,
  role,
  roleLabel,
  status,
  chips = [],
  onBrand = false,
  style,
}: IdentityHeaderProps) {
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const nameColor = onBrand ? chrome.onSurface : colors.text;
  const subColor = onBrand ? chrome.onSurfaceMuted : colors.textMuted;
  const chipBg = onBrand ? chrome.overlay : colors.surfaceLow;
  const chipInk = onBrand ? chrome.onSurface : colors.textMuted;
  const chipBorder = onBrand ? alpha(chrome.gold, 0.45) : colors.outlineVariant;

  return (
    <View style={[styles.header, style]}>
      <Avatar
        imageUrl={imageUrl}
        name={name}
        onBrand={onBrand}
        ring
        role={role}
        roleLabel={roleLabel}
        size="xl"
        status={status}
        decorative
      />
      <View style={styles.headerCopy}>
        <UiText variant="headlineSmall" style={{ color: nameColor }}>
          {name}
        </UiText>
        {subtitle ? (
          <UiText variant="bodySmall" style={{ color: subColor }}>
            {subtitle}
          </UiText>
        ) : null}
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip) => (
              <View
                key={chip}
                style={[styles.chip, { backgroundColor: chipBg, borderColor: chipBorder }]}
              >
                <UiText variant="meta" style={{ color: chipInk }}>
                  {chip}
                </UiText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 0 },
  circle: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  photo: { bottom: 0, height: '100%', left: 0, position: 'absolute', right: 0, top: 0, width: '100%' },
  dot: {
    borderRadius: 999,
    borderWidth: 2,
    bottom: 0,
    position: 'absolute',
    right: 0,
  },
  roleBadge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 2,
    bottom: -1,
    justifyContent: 'center',
    left: -1,
    position: 'absolute',
  },
  header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  headerCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 160 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  chip: {
    borderRadius: tokens.radii.pill,
    borderWidth: 1,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
  },
});
