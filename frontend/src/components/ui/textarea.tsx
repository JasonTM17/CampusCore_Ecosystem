import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  hint?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, hint, 'aria-describedby': externalDescribedBy, ...props }, ref) => {
    const generatedId = React.useId().replace(/:/g, '');
    const errorId = `textarea-error-${generatedId}`;
    const hintId = `textarea-hint-${generatedId}`;
    const describedBy = [
      externalDescribedBy,
      error ? errorId : hint ? hintId : null,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    return (
      <div className="w-full">
        <textarea
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'flex min-h-[132px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
            error && 'border-destructive focus-visible:ring-destructive',
            className,
          )}
          {...props}
        />
        {error ? <p id={errorId} className="mt-1 text-sm text-destructive">{error}</p> : null}
        {!error && hint ? (
          <p id={hintId} className="mt-1 text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
