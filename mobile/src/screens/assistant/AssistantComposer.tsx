import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Field, UiText } from '../../components/Ui';
import { ResponsiveContent } from '../../components/ui/ResponsiveContent';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { ASSISTANT_MAX_MESSAGE_CHARS } from '../../api/assistant-limits';
import { fillAssistantCopy } from '../../i18n/assistant-messages';
import type { AssistantChat } from './useAssistantChat';

/** Message input pinned under the thread. The cap equals the server and web limit. */
export function AssistantComposer({ chat, locked = false }: { chat: AssistantChat; locked?: boolean }) {
  const { colors, window } = useTheme();
  const { copy, busy, notice } = chat;
  const [draft, setDraft] = useState('');
  const landscape = window.landscape;
  const placeholder = chat.scope === 'specialized' ? copy.specializedPlaceholder : copy.composerPlaceholder;
  const disabled = busy || locked;
  useEffect(() => chat.attachDraftSetter(setDraft), [chat.attachDraftSetter]);
  return (
    <View style={[styles.composer, { backgroundColor: colors.card, borderTopColor: colors.outlineVariant }]}>
      <ResponsiveContent>
        {notice ? (
          <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={styles.notice}>{copy[notice]}</UiText>
        ) : null}
        <Field
          label={copy.composerLabel}
          multiline
          editable={!disabled}
          maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
          onChangeText={chat.setDraft}
          placeholder={placeholder}
          value={draft}
          helperText={fillAssistantCopy(copy.characters, { count: draft.length, max: ASSISTANT_MAX_MESSAGE_CHARS })}
          style={[styles.field, landscape ? styles.fieldLandscape : undefined]}
        />
        <View style={styles.actions}>
          <Button icon="send-outline" label={copy.send} loading={busy} disabled={!draft.trim() || locked} onPress={() => void chat.send()} style={styles.button} />
          {busy ? <Button label={copy.stop} onPress={() => void chat.stop()} variant="secondary" style={styles.button} /> : null}
        </View>
      </ResponsiveContent>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderTopWidth: 1, borderTopLeftRadius: tokens.radii.card, borderTopRightRadius: tokens.radii.card, paddingHorizontal: tokens.layout.mobileGutter, paddingTop: tokens.spacing.sm, paddingBottom: tokens.spacing.sm },
  notice: { marginBottom: tokens.spacing.xs },
  field: { marginBottom: tokens.spacing.sm, maxHeight: 180 },
  fieldLandscape: { maxHeight: 80 },
  actions: { flexDirection: 'row', gap: tokens.spacing.sm },
  button: { flex: 1 },
});
