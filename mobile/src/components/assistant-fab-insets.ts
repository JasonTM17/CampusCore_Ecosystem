import { tokens } from '../design/tokens';

export const ASSISTANT_FAB_SIZE = 56;
export const ASSISTANT_FAB_CLEARANCE = ASSISTANT_FAB_SIZE + tokens.spacing.md;
const assistantFabBottomOffset = ASSISTANT_FAB_CLEARANCE - ASSISTANT_FAB_SIZE;
/** Bottom inset for list and scroll content: fab height plus its margin above content, sitting on its shell offset. */
export const ASSISTANT_FAB_CONTENT_PADDING = ASSISTANT_FAB_SIZE + tokens.spacing.md;
export const ASSISTANT_FAB_SCROLL_INSET = assistantFabBottomOffset + ASSISTANT_FAB_CONTENT_PADDING + tokens.spacing.md;
