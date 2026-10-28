// Pure state for the registration selection. A failed attempt keeps the
// section selected together with the reason, so a conflict never loses the
// student's choice; only a success or an explicit toggle removes it.

export interface BasketFailure {
  code: string | null;
  /** Copy key resolved by the screen; kept as data so the reducer stays pure. */
  messageKey: string;
}

export interface BasketState {
  selected: readonly string[];
  failures: Readonly<Record<string, BasketFailure>>;
}

export type BasketAction =
  | { type: 'toggle'; sectionId: string }
  | { type: 'fail'; sectionId: string; failure: BasketFailure }
  | { type: 'succeed'; sectionId: string }
  | { type: 'prune'; validIds: readonly string[] }
  | { type: 'clear' };

export const emptyBasket: BasketState = { selected: [], failures: {} };

function without(failures: BasketState['failures'], sectionId: string): BasketState['failures'] {
  const { [sectionId]: _removed, ...rest } = failures;
  return rest;
}

export function basketReducer(state: BasketState, action: BasketAction): BasketState {
  switch (action.type) {
    case 'toggle':
      return state.selected.includes(action.sectionId)
        ? { selected: state.selected.filter((id) => id !== action.sectionId), failures: without(state.failures, action.sectionId) }
        : { selected: [...state.selected, action.sectionId], failures: state.failures };
    case 'fail':
      return {
        selected: state.selected.includes(action.sectionId) ? state.selected : [...state.selected, action.sectionId],
        failures: { ...state.failures, [action.sectionId]: action.failure },
      };
    case 'succeed':
      return { selected: state.selected.filter((id) => id !== action.sectionId), failures: without(state.failures, action.sectionId) };
    case 'prune': {
      const valid = new Set(action.validIds);
      const selected = state.selected.filter((id) => valid.has(id));
      const failures = Object.fromEntries(Object.entries(state.failures).filter(([id]) => valid.has(id)));
      return { selected, failures };
    }
    case 'clear':
      return emptyBasket;
    default:
      return state;
  }
}
