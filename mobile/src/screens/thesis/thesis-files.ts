// Report file pick and download through the injected file adapter. With the
// default adapter every step reports `unavailable`; nothing is fabricated.

import type { FileAdapter, PickedFile } from '../../files/file-adapter';
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
  const capability = adapter.capability('pick');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  const picked = await adapter.pick({ mimeTypes: THESIS_REPORT_MIME_TYPES, maxBytes: THESIS_REPORT_FILE_MAX_BYTES });
  if (picked.status !== 'picked') return picked;
  const issue = validateReportFile(picked.file);
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
  try {
    const file = await fetchBytes();
    if (file.data.byteLength === 0) return { status: 'failed', reason: 'EMPTY' };
    const name = file.fileName ?? fallbackName;
    const mimeType = file.contentType && file.contentType !== 'application/octet-stream' ? file.contentType : reportMimeType(name);
    return await adapter.save({ uri: `data:${mimeType};base64,${bytesToBase64(file.data)}`, name, mimeType });
  } catch (error) {
    return { status: 'failed', reason: (error as { code?: string } | null)?.code ?? 'ERROR' };
  }
}
