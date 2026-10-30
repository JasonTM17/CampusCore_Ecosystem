// File pick, upload and download flow for admissions, careers and learning.
// The device file adapter is injected, so with the default (unavailable)
// adapter every step reports `unavailable` and nothing is fabricated. Upload
// attempts reuse one idempotency key until the outcome is known.

import type { FileAdapter, PickedFile } from '../../files/file-adapter';
import { sanitizeFileName, type DiskDownload } from '../../api/native-file-adapter';
import type { AttemptKeys } from '../academic/idempotency-attempts';

/** Same ceiling as the server's multipart lanes. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

const PDF = 'application/pdf';
const PNG = 'image/png';
const JPEG = 'image/jpeg';
const DOC = 'application/msword';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface AttachmentPolicy {
  maxBytes: number;
  mimeTypes: readonly string[];
}

/** Applicant and candidate documents (admissions, careers). */
export const DOCUMENT_POLICY: AttachmentPolicy = { maxBytes: ATTACHMENT_MAX_BYTES, mimeTypes: [PDF, PNG, JPEG, DOC, DOCX] };
/** Coursework submissions. */
export const COURSEWORK_POLICY: AttachmentPolicy = {
  maxBytes: ATTACHMENT_MAX_BYTES,
  mimeTypes: [PDF, PNG, JPEG, DOC, DOCX, XLSX, PPTX, 'application/zip', 'text/plain'],
};

export type FileProblem = 'empty' | 'too_large' | 'type';

export type FileCheck = { ok: true } | { ok: false; problem: FileProblem };

/** Declared size and type are checked before a byte is sent; the server stays the final authority. */
export function checkPickedFile(file: PickedFile, policy: AttachmentPolicy): FileCheck {
  if (typeof file.sizeBytes === 'number') {
    if (file.sizeBytes <= 0) return { ok: false, problem: 'empty' };
    if (file.sizeBytes > policy.maxBytes) return { ok: false, problem: 'too_large' };
  }
  if (file.mimeType && !policy.mimeTypes.includes(file.mimeType.toLowerCase())) {
    return { ok: false, problem: 'type' };
  }
  return { ok: true };
}

export type PickOutcome =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'invalid'; problem: FileProblem }
  | { status: 'failed'; reason: string };

export async function pickForUpload(adapter: FileAdapter, policy: AttachmentPolicy): Promise<PickOutcome> {
  const capability = adapter.capability('pick');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  const picked = await adapter.pick({ mimeTypes: policy.mimeTypes, maxBytes: policy.maxBytes });
  if (picked.status !== 'picked') return picked;
  const check = checkPickedFile(picked.file, policy);
  return check.ok ? picked : { status: 'invalid', problem: check.problem };
}

/** The `{ uri, name, type }` descriptor React Native's multipart body takes. */
export function toUploadPart(file: PickedFile): { uri: string; name: string; type: string } {
  return { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' };
}

export type UploadOutcome<T> =
  | { status: 'done'; result: T }
  | { status: 'failed'; error: unknown };

/**
 * One upload attempt. The idempotency key is scoped to the intent and the file,
 * and survives a failure whose outcome is unknown so a retry cannot attach the
 * file twice.
 */
export async function uploadPicked<T>(
  file: PickedFile,
  options: {
    keys: AttemptKeys;
    intent: string;
    upload: (part: { uri: string; name: string; type: string }, idempotencyKey: string) => Promise<T>;
  },
): Promise<UploadOutcome<T>> {
  const scope = `${options.intent}:${file.uri}:${file.sizeBytes ?? 0}`;
  const key = options.keys.keyFor('upload', scope);
  try {
    const result = await options.upload(toUploadPart(file), key);
    options.keys.settle('upload', scope);
    return { status: 'done', result };
  } catch (error) {
    options.keys.settle('upload', scope, error);
    return { status: 'failed', error };
  }
}

/* ---------- download ---------- */

export interface DownloadedBytes {
  data: ArrayBuffer;
  contentType: string | null;
  fileName: string | null;
}

export type DownloadOutcome =
  | { status: 'done' | 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Native results stay on disk; byte-only callers retain the compatibility lane. */
export async function downloadToDevice(
  adapter: FileAdapter,
  fetchBytes: () => Promise<DownloadedBytes & Partial<DiskDownload>>,
  fallbackName: string,
): Promise<DownloadOutcome> {
  const capability = adapter.capability('save');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  let file: (DownloadedBytes & Partial<DiskDownload>) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let released = false;
  let cleanupFailed = false;
  const release = () => {
    if (file?.release && !released) {
      file.release();
      released = true;
    }
  };
  try {
    // Loading the helper must not initialize native session storage (preview,
    // unavailable adapters and component-only environments also import it).
    const { sessionStore } = await import('../../auth/mobile-session-store');
    const epoch = sessionStore.sessionEpoch();
    const stale = () => sessionStore.sessionEpoch() !== epoch;
    file = await fetchBytes();
    if (stale()) return { status: 'failed', reason: 'SESSION_CHANGED' };
    if (!file.localUri && file.data.byteLength === 0) return { status: 'failed', reason: 'EMPTY' };
    if (file.localUri) {
      if (!file.release) return { status: 'failed', reason: 'ERROR' };
      // The transport stops watching when it returns. Keep the disk file scoped
      // to this session even while the native sheet is still pending.
      timer = setInterval(() => {
        if (stale()) {
          clearInterval(timer);
          try { release(); } catch { cleanupFailed = true; }
        }
      }, 100);
    }
    const mimeType = file.contentType ?? 'application/octet-stream';
    const result = await adapter.save({
      uri: file.localUri ?? `data:${mimeType};base64,${bytesToBase64(file.data)}`,
      // A native title comes only from the adapter's generated destination.
      // Legacy display names are reduced to a bounded, safe path segment.
      name: sanitizeFileName(file.localUri ?? file.fileName ?? fallbackName),
      mimeType,
    });
    return stale() ? { status: 'failed', reason: 'SESSION_CHANGED' } : result;
  } catch (error) {
    return { status: 'failed', reason: (error as { code?: string } | null)?.code ?? 'ERROR' };
  } finally {
    if (timer !== undefined) clearInterval(timer);
    try { release(); } catch { cleanupFailed = true; }
    if (cleanupFailed) return { status: 'failed', reason: 'ERROR' };
  }
}

/** Display state of a file row for the row's own transfer. */
export type TransferState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done' }
  | { status: 'failed' }
  | { status: 'unavailable' };

export function transferStateOf(outcome: DownloadOutcome | PickOutcome | { status: 'invalid' }): TransferState {
  switch (outcome.status) {
    case 'done': return { status: 'done' };
    case 'unavailable': return { status: 'unavailable' };
    case 'failed':
    case 'invalid': return { status: 'failed' };
    default: return { status: 'idle' };
  }
}
