'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n';
import { stripLocaleFromPathname } from '@/i18n/paths';
import { cn } from '@/lib/utils';
import { AssistantMascot } from './AssistantMascot';

const DynamicAssistantPanel = dynamic(
  () => import('./AssistantPanel').then((module) => module.AssistantPanel),
  { ssr: false },
);

type OpenDetail = { mode?: 'academic' | 'specialized'; trigger?: HTMLElement | null };

export function LazyAssistantPanel() {
  const { messages } = useI18n();
  const visiblePathname = usePathname();
  const pathname = stripLocaleFromPathname(visiblePathname ?? '/').pathname;
  const [requested, setRequested] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const pendingOpen = useRef<OpenDetail | null>(null);
  const suppressLauncher =
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/dashboard/assistant-specialized' ||
    pathname.startsWith('/dashboard/assistant-specialized/');

  useEffect(() => {
    const handleOpen = (event: Event) => {
      if (readyRef.current) return;
      pendingOpen.current = {
        ...(event as CustomEvent<OpenDetail>).detail,
        trigger: document.activeElement as HTMLElement | null,
      };
      setRequested(true);
    };
    window.addEventListener('open-campus-assistant', handleOpen);
    return () => window.removeEventListener('open-campus-assistant', handleOpen);
  }, []);

  const handleReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    // The panel calls this after installing its listener: the first activation
    // keeps its scope and original focus target even on a slow chunk download.
    const detail = pendingOpen.current;
    pendingOpen.current = null;
    if (detail) window.dispatchEvent(new CustomEvent('open-campus-assistant', { detail }));
  }, []);

  return (
    <>
      {requested ? <DynamicAssistantPanel onReady={handleReady} /> : null}
      {!ready && !suppressLauncher ? (
        <div className={cn(
          'fixed z-50 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-6 md:right-6',
          pathname === '/dashboard/register' ? 'hidden md:block' : '',
        )}>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-campus-assistant'))}
            aria-label={messages.assistant.open}
            title={messages.assistant.open}
            className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary via-[#004eab] to-[#005fcf] text-white shadow-[0_12px_28px_rgba(0,35,90,0.35)] ring-1 ring-black/5 transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none"
          >
            <AssistantMascot className="h-7 w-7 transition-transform duration-200 group-hover:scale-110" variant="detailed" />
            <span
              className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 rounded-full bg-portal-yellow ring-2 ring-card shadow-xs"
              aria-hidden="true"
            />
          </button>
        </div>
      ) : null}
    </>
  );
}
