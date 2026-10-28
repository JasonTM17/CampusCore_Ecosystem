import { View } from 'react-native';

import { Card, Divider, ListRow, SectionHeading, UiText } from '../../components/Ui';
import { LANE_FLAGS } from '../../config/lane-flags';
import type { MobileNavigation } from '../../navigation/types';
import { laneScreenRegistry } from '../../navigation/routes';
import { useSession, type SessionValue } from '../../session/SessionContext';
import { laneAllowed, laneGroupOf, type LaneGroup } from './lane-access';
import { useLanesCopy } from './lane-ui';

/** Session read that yields null outside a provider instead of throwing (same hook order either way). */
function useOptionalSession(): SessionValue | null {
  try {
    return useSession();
  } catch {
    return null;
  }
}

export interface LaneEntriesProps {
  groups: readonly LaneGroup[];
  navigation: MobileNavigation;
  /** Lane ids already shown elsewhere on the screen. */
  exclude?: readonly string[];
}

/**
 * Shortcuts to the lanes this session may open. The list is the intersection
 * of build flag, capability and authenticated session; when it is empty the
 * component renders nothing, so a build with every flag off shows no trace of a lane.
 */
export function LaneEntries({ groups, navigation, exclude = [] }: LaneEntriesProps) {
  const session = useOptionalSession();
  const { copy } = useLanesCopy();
  if (!session || !navigation.navigateLane) return null;
  const entries = laneScreenRegistry.filter(
    (lane) =>
      groups.includes(laneGroupOf(lane.id)) &&
      !exclude.includes(lane.id) &&
      laneAllowed({ kind: session.kind, role: session.role, capabilities: session.capabilities, flags: LANE_FLAGS, id: lane.id }),
  );
  if (entries.length === 0) return null;
  return (
    <View>
      <SectionHeading title={copy.entriesTitle} />
      <Card>
        {entries.map((lane, index) => (
          <View key={lane.id}>
            {index > 0 ? <Divider /> : null}
            <ListRow
              title={copy.titles[lane.id] ?? lane.title}
              onPress={() => navigation.navigateLane?.(lane.id)}
              trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
