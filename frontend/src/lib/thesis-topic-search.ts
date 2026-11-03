export const TOPIC_SEARCH_MAX_LENGTH = 200;
export const TOPIC_SEARCH_MAX_TOKENS = 16;

// The catalogue sends `value.trim()`, so the budget is measured on that exact
// string: the API counts the received value with the same ECMAScript whitespace
// set, and a leading/trailing run must neither block a query the API accepts
// nor let a longer one through.
export function isTopicSearchWithinBudget(value: string): boolean {
  const sent = value.trim();
  const tokens = sent.split(/\s+/).filter(Boolean);
  return sent.length <= TOPIC_SEARCH_MAX_LENGTH && tokens.length <= TOPIC_SEARCH_MAX_TOKENS;
}
