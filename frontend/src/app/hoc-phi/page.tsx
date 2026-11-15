'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  CreditCard,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import { bursarApi, type BursarInvoice } from '@/lib/api';
import { useApiQuery } from '@/lib/query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { campusCodeMessage, campusErrorCode } from '@/lib/campus-error';
import { countLabel } from '@/lib/plural';
import { toast } from 'sonner';

function invoiceStatusKey(status: string): 'statusOpen' | 'statusPaid' | 'statusPartial' | 'statusCancelled' | 'statusOverdue' {
  switch (status) {
    case 'PAID':
      return 'statusPaid';
    case 'PARTIALLY_PAID':
      return 'statusPartial';
    case 'CANCELLED':
      return 'statusCancelled';
    case 'OVERDUE':
      return 'statusOverdue';
    default:
      return 'statusOpen';
  }
}

export default function TuitionPage() {
  const { locale, messages, formatNumber, formatCurrency, formatDate } = useI18n();
  const copy = messages.tuitionPage;
  const { user, isLoading: authLoading, hasAccess, isForbidden } = useRequireAuth(['STUDENT']);
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  const canLoad = hasAccess && !isForbidden;

  const accountQuery = useApiQuery(['bursar', 'account', user?.id ?? ''], () => bursarApi.account(), {
    enabled: canLoad,
    staleTime: 60_000,
  });
  const invoicesQuery = useApiQuery(
    ['bursar', 'invoices', user?.id ?? ''],
    () => bursarApi.invoices(),
    { enabled: canLoad, staleTime: 60_000 },
  );

  const payMutation = useMutation({
    mutationFn: (invoice: BursarInvoice) =>
      bursarApi.pay(invoice.id, {
        amount: Math.max(1, Math.round(invoice.remaining)),
        method: 'DEMO',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bursar'] });
      toast.success(copy.paySuccess);
    },
    onError: (cause) => {
      const code = campusErrorCode(cause);
      toast.error(code ? campusCodeMessage(cause, messages.common.campusErrors) : copy.payFailed);
    },
    onSettled: () => setPaying(null),
  });

  const pay = async (invoice: BursarInvoice) => {
    const ok = await confirm({
      title: copy.payConfirmTitle,
      message: copy.payConfirmMessage
        .replace('{amount}', formatCurrency(invoice.remaining, 'VND'))
        .replace('{term}', invoice.term),
      confirmText: copy.payAction,
    });
    if (!ok) return;
    setPaying(invoice.id);
    payMutation.mutate(invoice);
  };

  if (authLoading) {
    return <LoadingState label={messages.common.states.loadingContent} />;
  }
  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  const account = accountQuery.data;
  const invoices = invoicesQuery.data ?? [];
  const holds = account?.holds ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {messages.courseRegistrationPro.backToDashboard}
          </Link>
        </div>

        <PageHeader
          eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
          title={copy.title}
          description={copy.description}
        />

        {accountQuery.isError && invoicesQuery.isError && (
          <div className="mt-6">
            <ErrorState
              title={copy.loadFailed}
              description={copy.accountUnavailable}
              onRetry={() => {
                void accountQuery.refetch();
                void invoicesQuery.refetch();
              }}
            />
          </div>
        )}

        {account && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {copy.balanceLabel}
                </p>
                <p
                  className={`mt-1 text-2xl font-bold ${
                    account.balance > 0 ? 'text-status-danger-foreground' : 'text-foreground'
                  }`}
                >
                  {formatCurrency(account.balance, 'VND')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {copy.holdsTitle}
                </p>
                {holds.length === 0 ? (
                  <p className="mt-1 flex items-center gap-2 text-sm text-status-success-foreground">
                    <CheckCircle2 className="h-4 w-4" /> —
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {holds.map((hold) => (
                      <li
                        key={hold.id}
                        className="flex items-center gap-2 text-sm text-status-danger-foreground"
                      >
                        <Ban className="h-4 w-4 shrink-0" />
                        {copy.holdReasonTuition} ·{' '}
                        {copy.holdActive.replace('{date}', formatDate(hold.createdAt))}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4" />
              {copy.invoicesTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invoicesQuery.isPending && (
              <LoadingState label={messages.common.states.loadingContent} />
            )}
            {invoicesQuery.isError && (
              <ErrorState
                title={copy.loadFailed}
                description={copy.accountUnavailable}
                onRetry={() => void invoicesQuery.refetch()}
              />
            )}
            {invoicesQuery.isSuccess && invoices.length === 0 && (
              <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
            )}
            {invoices.map((invoice) => {
              const statusKey = invoiceStatusKey(invoice.status);
              const open = expanded === invoice.id;
              const payable = invoice.status !== 'PAID' && invoice.status !== 'CANCELLED';
              return (
                <div key={invoice.id} className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : invoice.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {copy.invoiceTerm.replace('{term}', invoice.term)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {copy.invoiceIssued.replace('{date}', formatDate(invoice.issuedAt))}
                        {invoice.dueAt
                          ? ` · ${copy.invoiceDue.replace('{date}', formatDate(invoice.dueAt))}`
                          : ''}
                        {invoice.paidAt
                          ? ` · ${copy.invoicePaidAt.replace('{date}', formatDate(invoice.paidAt))}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">
                        {formatCurrency(invoice.total, 'VND')}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          invoice.status === 'PAID'
                            ? 'bg-status-success/10 text-status-success-foreground'
                            : invoice.status === 'OVERDUE'
                              ? 'bg-status-danger/10 text-status-danger-foreground'
                              : 'bg-status-warning/10 text-status-warning-foreground'
                        }`}
                      >
                        {copy[statusKey]}
                      </span>
                      {payable && (
                        <Button
                          size="sm"
                          disabled={paying === invoice.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void pay(invoice);
                          }}
                          className="gap-1.5"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          {paying === invoice.id ? '…' : copy.payAction}
                        </Button>
                      )}
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-border px-4 py-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {copy.itemsHeader}
                      </p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-1 font-medium">{copy.itemsHeader}</th>
                            <th className="pb-1 font-medium">{copy.itemUnitPrice}</th>
                            <th className="pb-1 text-right font-medium">{copy.itemAmount}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoice.items.map((item) => (
                            <tr key={item.id} className="border-t border-border/60">
                              <td className="py-1.5">
                                {item.label}
                                {item.courseCode && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {item.courseCode} ·{' '}
                                    {copy.itemCredits.replace(
                                      '{count}',
                                      formatNumber(item.credits),
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 text-muted-foreground">
                                {formatCurrency(item.unitPrice, 'VND')}
                              </td>
                              <td className="py-1.5 text-right font-medium">
                                {formatCurrency(item.amount, 'VND')}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-border">
                            <td className="py-1.5 font-semibold">{copy.totalLabel}</td>
                            <td />
                            <td className="py-1.5 text-right font-semibold">
                              {formatCurrency(invoice.total, 'VND')}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      {confirmationDialog}
    </div>
  );
}
