import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { fillCopy, type AcademicCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
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
  /** The settled workspace value; false clears the basket and blocks Register. */
  roundOpen?: boolean;
}

/** Selection, idempotent enroll and drop. Offline blocks every mutation; a failure keeps the selection. */
export function useRegistrationActions({ copy, locale, preview, knownOffline, reload, catalogIds, roundOpen }: RegistrationActionsInput) {
  const [basket, dispatch] = useReducer(basketReducer, emptyBasket);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RegistrationNotice | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (roundOpen === false) dispatch({ type: 'clear' });
    else if (catalogIds.length > 0) dispatch({ type: 'prune', validIds: catalogIds });
  }, [catalogIds, roundOpen]);

  const blocked = useCallback(async (): Promise<boolean> => {
    if (preview || inFlight.current) return true;
    // Take the lock before the offline probe: a second tap inside that await
    // window must not start a parallel mutation loop.
    inFlight.current = true;
    let offline = false;
    try {
      offline = knownOffline || (await isDeviceOffline());
    } catch {
      offline = true;
    }
    if (!offline) return false;
    setNotice({ tone: 'error', text: copy.offlineNoMutation });
    inFlight.current = false;
    return true;
  }, [copy, knownOffline, preview]);

  const registerSelected = useCallback(async () => {
    if (roundOpen === false || await blocked()) return;
    setBusy(true);
    setNotice(null);
    try {
      let registered = 0;
      let offline = false;
      let hiddenFailure: string | null = null;
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
          const messageKey = registrationErrorKey(code) ?? 'generic';
          dispatch({ type: 'fail', sectionId, failure: { code, messageKey } });
          // A failed section that left the catalog has no row to carry its error.
          if (!catalogIds.includes(sectionId)) hiddenFailure = messageKey;
        }
      }
      if (offline) setNotice({ tone: 'error', text: copy.offlineNoMutation });
      else if (hiddenFailure) setNotice({ tone: 'error', text: copy.errors[hiddenFailure] ?? copy.errors.generic });
      else if (registered > 0) setNotice({ tone: 'success', text: fillCopy(countForm(registered, copy.registeredOne, copy.registered), { n: registered }) });
      // The lock covers the refresh that withdraws the just-enrolled Select.
      await reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [basket.selected, blocked, catalogIds, copy, locale, reload, roundOpen]);

  const drop = useCallback(async (enrollmentId: string) => {
    if (await blocked()) return;
    setBusy(true);
    setNotice(null);
    try {
      try {
        await dropEnrollmentById(enrollmentId);
        setNotice({ tone: 'success', text: copy.dropped });
      } catch (error) {
        const code = (error as { code?: string } | null)?.code ?? null;
        setNotice({ tone: 'error', text: isOfflineError(error) ? copy.offlineNoMutation : copy.errors[registrationErrorKey(code) ?? 'generic'] });
      }
      // The row leaves the screen only when the workspace read returns; the lock
      // must cover that read or a second tap drops an enrollment already gone.
      await reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [blocked, copy, reload]);

  return { basket, dispatch, busy, notice, registerSelected, drop };
}
