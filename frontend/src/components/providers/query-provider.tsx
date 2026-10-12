'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { getBrowserQueryClient } from '@/lib/query';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getBrowserQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
