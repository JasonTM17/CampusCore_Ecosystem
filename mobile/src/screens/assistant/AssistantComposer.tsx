import { StyleSheet, View } from 'react-native';

import { Button, Field, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { ASSISTANT_MAX_MESSAGE_CHARS } from '../../api/assistant-limits';
import { fillAssistantCopy } from '../../i18n/assistant-messages';
import type { AssistantChat } from './useAssistantChat';

/** Message input pinned under the thread. The cap equals the server and web limit. */
export function AssistantComposer({ chat }: { chat: AssistantChat }) {
  const { colors } = useTheme();
  const { copy, draft, busy, notice } = chat;
  return (
    <View style={[styles.composer, { backgroundColor: colors.card, borderTopColor: colors.outlineVariant }]}>
      {notice ? (
        <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={styles.notice}>{copy[notice]}</UiText>
      ) : null}
      <Field
        label={copy.composerLabel}
        multiline
        editable={!busy}
        maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
        onChangeText={chat.setDraft}
        placeholder={copy.composerPlaceholder}
        value={draft}
        helperText={fillAssistantCopy(copy.characters, { count: draft.length, max: ASSISTANT_MAX_MESSAGE_CHARS })}
        style={styles.field}
      />
      <View style={styles.actions}>
        <Button icon="send-outline" label={copy.send} loading={busy} disabled={!draft.trim()} onPress={() => void chat.send()} style={styles.button} />
        {busy ? <Button label={copy.stop} onPress={() => void chat.stop()} variant="secondary" style={styles.button} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderTopWidth: 1, borderTopLeftRadius: tokens.radii.card, borderTopRightRadius: tokens.radii.card, paddingHorizontal: tokens.layout.mobileGutter, paddingTop: tokens.spacing.sm, paddingBottom: tokens.spacing.sm },
  notice: { marginBottom: tokens.spacing.xs },
  field: { marginBottom: tokens.spacing.sm, maxHeight: 180 },
  actions: { flexDirection: 'row', gap: tokens.spacing.sm },
  button: { flex: 1 },
});
