import type { ThesisCouncil, ThesisGroup } from '@/lib/thesis-api';

/**
 * Topic ids that already carry a group or a council. Archive eligibility reads
 * this once per render instead of scanning the whole group list per topic.
 */
export function buildTopicHistoryIds(
  groups: readonly Pick<ThesisGroup, 'topicId'>[],
  councils: readonly Pick<ThesisCouncil, 'topicIds'>[],
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.topicId) ids.add(group.topicId);
  }
  for (const council of councils) {
    for (const topicId of council.topicIds ?? []) {
      ids.add(topicId);
    }
  }
  return ids;
}
