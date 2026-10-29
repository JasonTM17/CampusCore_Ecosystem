import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { CapabilitySet } from '../auth/capabilities';
import { chromeFor } from '../design/chrome';
import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useShellCopy } from '../i18n/use-shell-copy';
import { resolveGuard, screenForPath, type SessionKind } from '../navigation/route-map';
import type { UserRole } from '../navigation/routes';

export const ASSISTANT_FAB_SIZE = 56;
export const ASSISTANT_FAB_CLEARANCE = ASSISTANT_FAB_SIZE + tokens.spacing.md;

export interface AssistantFabVisibilityInput {
  session: SessionKind;
  role: UserRole;
  capabilities: CapabilitySet;
  pathname: string;
  keyboardVisible: boolean;
}

/** The route guard remains the authority for both this screen and /assistant. */
export function isAssistantFabVisible({ session, role, capabilities, pathname, keyboardVisible }: AssistantFabVisibilityInput): boolean {
  if (keyboardVisible || session === 'signedOut' || screenForPath(pathname) === 'assistant.chat') {
    return false;
  }
  return resolveGuard(session, role, pathname, capabilities).action === 'allow'
    && resolveGuard(session, role, '/assistant', capabilities).action === 'allow';
}

export interface AssistantFabProps extends Omit<AssistantFabVisibilityInput, 'keyboardVisible'> {
  onPress(): void;
}

export function AssistantFab({ session, role, capabilities, pathname, onPress }: AssistantFabProps) {
  const { scheme, reducedMotion } = useTheme();
  const chrome = chromeFor(scheme);
  const { copy } = useShellCopy();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const visible = isAssistantFabVisible({ session, role, capabilities, pathname, keyboardVisible });

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      scale.setValue(0.94);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, scale, visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.position, { opacity, transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.assistantFabLabel}
        hitSlop={4}
        onPress={onPress}
        testID="assistant-fab"
        style={({ pressed }) => [styles.button, { backgroundColor: chrome.surface, shadowColor: chrome.surfaceStrong }, pressed ? styles.pressed : undefined]}
      >
        <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={chrome.gold} name="robot-happy-outline" size={26} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', bottom: ASSISTANT_FAB_CLEARANCE - ASSISTANT_FAB_SIZE, right: tokens.layout.mobileGutter, zIndex: 5 },
  button: {
    alignItems: 'center',
    borderRadius: tokens.radii.pill,
    elevation: 8,
    height: ASSISTANT_FAB_SIZE,
    justifyContent: 'center',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 6,
    width: ASSISTANT_FAB_SIZE,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.96 }] },
});
