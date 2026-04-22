import * as React from 'react';
import { AlertCircle, LucideIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface StateBlockProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = AlertCircle,
  title,
  description,
  action,
  className,
}: StateBlockProps) {
  return (
    <div
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-card/70 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { messages } = useI18n();

  return (
    <div
      className={cn(
        'rounded-lg border border-destructive/30 bg-destructive/5 p-6',
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {retryLabel || messages.common.actions.retry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({
  label,
  className,
}: LoadingStateProps) {
  const { messages } = useI18n();

  return (
    <div
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-lg border border-border/70 bg-card/70 px-6 py-10',
        className,
      )}
      >
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      <p className="text-sm text-muted-foreground">
        {label || messages.common.states.loadingContent}
      </p>
    </div>
  );
}
