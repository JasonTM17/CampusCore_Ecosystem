'use client';

import { Info } from 'lucide-react';

/** Published non-graded outcome (e.g. not eligible for defense): the result is
 * explicit text, never an empty score tile or a classification badge. */
export default function ThesisResultOutcome({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 p-5 sm:p-6"
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <p className="text-sm font-semibold text-foreground">{label}</p>
    </div>
  );
}
