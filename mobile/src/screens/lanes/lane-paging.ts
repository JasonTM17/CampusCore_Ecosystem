// Pure paging rules for the staff desks. The admissions and careers queues
// answer a bare array for a zero-based `page`/`limit` window and report the
// whole authorised size in `X-Total-Count`. The screens show one-based labels
// and, when the header is absent, show the page without claiming a total.

import type { PagedResult } from '../../api/paging';

/** Rows per desk page; matches the existing window and the server maximum of 100. */
export const LANE_PAGE_SIZE = 20;

export interface DeskPaging {
  status: string;
  /** Zero-based wire page. */
  page: number;
  /** One empty-page correction has already run since the last filter/page change. */
  corrected: boolean;
  /** Last page known to hold rows, learned from an empty read without a total. */
  lastPage?: number;
}

export const initialDeskPaging: DeskPaging = { status: '', page: 0, corrected: false };

export type DeskPagingAction =
  | { type: 'filter'; status: string }
  | { type: 'page'; page: number }
  | { type: 'emptyPage'; target: number; lastPage: number };

/**
 * Filter changes restart at page 0, manual navigation clears the correction
 * guard, and an empty page steps back exactly once so a shrinking queue cannot
 * bounce the pager between pages.
 */
export function deskPagingReducer(state: DeskPaging, action: DeskPagingAction): DeskPaging {
  switch (action.type) {
    case 'filter': return { status: action.status, page: 0, corrected: false };
    case 'page': return { ...state, page: Math.max(0, Math.trunc(action.page)), corrected: false };
    case 'emptyPage':
      if (state.page === 0 || state.corrected) return state;
      return { ...state, page: Math.max(0, action.target), corrected: true, lastPage: action.lastPage };
  }
}

export const deskWindow = (page: number) => ({ page, limit: LANE_PAGE_SIZE });

export const deskTotalPages = (total: number): number => Math.max(1, Math.ceil(total / LANE_PAGE_SIZE));

export interface DeskPageView {
  /** One-based label page. */
  page: number;
  /** Whole-list size, only when the server reported it. */
  total?: number;
  totalPages?: number;
  hasMore: boolean;
}

/** Pager data; the total stays absent when `X-Total-Count` was not sent. */
export function deskPageView<T>(data: PagedResult<T>, wirePage: number, lastPage?: number): DeskPageView {
  const page = wirePage + 1;
  if (data.total === undefined) {
    return { page, hasMore: data.hasMore && (lastPage === undefined || wirePage < lastPage) };
  }
  const totalPages = deskTotalPages(data.total);
  return { page, total: data.total, totalPages, hasMore: page < totalPages };
}

/**
 * Page an empty reply should fall back to: the last page the total allows, or
 * the previous page when the total is unknown. Null means this is a real
 * empty first page, or a window that is still inside a known range.
 */
export function correctionTarget<T>(data: PagedResult<T>, wirePage: number): number | null {
  if (wirePage <= 0 || data.items.length > 0) return null;
  if (data.total === undefined) return wirePage - 1;
  if (wirePage * LANE_PAGE_SIZE < data.total) return null;
  return Math.min(wirePage - 1, deskTotalPages(data.total) - 1);
}
