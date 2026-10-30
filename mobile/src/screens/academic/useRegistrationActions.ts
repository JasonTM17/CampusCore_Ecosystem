import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { fillCopy, type AcademicCopy } from '../../i18n/academic-messages';
import { dropEnrollmentById, enrollInSection, isDeviceOffline, isOfflineError } from './academic-api';
import { basketReducer, emptyBasket } from './registration-basket';
import { registrationErrorKey } from './registration-browse';

export interface RegistrationNotice {
  tone: 'success' | 'error';
  text: string;
}

export interface RegistrationActionsInput {
  copy: AcademicCopy;
  locale: 'vi' | 'en';
  /** Preview data never reaches the server. */
  preview: boolean;
  /** The last read failed because the device is offline. */
  knownOffline: boolean;
  reload: () => Promise<void>;
  /** Section ids still in the catalog; selections for vanished sections are dropped. */
  catalogIds: readonly string[];
}

/** Selection, idempotent enroll and drop. Offline blocks every mutation; a failure keeps the selection. */
export function useRegistrationActions({ copy, locale, preview, knownOffline, reload, catalogIds }: RegistrationActionsInput) {
  const [basket, dispatch] = useReducer(basketReducer, emptyBasket);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RegistrationNotice | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (catalogIds.length > 0) dispatch({ type: 'prune', validIds: catalogIds });
  }, [catalogIds]);

  const blocked = useCallback(async (): Promise<boolean> => {
    if (preview || inFlight.current) return true;
    if (knownOffline || (await isDeviceOffline())) {
      setNotice({ tone: 'error', text: copy.offlineNoMutation });
      return true;
    }
    return false;
  }, [copy, knownOffline, preview]);

  const registerSelected = useCallback(async () => {
    if (await blocked()) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    let registered = 0;
    let offline = false;
    for (const sectionId of basket.selected) {
      try {
        await enrollInSection(sectionId, locale);
        dispatch({ type: 'succeed', sectionId });
        registered += 1;
      } catch (error) {
        if (isOfflineError(error)) {
          offline = true;
          break;
        }
        const code = (error as { code?: string } | null)?.code ?? null;
        dispatch({ type: 'fail', sectionId, failure: { code, messageKey: registrationErrorKey(code) ?? 'generic' } });
      }
    }
    if (offline) setNotice({ tone: 'error', text: copy.offlineNoMutation });
    else if (registered > 0) setNotice({ tone: 'success', text: fillCopy(copy.registered, { n: registered }) });
    inFlight.current = false;
    setBusy(false);
    await reload();
  }, [basket.selected, blocked, copy, locale, reload]);

  const drop = useCallback(async (enrollmentId: string) => {
    if (await blocked()) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await dropEnrollmentById(enrollmentId);
      setNotice({ tone: 'success', text: copy.dropped });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? null;
      setNotice({ tone: 'error', text: isOfflineError(error) ? copy.offlineNoMutation : copy.errors[registrationErrorKey(code) ?? 'generic'] });
    }
    inFlight.current = false;
    setBusy(false);
    await reload();
  }, [blocked, copy, reload]);

  return { basket, dispatch, busy, notice, registerSelected, drop };
}
