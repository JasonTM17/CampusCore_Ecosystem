'use client';

import { hasNextPage, pageCount } from '@/lib/array-list-page';

export interface ListPagerCopy {
  showing: string;
  to: string;
  of: string;
  results: string;
  page: string;
  previous: string;
  next: string;
  loading: string;
}

export interface ListPagerProps {
  testId: string;
  navLabel: string;
  page: number;
  limit: number;
  total?: number;
  itemCount: number;
  pending: boolean;
  copy: ListPagerCopy;
  onPage: (page: number) => void;
}

/** Shared zero-based list navigation with one-based, live display copy. */
export function ListPager(props: ListPagerProps) {
  const totalPages = pageCount(props.total, props.limit);
  const hasPrevious = props.page > 0;
  const hasNext = hasNextPage(
    props.page,
    totalPages,
    props.itemCount,
    props.limit,
  );
  const firstVisible = props.itemCount === 0 ? 0 : props.page * props.limit + 1;
  const lastVisible = props.page * props.limit + props.itemCount;
  const range = `${props.copy.showing} ${firstVisible} ${props.copy.to} ${lastVisible}`;
  const total = props.total === undefined
    ? ''
    : ` ${props.copy.of} ${props.total} ${props.copy.results}`;
  const status = props.pending
    ? `${props.copy.loading} · ${props.copy.page} ${props.page + 1}`
    : `${range}${total} · ${props.copy.page} ${props.page + 1}`;

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p
        role="status"
        aria-live="polite"
        aria-busy={props.pending}
        data-testid={`${props.testId}-status`}
        className="text-sm text-muted-foreground"
      >
        {status}
      </p>
      <nav aria-label={props.navLabel} className="flex items-center gap-2">
        <button
          type="button"
          disabled={props.pending || !hasPrevious}
          onClick={() => props.onPage(props.page - 1)}
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {props.copy.previous}
        </button>
        <button
          type="button"
          disabled={props.pending || !hasNext}
          onClick={() => props.onPage(props.page + 1)}
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {props.copy.next}
        </button>
      </nav>
    </div>
  );
}
