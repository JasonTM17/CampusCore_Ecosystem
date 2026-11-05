// Report file pick and download through the injected file adapter. With the
// default adapter every step reports `unavailable`; nothing is fabricated.

import type { FileAdapter, FilePickResult, PickedFile } from '../../files/file-adapter';
import {
  THESIS_REPORT_FILE_MAX_BYTES,
  THESIS_REPORT_MIME_TYPES,
  reportMimeType,
  validateReportFile,
  type ReportFileIssue,
} from './thesis-model';
import type { ReportFilePart } from './thesis-api';

export type ReportPickOutcome =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'invalid'; issue: ReportFileIssue }
  | { status: 'failed'; reason: string };

/** The server checks type, size and signature again; this only avoids a doomed upload. */
export async function pickReportFile(adapter: FileAdapter): Promise<ReportPickOutcome> {
  let picked: FilePickResult;
  try {
    const capability = adapter.capability('pick');
    if (!capability.available) return { status: 'unavailable', reason: capability.reason };
    picked = await adapter.pick({ mimeTypes: THESIS_REPORT_MIME_TYPES, maxBytes: THESIS_REPORT_FILE_MAX_BYTES });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { status: 'failed', reason: typeof code === 'string' ? code : 'ERROR' };
  }
  if (picked.status !== 'picked') return picked;
  const issue = validateReportFile(picked.file);
  // A rejected pick returns ownership at once; only a kept file is the caller's.
  if (issue) picked.file.release?.();
  return issue ? { status: 'invalid', issue } : picked;
}

/** The `{ uri, name, type }` descriptor React Native sends as a multipart file part. */
export function toReportPart(file: PickedFile): ReportFilePart {
  return { uri: file.uri, name: file.name, type: reportMimeType(file.name) };
}

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export interface DownloadedReport {
  data: ArrayBuffer;
  contentType: string | null;
  fileName: string | null;
  /** Streamed file lane; the adapter consumes this owned URI instead of the bytes. */
  localUri?: string;
  release?: () => void;
}

export type ReportDownloadOutcome =
  | { status: 'done' | 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

/** Fetches through the authenticated client, then hands the bytes to the device save sheet. */
export async function saveReportFile(
  adapter: FileAdapter,
  fetchBytes: () => Promise<DownloadedReport>,
  fallbackName: string,
): Promise<ReportDownloadOutcome> {
  const capability = adapter.capability('save');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  let file: DownloadedReport | undefined;
  try {
    file = await fetchBytes();
    const name = file.fileName ?? fallbackName;
    const mimeType = file.contentType && file.contentType !== 'application/octet-stream' ? file.contentType : reportMimeType(name);
    if (file.localUri) {
      // A streamed download already owns a cache file: share the URI as-is.
      return await adapter.save({ uri: file.localUri, name, mimeType });
    }
    if (file.data.byteLength === 0) return { status: 'failed', reason: 'EMPTY' };
    return await adapter.save({ uri: `data:${mimeType};base64,${bytesToBase64(file.data)}`, name, mimeType });
  } catch (error) {
    return { status: 'failed', reason: (error as { code?: string } | null)?.code ?? 'ERROR' };
  } finally {
    file?.release?.();
  }
}
