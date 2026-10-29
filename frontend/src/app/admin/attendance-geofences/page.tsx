'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { geofencedAttendanceApi } from '@/lib/api';
import {
  buildOsmMarkerUrl,
  isUnverifiedGeofence,
  validateGeofenceDraft,
  type GeofenceDraft,
} from '@/lib/attendance-checkin';
import { campusCodeMessage } from '@/lib/campus-error';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminTableCard,
  AdminTableScroll,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import type { components } from '@/types/generated-api';

type GeofenceRow = components['schemas']['AttendanceGeofenceResponse'];

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; row: GeofenceRow };

const EMPTY_DRAFT: GeofenceDraft = {
  name: '',
  campusCode: '',
  centerLat: '',
  centerLng: '',
  radiusMeters: '150',
  isActive: false,
  note: '',
};

function draftFromRow(row: GeofenceRow): GeofenceDraft {
  return {
    name: row.name ?? '',
    campusCode: row.campusCode ?? '',
    centerLat: row.centerLat != null ? String(row.centerLat) : '',
    centerLng: row.centerLng != null ? String(row.centerLng) : '',
    radiusMeters: row.radiusMeters != null ? String(row.radiusMeters) : '',
    isActive: Boolean(row.isActive),
    note: row.note ?? '',
  };
}

