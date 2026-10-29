import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Platform, View } from 'react-native';

import { createNativeCheckinMachine, type CheckinMachine, type CheckinSnapshot, type CheckinState } from '../../attendance-checkin';
import { Button, Card, IconChip, StatePanel, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import { ChoiceField } from '../../components/ui/choice-field';
import { FormField } from '../../components/ui/primitives';
import type { UiIconName } from '../../components/ui/institutional';
import type { MobileScreenProps } from '../../navigation/types';
import { fillCopy } from '../../i18n/academic-messages';
import { checkinMessages, type CheckinCopy } from '../../i18n/checkin-messages';
import { useLocale } from '../../i18n/locale-provider';
import { createDemoCheckinMachine, DEMO_SCENARIOS, type DemoScenario } from './checkin-demo';
import { useCheckinStyles } from './checkin-styles';

interface StateCopy {
  icon: UiIconName;
  tone: 'error' | 'success' | 'muted' | 'primary' | 'warning';
  title: string;
  body?: string;
}

/** Every machine state → icon + localized copy. Codes never surface raw. */
function stateCopy(state: CheckinState, c: CheckinCopy): StateCopy {
  switch (state.type) {
    case 'needsConsent': return { icon: 'shield-outline', tone: 'primary', title: c.consentTitle };
    case 'needsPermission': return { icon: 'map-marker-outline', tone: 'primary', title: c.permissionTitle, body: c.permissionBody };
    case 'permissionBlocked': return { icon: 'map-marker-off-outline', tone: 'warning', title: c.blockedTitle, body: c.blockedBody };
    case 'servicesOff': return { icon: 'crosshairs-off', tone: 'warning', title: c.servicesOffTitle, body: c.servicesOffBody };
    case 'lowAccuracy': return { icon: 'map-marker-question-outline', tone: 'warning', title: c.lowAccuracyTitle, body: c.lowAccuracyBody };
    case 'accepted': return { icon: 'check-circle-outline', tone: 'success', title: c.acceptedTitle, body: state.status === 'LATE' ? c.statusLate : c.statusPresent };
    case 'pendingReview': return { icon: 'clock-outline', tone: 'primary', title: c.pendingTitle };
    case 'alreadyCheckedIn': return { icon: 'check-circle-outline', tone: 'success', title: c.alreadyTitle };
    case 'sessionClosed': return { icon: 'lock-outline', tone: 'muted', title: c.closedTitle };
    case 'notEnrolled': return { icon: 'account-off-outline', tone: 'muted', title: c.notEnrolledTitle };
    case 'tooManyAttempts': return { icon: 'timer-lock-outline', tone: 'warning', title: c.rateLimitTitle };
    case 'networkError': return { icon: 'cloud-off-outline', tone: 'error', title: c.offlineTitle, body: c.offlineBody };
    case 'rejected':
      return state.reason === 'OUTSIDE_AREA' ? { icon: 'map-marker-off-outline', tone: 'error', title: c.outsideTitle }
        : state.reason === 'BAD_CODE' ? { icon: 'key-outline', tone: 'error', title: c.badCodeTitle, body: c.badCodeBody }
          : { icon: 'close-circle-outline', tone: 'error', title: c.rejectedTitle, body: c.rejectedBody };
    case 'error':
      return state.code === 'INVALID_LINK' ? { icon: 'link-variant-off', tone: 'error', title: c.invalidLinkTitle, body: c.invalidLinkBody }
        : state.code === 'INVALID_SESSION' ? { icon: 'calendar-remove-outline', tone: 'error', title: c.invalidSessionTitle, body: c.invalidSessionBody }
          : state.code === 'STALE_FIX' || state.code === 'TIMEOUT' ? { icon: 'map-marker-question-outline', tone: 'error', title: c.fixFailedTitle, body: c.fixFailedBody }
            : { icon: 'alert-circle-outline', tone: 'error', title: c.genericTitle, body: c.genericBody };
    default:
      return { icon: 'map-marker-check-outline', tone: 'muted', title: c.loading };
  }
}

/** Result states announce themselves to screen readers on arrival. */
const RESULT_STATES = new Set(['accepted', 'pendingReview', 'alreadyCheckedIn', 'rejected', 'sessionClosed',
  'notEnrolled', 'tooManyAttempts', 'networkError', 'error']);

/**
 * apiClient and PreviewPill pull native modules at load time — they are
 * required lazily so this file stays importable in pure Jest tests.
 */
function isPreviewMode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { apiClient } = require('../../api/client') as typeof import('../../api/client');
    return apiClient.mode === 'preview';
  } catch {
    return false;
  }
}

function PreviewBadge() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PreviewPill } = require('../../components/PreviewPill') as typeof import('../../components/PreviewPill');
    return <PreviewPill />;
  } catch {
    return null;
  }
}

