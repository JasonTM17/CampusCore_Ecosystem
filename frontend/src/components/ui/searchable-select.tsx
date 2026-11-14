'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';

import type { SelectOption } from './select';

export interface SearchableSelectProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  label?: string;
  error?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Remote search: called (debounced) with the trimmed query. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Combobox for large reference lists (lecturers, courses) where a native
 * <select> silently truncates at the backend cap. Typing queries the server
 * through `onSearch`, so options beyond the first page stay reachable.
 */
const SearchableSelect = React.forwardRef<HTMLDivElement, SearchableSelectProps>(
  (
    {
      className,
      label,
      error,
      options,
      value,
      onValueChange,
      onSearch,
      loading = false,
      searchPlaceholder,
      emptyLabel,
      disabled = false,
      required = false,
      id,
      'aria-describedby': externalDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId().replace(/:/g, '');
    const controlId = id ?? `searchable-select-${generatedId}`;
    const listboxId = `${controlId}-listbox`;
    const errorId = `searchable-select-error-${generatedId}`;
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const selected = options.find((option) => option.value === value);
    const describedBy = [externalDescribedBy, error ? errorId : null]
      .filter(Boolean)
      .join(' ')
      .trim();

    const close = React.useCallback(() => {
      setOpen(false);
      setQuery('');
      setActiveIndex(-1);
    }, []);

    React.useEffect(() => {
      if (!open) return undefined;
      const onPointerDown = (event: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
          close();
        }
      };
      document.addEventListener('mousedown', onPointerDown);
      return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open, close]);

    React.useEffect(() => {
      if (!open || !onSearch) return undefined;
      debounceRef.current = setTimeout(() => onSearch(query.trim()), SEARCH_DEBOUNCE_MS);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, [query, open, onSearch]);

    const select = (option: SelectOption) => {
      onValueChange(option.value);
      close();
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, -1));
      } else if (event.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        select(options[activeIndex]);
      }
    };

    return (
      <div className="w-full" ref={rootRef} {...props}>
        {label && (
          <label htmlFor={controlId} className="mb-1 block text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <div className="relative" ref={ref}>
          <button
            type="button"
            id={controlId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            aria-required={required}
            disabled={disabled}
            onClick={() => {
              setOpen((current) => !current);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className={cn(
              'flex h-11 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
              error && 'border-destructive focus:ring-destructive',
              className,
            )}
          >
            <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
              {selected ? selected.label : options.find((option) => option.value === '')?.label}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          {open && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="h-7 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>
              <ul
                id={listboxId}
                role="listbox"
                aria-label={label}
                className="max-h-60 overflow-y-auto p-1"
              >
                {options.map((option, index) => (
                  <li
                    key={option.value || '__empty__'}
                    role="option"
                    aria-selected={option.value === value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      select(option);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-foreground',
                      index === activeIndex && 'bg-accent',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </li>
                ))}
                {options.length === 0 && !loading && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</li>
                )}
              </ul>
            </div>
          )}
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  },
);
SearchableSelect.displayName = 'SearchableSelect';

export { SearchableSelect };