export default function AdminAttendanceGeofencesPage() {
  const {
    user,
    isAdmin,
    isSuperAdmin,
    isLoading: isAuthLoading,
    isLoggingOut,
  } = useAuth();
  const { formatNumber, href, messages } = useI18n();
  const copy = messages.attendanceGeofence.admin;
  const router = useRouter();
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const [rows, setRows] = useState<GeofenceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<GeofenceDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<
    ReturnType<typeof validateGeofenceDraft>['errors']
  >({});
  const [draftApiError, setDraftApiError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

  useEffect(() => {
    if (isAuthLoading || isLoggingOut) {
      return;
    }
    if (!user) {
      router.replace(`${href('/login')}?portal=admin&reason=session-expired`);
      return;
    }
    if (!isAdmin && !isSuperAdmin) {
      router.replace(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, isAuthLoading, isLoggingOut, router, user]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const list = await geofencedAttendanceApi.listAdminGeofences();
      setRows(list ?? []);
    } catch (loadError) {
      setError(campusCodeMessage(loadError, copy.errors));
    } finally {
      setIsLoading(false);
    }
  }, [copy.errors]);

  useEffect(() => {
    if (canAccess) {
      void load();
    }
  }, [canAccess, load]);

  const openCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setDraftApiError('');
    setEditor({ mode: 'create' });
  }, []);

  const openEdit = useCallback((row: GeofenceRow) => {
    setDraft(draftFromRow(row));
    setDraftErrors({});
    setDraftApiError('');
    setEditor({ mode: 'edit', row });
  }, []);

  const errorFor = useCallback(
    (field: keyof GeofenceDraft): string | undefined => {
      const kind = draftErrors[field as keyof typeof draftErrors];
      if (!kind) return undefined;
      if (kind === 'required') return copy.requiredError;
      if (kind === 'tooLong') return copy.tooLongError;
      if (kind === 'invalid') return copy.numberError;
      switch (field) {
        case 'centerLat':
          return copy.latRangeError;
        case 'centerLng':
          return copy.lngRangeError;
        default:
          return copy.radiusRangeError;
      }
    },
    [copy, draftErrors],
  );

  const submitEditor = useCallback(async () => {
    const { errors, values } = validateGeofenceDraft(draft);
    setDraftErrors(errors);
    if (!values) return;

    setSaving(true);
    setDraftApiError('');
    try {
      if (editor?.mode === 'edit' && editor.row.id) {
        const updated = await geofencedAttendanceApi.updateAdminGeofence(
          editor.row.id,
          values,
        );
        setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      } else {
        const created = await geofencedAttendanceApi.createAdminGeofence(values);
        setRows((prev) => [...prev, created]);
      }
      setEditor(null);
    } catch (saveError) {
      setDraftApiError(campusCodeMessage(saveError, copy.errors));
    } finally {
      setSaving(false);
    }
  }, [copy.errors, draft, editor]);

  const toggleActive = useCallback(
    async (row: GeofenceRow) => {
      if (!row.id) return;
      const activating = !row.isActive;
      const accepted = await confirm({
        title: activating ? copy.activateTitle : copy.deactivateTitle,
        message: activating ? copy.activateMessage : copy.deactivateMessage,
        confirmText: activating ? copy.activateAction : copy.deactivateAction,
        cancelText: messages.common.actions.cancel,
        variant: activating ? 'default' : 'destructive',
        // The seeded row is a placeholder — surface the verification warning
        // inside its activation confirm rather than blocking the action.
        warning:
          activating && isUnverifiedGeofence(row) ? copy.seededWarningBody : undefined,
      });
      if (!accepted) return;

      setToggleBusyId(row.id);
      try {
        const { values } = validateGeofenceDraft(draftFromRow(row));
        if (!values) {
          // A stored row that no longer validates cannot be toggled without
          // first fixing its coordinates in the editor.
          openEdit(row);
          return;
        }
        const updated = await geofencedAttendanceApi.updateAdminGeofence(row.id, {
          ...values,
          isActive: activating,
        });
        setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } catch (toggleError) {
        setError(campusCodeMessage(toggleError, copy.errors));
      } finally {
        setToggleBusyId(null);
      }
    },
    [confirm, copy, messages.common.actions.cancel, openEdit],
  );

  const draftMapUrl = buildOsmMarkerUrl(
    Number(draft.centerLat),
    Number(draft.centerLng),
  );
  const hasSeededRow = rows.some(isUnverifiedGeofence);

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={messages.common.states.loading} className="m-8" />;
  }

  return (
    <AdminFrame title={copy.title} description={copy.description}>
      <div className="space-y-6" data-testid="checkin-geofences">
        {hasSeededRow ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning-foreground"
            data-testid="checkin-seeded-warning"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{copy.seededWarningTitle}</p>
              <p className="mt-0.5">{copy.seededWarningBody}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {formatNumber(rows.length)} {copy.listTitle}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={isLoading}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {messages.common.actions.retry}
            </Button>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {copy.newAction}
            </Button>
          </div>
        </div>

        {error ? (
          <ErrorState
            title={copy.loadError}
            description={error}
            onRetry={() => void load()}
          />
        ) : isLoading ? (
          <LoadingState label={messages.common.states.loading} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={copy.empty}
            description={copy.emptyDescription}
          />
        ) : (
          <AdminTableCard title={copy.listTitle}>
            <AdminTableScroll>
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-muted-foreground">
                    <th className="px-2 py-3 font-medium">{copy.colName}</th>
                    <th className="px-2 py-3 font-medium">{copy.colCampus}</th>
                    <th className="px-2 py-3 font-medium">{copy.colCentre}</th>
                    <th className="px-2 py-3 font-medium">{copy.colRadius}</th>
                    <th className="px-2 py-3 font-medium">{copy.colStatus}</th>
                    <th className="px-2 py-3 font-medium">{copy.colNote}</th>
                    <th className="px-2 py-3 text-right font-medium">{copy.colActions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((row) => {
                    const unverified = isUnverifiedGeofence(row);
                    const mapUrl = buildOsmMarkerUrl(
                      row.centerLat ?? Number.NaN,
                      row.centerLng ?? Number.NaN,
                    );
                    const busy = toggleBusyId === row.id;
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-secondary/30">
                        <td className="px-2 py-4">
                          <p className="font-medium text-foreground">{row.name}</p>
                          {unverified ? (
                            <StatusPill tone="warning" className="mt-1">
                              {copy.unverifiedChip}
                            </StatusPill>
                          ) : null}
                        </td>
                        <td className="px-2 py-4 font-mono text-xs text-muted-foreground">
                          {row.campusCode || '—'}
                        </td>
                        <td className="px-2 py-4 tabular-nums text-muted-foreground">
                          {row.centerLat != null && row.centerLng != null ? (
                            <span className="inline-flex items-center gap-1.5">
                              {row.centerLat.toFixed(6)}, {row.centerLng.toFixed(6)}
                              {mapUrl ? (
                                <a
                                  href={mapUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={`${copy.checkOnMap} — ${row.name}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              ) : null}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-4 tabular-nums text-muted-foreground">
                          {row.radiusMeters != null
                            ? `${formatNumber(row.radiusMeters)} m`
                            : '—'}
                        </td>
                        <td className="px-2 py-4">
                          <StatusPill tone={row.isActive ? 'success' : 'neutral'}>
                            {row.isActive ? copy.statusActive : copy.statusInactive}
                          </StatusPill>
                        </td>
                        <td className="px-2 py-4">
                          <span
                            className="inline-block max-w-[14rem] truncate align-middle text-muted-foreground"
                            title={row.note ?? ''}
                          >
                            {row.note || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(row)}
                              aria-label={`${copy.edit} — ${row.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              {copy.edit}
                            </Button>
                            <Button
                              type="button"
                              variant={row.isActive ? 'destructive' : 'outline'}
                              size="sm"
                              onClick={() => void toggleActive(row)}
                              disabled={busy}
                              aria-label={
                                row.isActive
                                  ? `${copy.deactivate} — ${row.name}`
                                  : `${copy.activate} — ${row.name}`
                              }
                            >
                              <Power className="h-3.5 w-3.5" aria-hidden="true" />
                              {busy
                                ? messages.common.states.loading
                                : row.isActive
                                  ? copy.deactivate
                                  : copy.activate}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.mode === 'edit' ? copy.editTitle : copy.createTitle}
      >
        <form
          className="space-y-4"
          data-testid="checkin-geofence-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitEditor();
          }}
          noValidate
        >
          <div>
            <label htmlFor="checkin-geofence-name" className="mb-1 block text-sm font-medium text-foreground">
              {copy.nameLabel}
            </label>
            <Input
              id="checkin-geofence-name"
              value={draft.name}
              onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              placeholder={copy.namePlaceholder}
              disabled={saving}
              error={errorFor('name')}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="checkin-geofence-campus" className="mb-1 block text-sm font-medium text-foreground">
              {copy.campusCodeLabel}
            </label>
            <Input
              id="checkin-geofence-campus"
              value={draft.campusCode}
              onChange={(event) => setDraft((d) => ({ ...d, campusCode: event.target.value }))}
              placeholder={copy.campusCodePlaceholder}
              disabled={saving}
              error={errorFor('campusCode')}
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="checkin-geofence-lat" className="mb-1 block text-sm font-medium text-foreground">
                {copy.latLabel}
              </label>
              <Input
                id="checkin-geofence-lat"
                value={draft.centerLat}
                onChange={(event) => setDraft((d) => ({ ...d, centerLat: event.target.value }))}
                placeholder={copy.latPlaceholder}
                inputMode="decimal"
                disabled={saving}
                error={errorFor('centerLat')}
                hint={errorFor('centerLat') ? undefined : copy.latHint}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="checkin-geofence-lng" className="mb-1 block text-sm font-medium text-foreground">
                {copy.lngLabel}
              </label>
              <Input
                id="checkin-geofence-lng"
                value={draft.centerLng}
                onChange={(event) => setDraft((d) => ({ ...d, centerLng: event.target.value }))}
                placeholder={copy.lngPlaceholder}
                inputMode="decimal"
                disabled={saving}
                error={errorFor('centerLng')}
                hint={errorFor('centerLng') ? undefined : copy.lngHint}
                autoComplete="off"
              />
            </div>
          </div>
          <div>
            <label htmlFor="checkin-geofence-radius" className="mb-1 block text-sm font-medium text-foreground">
              {copy.radiusLabel}
            </label>
            <Input
              id="checkin-geofence-radius"
              value={draft.radiusMeters}
              onChange={(event) => setDraft((d) => ({ ...d, radiusMeters: event.target.value }))}
              placeholder={copy.radiusPlaceholder}
              inputMode="numeric"
              disabled={saving}
              error={errorFor('radiusMeters')}
              hint={errorFor('radiusMeters') ? undefined : copy.radiusHint}
              autoComplete="off"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) =>
                setDraft((d) => ({ ...d, isActive: event.target.checked }))
              }
              disabled={saving}
              className="h-4 w-4 rounded border-input text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {copy.activeLabel}
          </label>
          <div className="space-y-1.5">
            <label htmlFor="checkin-geofence-note" className="text-sm font-medium text-foreground">
              {copy.noteLabel}
            </label>
            <Textarea
              id="checkin-geofence-note"
              value={draft.note}
              onChange={(event) => setDraft((d) => ({ ...d, note: event.target.value }))}
              disabled={saving}
              error={errorFor('note')}
              className="min-h-[88px]"
            />
          </div>

          {editor?.mode === 'edit' && editor.row && isUnverifiedGeofence(editor.row) ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2.5 text-sm text-status-warning-foreground"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {copy.seededWarningBody}
            </div>
          ) : null}

          {draftApiError ? (
            <p role="alert" className="text-sm text-destructive">
              {draftApiError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {draftMapUrl ? (
              <a
                href={draftMapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {copy.checkOnMap}
              </a>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                {messages.common.actions.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? copy.saving : copy.save}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
      {confirmationDialog}
    </AdminFrame>
  );
}