function openSettings(target: 'app' | 'location') {
  if (target === 'location' && Platform.OS === 'android') {
    // LOCATION_SOURCE_SETTINGS via sendIntent; fall back to app settings.
    void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings());
    return;
  }
  void Linking.openSettings().catch(() => undefined);
}

interface CheckinBodyProps {
  snapshot: CheckinSnapshot;
  copy: CheckinCopy;
  machine: CheckinMachine;
  code: string;
  setCode: (value: string) => void;
  retryAfter: number;
  onRetry: () => void;
}

function CheckinBody({ snapshot, copy, machine, code, setCode, retryAfter, onRetry }: CheckinBodyProps) {
  const styles = useCheckinStyles();
  const { formatDateTime } = useLocale();
  const router = useRouter();
  const state = snapshot.state;

  if (state.type === 'loadingSessions') {
    return <StatePanel kind="loading" title={copy.loading} />;
  }

  if (state.type === 'idle' || state.type === 'noOpenSession') {
    if (snapshot.sessions.length === 0) {
      return <StatePanel kind="empty" title={copy.noSessions} />;
    }
    return (
      <View style={{ gap: 8 }}>
        <UiText variant="label" tone="muted">{copy.chooseTitle}</UiText>
        {snapshot.sessions.map((session) => (
          <Card key={session.id} style={styles.sessionCard}>
            <View style={styles.sessionRow}>
              <IconChip icon="map-marker-check-outline" size={32} />
              <View style={styles.sessionCopy}>
                <UiText variant="bodyMedium" testID={`checkin-session-${session.id}`}>{session.sectionLabel}</UiText>
                <UiText variant="bodySmall" tone="muted">{session.geofenceName}</UiText>
                <UiText variant="meta" tone="muted">{fillCopy(copy.closesAt, { time: formatDateTime(session.closesAt) })}</UiText>
              </View>
              <View testID={`checkin-select-${session.id}`}>
                <Button label={copy.entryAction} onPress={() => { void machine.selectSession(session.id); }} variant="secondary" />
              </View>
            </View>
          </Card>
        ))}
      </View>
    );
  }

  if (state.type === 'needsConsent') {
    return (
      <Card>
        <View style={styles.resultWrap} testID="checkin-consent">
          <UiText variant="headlineSmall">{copy.consentTitle}</UiText>
          <UiText variant="meta" tone="muted">{fillCopy(copy.consentVersion, { version: state.version })}</UiText>
          <View style={styles.consentList}>
            {[copy.consentOnce, copy.consentRetention, copy.consentPurpose].map((line) => (
              <View key={line} style={styles.consentRow}>
                <UiText variant="bodySmall" tone="primary">{'•'}</UiText>
                <UiText variant="bodySmall" style={{ flex: 1 }}>{line}</UiText>
              </View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <View style={[styles.actionGrow, { minWidth: 120 }]} testID="checkin-consent-accept">
              <Button label={copy.consentAccept} onPress={() => { void machine.acceptConsent(); }} />
            </View>
            <View style={[styles.actionGrow, { minWidth: 120 }]} testID="checkin-consent-decline">
              <Button label={copy.consentDecline} onPress={() => router.back()} variant="text" />
            </View>
          </View>
        </View>
      </Card>
    );
  }

  if (state.type === 'acquiringFix') {
    return (
      <View testID="checkin-acquiring">
        <StatePanel kind="loading" title={copy.acquiringTitle} />
        <View style={styles.actions} testID="checkin-cancel">
          <Button label={copy.cancel} onPress={() => { machine.reset(); void machine.loadSessions(); }} variant="secondary" />
        </View>
      </View>
    );
  }

  if (state.type === 'readyForCode') {
    return (
      <Card>
        <View style={styles.resultWrap} testID="checkin-ready">
          <UiText variant="bodyMedium">{snapshot.selectedSession?.sectionLabel}</UiText>
          {snapshot.selectedSession?.requireCode ? (
            <FormField
              label={copy.codeLabel}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="off"
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={6}
              inputMode="numeric"
              importantForAutofill="no"
              testID="checkin-code"
              style={{ marginBottom: 0 }}
            />
          ) : null}
          <View testID="checkin-submit">
            <Button
              label={copy.submit}
              disabled={Boolean(snapshot.selectedSession?.requireCode) && !/^[0-9]{6}$/.test(code)}
              onPress={() => { void machine.submit(snapshot.selectedSession?.requireCode ? code : undefined); }}
            />
          </View>
        </View>
      </Card>
    );
  }

  if (state.type === 'submitting') {
    return <View testID="checkin-submitting"><StatePanel kind="loading" title={copy.submitting} /></View>;
  }

  // Remaining states: icon + copy + one primary action.
  const panel = stateCopy(state, copy);
  const action = (() => {
    switch (state.type) {
      case 'needsPermission': return { label: copy.permissionAction, run: () => void machine.acquireLocation() };
      case 'permissionBlocked': return { label: copy.openSettings, run: () => openSettings('app') };
      case 'servicesOff': return { label: copy.openLocationSettings, run: () => openSettings('location') };
      case 'lowAccuracy': return { label: copy.retry, run: () => void machine.acquireLocation() };
      case 'rejected': return { label: copy.retry, run: () => void machine.acquireLocation() };
      case 'tooManyAttempts': return { label: retryAfter > 0 ? fillCopy(copy.rateLimitWait, { seconds: retryAfter }) : copy.retry, run: onRetry, disabled: retryAfter > 0 };
      case 'networkError': return { label: copy.retry, run: onRetry };
      case 'error': return state.code === 'INVALID_LINK' || state.code === 'INVALID_SESSION'
        ? { label: copy.back, run: () => router.back() }
        : { label: copy.retry, run: onRetry };
      case 'accepted': case 'pendingReview': case 'alreadyCheckedIn':
        return { label: copy.done, run: () => router.back() };
      case 'sessionClosed': case 'notEnrolled':
        return { label: copy.back, run: () => router.back() };
      default: return null;
    }
  })();

  return (
    <View style={styles.resultWrap} testID={`checkin-state-${state.type}`}>
      <Card>
        <View style={styles.resultWrap}>
          <IconChip icon={panel.icon} size={40} />
          <UiText variant="headlineSmall" tone={panel.tone === 'muted' ? 'default' : panel.tone}>{panel.title}</UiText>
          {panel.body ? <UiText variant="bodySmall" tone="muted">{panel.body}</UiText> : null}
          {state.type === 'tooManyAttempts' && retryAfter > 0 ? (
            <UiText variant="bodySmall" tone="warning">{fillCopy(copy.rateLimitWait, { seconds: retryAfter })}</UiText>
          ) : null}
          {action ? (
            <View style={styles.actions} testID={`checkin-action-${state.type}`}>
              <Button label={action.label} disabled={'disabled' in action && action.disabled === true} onPress={action.run} />
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

export type CheckinScreenProps = MobileScreenProps & {
  /** Injectable machine for component tests; production builds the native one. */
  machine?: CheckinMachine;
};

export function CheckinScreen({ machine: injected }: CheckinScreenProps) {
  const { locale } = useLocale();
  const copy = checkinMessages[locale];
  const preview = isPreviewMode();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const [scenario, setScenario] = useState<DemoScenario>('flow');
  const scenarioRef = useRef<DemoScenario>(scenario);
  scenarioRef.current = scenario;

  const machine = useMemo(
    () => injected ?? (preview ? createDemoCheckinMachine(() => scenarioRef.current) : createNativeCheckinMachine()),
    [injected, preview],
  );
  const [snapshot, setSnapshot] = useState<CheckinSnapshot>(() => machine.getSnapshot());
  const [code, setCode] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const lastStateRef = useRef<CheckinState['type']>('idle');

  useEffect(() => machine.subscribe(setSnapshot), [machine]);

  // Deep link: the route param becomes the lecturer link the machine parses.
  const link = sessionId ? `campuscore://attendance/checkin/${sessionId}` : undefined;

  const reload = useCallback(() => {
    setCode('');
    machine.reset();
    void machine.loadSessions(link);
  }, [machine, link]);

  useFocusEffect(useCallback(() => {
    setCode('');
    void machine.loadSessions(link);
    return () => { machine.reset(); };
  }, [machine, link]));

  // Result announcement + Retry-After countdown.
  useEffect(() => {
    const type = snapshot.state.type;
    if (RESULT_STATES.has(type) && type !== lastStateRef.current) {
      const panel = stateCopy(snapshot.state, copy);
      void AccessibilityInfo.announceForAccessibility?.(panel.title);
    }
    lastStateRef.current = type;
    if (type === 'tooManyAttempts') {
      setRetryAfter(snapshot.state.retryAfterSeconds ?? 0);
    }
  }, [snapshot, copy]);

  useEffect(() => {
    if (snapshot.state.type !== 'tooManyAttempts' || retryAfter <= 0) return;
    const timer = setInterval(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [snapshot.state.type, retryAfter > 0]);

  return (
    <ScreenShell
      title={copy.title}
      headerAction={preview ? <PreviewBadge /> : undefined}
    >
      {preview ? (
        <ChoiceField
          label={copy.demoTitle}
          display="sheet"
          options={DEMO_SCENARIOS.map((id) => ({ value: id, label: copy.scenarios[id] ?? id }))}
          value={scenario}
          onChange={(value) => {
            setScenario(value as DemoScenario);
            scenarioRef.current = value as DemoScenario;
            machine.reset();
            void machine.loadSessions(link);
          }}
        />
      ) : null}
      <CheckinBody
        snapshot={snapshot}
        copy={copy}
        machine={machine}
        code={code}
        setCode={setCode}
        retryAfter={retryAfter}
        onRetry={reload}
      />
    </ScreenShell>
  );
}
