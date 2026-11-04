'use client';

import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

const NARROW_VIEWPORT_QUERY = '(max-width: 600px)';

function subscribeToNarrowViewport(onChange: () => void) {
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getNarrowViewportSnapshot() {
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

function getServerViewportSnapshot() {
  return false;
}

export function ResponsiveToaster() {
  const isNarrowViewport = useSyncExternalStore(
    subscribeToNarrowViewport,
    getNarrowViewportSnapshot,
    getServerViewportSnapshot,
  );

  return <Toaster position={isNarrowViewport ? 'bottom-right' : 'top-right'} />;
}
