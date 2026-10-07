'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export type RegistrationTab = 'catalog' | 'registered';
const tabs: RegistrationTab[] = ['catalog', 'registered'];

/** Switches catalog/details panels with a roving keyboard tab stop; never resets browse state. */
export function RegistrationTabs({
  activeTab,
  onChange,
}: {
  activeTab: RegistrationTab;
  onChange: (tab: RegistrationTab) => void;
}) {
  const { messages } = useI18n();
  const copy = messages.courseRegistration;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Activates and focuses the adjacent or endpoint tab while keeping default Tab navigation. */
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    onChange(tabs[next]);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={copy.title} className="flex min-w-0 items-stretch gap-1 sm:gap-2">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          role="tab"
          id={`registration-tab-${tab}`}
          aria-controls={`registration-panel-${tab}`}
          aria-selected={activeTab === tab}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => navigate(event, index)}
          className={cn(
            'min-h-11 min-w-0 rounded-t-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5',
            activeTab === tab
              ? 'portal-page-tab border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-primary/5 hover:text-primary',
          )}
        >
          {tab === 'catalog' ? copy.title : copy.registeredTab}
        </button>
      ))}
    </div>
  );
}
