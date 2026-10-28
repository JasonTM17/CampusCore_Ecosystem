import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export interface KeyboardSafeViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Keeps the bottom of its content, the composer, above the software keyboard.
 *
 * iOS uses KeyboardAvoidingView with the real distance from the top of the
 * window, so the app chrome above the screen is accounted for. Android, whether
 * the window resizes or draws edge to edge, is handled by measuring how far the
 * keyboard actually overlaps this view: a resized window reports no overlap and
 * adds nothing, so the two mechanisms never double-compensate.
 */
export function KeyboardSafeView({ children, style }: KeyboardSafeViewProps) {
  const frame = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    frame.current?.measureInWindow?.((_x, y) => {
      if (Number.isFinite(y)) setOffset(y);
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      frame.current?.measureInWindow?.((_x, y, _width, height) => {
        const covered = y + height - event.endCoordinates.screenY;
        setOverlap(Number.isFinite(covered) ? Math.max(0, covered) : 0);
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (Platform.OS === 'ios') {
    return (
      <View ref={frame} onLayout={measure} style={[styles.fill, style]}>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={styles.fill}>
          {children}
        </KeyboardAvoidingView>
      </View>
    );
  }
  return (
    <View ref={frame} onLayout={measure} style={[styles.fill, { paddingBottom: overlap }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
