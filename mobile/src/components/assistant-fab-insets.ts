import { tokens } from '../design/tokens';

export const ASSISTANT_FAB_SIZE = 56;
export const ASSISTANT_FAB_CLEARANCE = ASSISTANT_FAB_SIZE + tokens.spacing.md;
const assistantFabBottomOffset = ASSISTANT_FAB_CLEARANCE - ASSISTANT_FAB_SIZE;
export const ASSISTANT_FAB_SCROLL_INSET = ASSISTANT_FAB_SIZE + assistantFabBottomOffset + tokens.spacing.md;
