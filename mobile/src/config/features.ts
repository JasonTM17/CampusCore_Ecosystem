/**
 * Push opt-in is gated until a push provider/credential exists on this build —
 * flipping it is a repo-owner capability decision (M07), not a code default.
 */
export const PUSH_OPT_IN_ENABLED = false;
