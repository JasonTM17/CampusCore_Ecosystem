import type { FileAdapter, FileTarget, PickOptions } from '../files/file-adapter';

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const COURSEWORK_MIME_TYPES: readonly string[] = [
  ...DOCUMENT_MIME_TYPES,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'text/plain',
];
// The existing thesis file boundary uses the same adapter with its own server contract.
const REPORT_MAX_BYTES = 20 * 1024 * 1024;
const REPORT_MIME_TYPES: readonly string[] = [DOCUMENT_MIME_TYPES[0], DOCUMENT_MIME_TYPES[3], DOCUMENT_MIME_TYPES[4]];

const UNAVAILABLE = 'File access is not available in this build.';
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'application/msword': 'doc', [DOCUMENT_MIME_TYPES[4]]: 'docx',
  [COURSEWORK_MIME_TYPES[5]]: 'xlsx', [COURSEWORK_MIME_TYPES[6]]: 'pptx',
  'application/zip': 'zip', 'text/plain': 'txt',
};

/** A display name only. It is never used as a disk destination. */
export function sanitizeFileName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim().replace(/^\.+/, '').slice(0, 120) || 'attachment';
}

export class NativeFileError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'NativeFileError'; }
}

interface DiskFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  create(): void;
  delete(): void;
  copy(destination: DiskFile): void;
  write(content: string, options: { encoding: 'base64' }): void;
  open(): { writeBytes(bytes: Uint8Array): void; close(): void };
  bytes(): Promise<Uint8Array>;
}

/** Deliberately small structural surface so node tests can fake the native boundary. */
export interface NativeFileModules {
  os: string;
  fs?: { File: new (...parts: (string | { uri: string })[]) => DiskFile; Paths: { cache: { uri: string } } };
  picker?: { getDocumentAsync(options: { type: string[]; multiple: false; copyToCacheDirectory: true }): Promise<{
    canceled: boolean; assets: null | { uri: string; name: string; size?: number; mimeType?: string }[];
  }> };
  sharing?: { isAvailableAsync(): Promise<boolean>; shareAsync(uri: string, options: { mimeType?: string; dialogTitle?: string }): Promise<void> };
  fetch?: typeof globalThis.fetch;
}

export type TransferProgress = (bytesTransferred: number, totalBytes?: number) => void;
export interface DiskDownload {
  localUri: string;
  release(): void;
}

function abortIfNeeded(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new NativeFileError('REQUEST_ABORTED');
}

function validate(size: number, mime: string, maxBytes: number, types: readonly string[]) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new NativeFileError('ATTACHMENT_DATA_REQUIRED');
  if (size > maxBytes) throw new NativeFileError('ATTACHMENT_SIZE_INVALID');
  if (!types.includes(mime)) throw new NativeFileError('ATTACHMENT_TYPE_UNSUPPORTED');
}

export function createNativeFileRuntime(modules: NativeFileModules) {
  const fs = modules.os === 'android' || modules.os === 'ios' ? modules.fs : undefined;
  const owned = new Map<string, string>();
  let sequence = 0;
  const fresh = (mime: string) => {
    if (!fs) throw new NativeFileError('FILE_UNAVAILABLE');
    // No part of the destination comes from a server/picker name.
    const file = new fs.File(fs.Paths.cache,
      `attachment-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}.${MIME_EXTENSIONS[mime] ?? 'bin'}`);
    owned.set(file.uri, mime);
    return file;
  };
  const remove = (file: DiskFile) => {
    if (file.exists) file.delete();
    owned.delete(file.uri);
  };
  const cached = (uri: string) => {
    if (!fs || !uri.startsWith(fs.Paths.cache.uri.replace(/\/?$/, '/'))) return false;
    try {
      const relative = decodeURIComponent(uri.slice(fs.Paths.cache.uri.replace(/\/?$/, '/').length));
      return !!relative && !/[\\?#]/.test(relative)
        && relative.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
    } catch { return false; }
  };

  const unavailable = () => ({ status: 'unavailable', reason: UNAVAILABLE } as const);
  const action = async (target: FileTarget) => {
    if (!fs || !modules.sharing) return unavailable();
    let temporary: DiskFile | undefined;
    try {
      if (!await modules.sharing.isAvailableAsync()) return unavailable();
      if (target.uri.startsWith('data:')) {
        const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(target.uri);
        if (!match) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
        const mime = match[1].toLowerCase();
        const size = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
        validate(size, mime, REPORT_MIME_TYPES.includes(mime) ? REPORT_MAX_BYTES : ATTACHMENT_MAX_BYTES, COURSEWORK_MIME_TYPES);
        temporary = fresh(mime);
        temporary.create();
        temporary.write(match[2], { encoding: 'base64' });
      } else {
        // Only this runtime's generated files can be exported. Never arbitrary file:// or remote URLs.
        if (!owned.has(target.uri)) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
        temporary = new fs.File(target.uri);
      }
      const mimeType = owned.get(temporary.uri);
      if (target.mimeType && target.mimeType.split(';')[0].trim().toLowerCase() !== mimeType) {
        throw new NativeFileError('ATTACHMENT_TYPE_UNSUPPORTED');
      }
      await modules.sharing.shareAsync(temporary.uri, { mimeType, dialogTitle: sanitizeFileName(target.name) });
      return { status: 'done' } as const;
    } catch (error) {
      return { status: 'failed', reason: error instanceof NativeFileError ? error.code : 'ERROR' } as const;
    } finally {
      if (temporary) {
        try { remove(temporary); } catch { return { status: 'failed', reason: 'ERROR' } as const; }
      }
    }
  };

  const adapter: FileAdapter = {
    capability: operation => fs && (operation === 'pick' ? modules.picker : modules.sharing)
      ? { available: true } : { available: false, reason: UNAVAILABLE },
    async pick(options: PickOptions = {}) {
      if (!fs || !modules.picker) return unavailable();
      let source: DiskFile | undefined;
      let copy: DiskFile | undefined;
      try {
        const types = options.mimeTypes ?? COURSEWORK_MIME_TYPES;
        const result = await modules.picker.getDocumentAsync({ type: [...types], multiple: false, copyToCacheDirectory: true });
        if (result.canceled) return { status: 'cancelled' };
        const asset = result.assets?.[0];
        if (!asset || !cached(asset.uri)) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
        source = new fs.File(asset.uri);
        const mime = (asset.mimeType ?? '').toLowerCase();
        // Stat the copied file: picker metadata can be absent or wrong.
        validate(source.size, mime, options.maxBytes ?? ATTACHMENT_MAX_BYTES, types);
        copy = fresh(mime);
        source.copy(copy);
        validate(copy.size, mime, options.maxBytes ?? ATTACHMENT_MAX_BYTES, types);
        return { status: 'picked', file: { uri: copy.uri, name: sanitizeFileName(asset.name), mimeType: mime, sizeBytes: copy.size } };
      } catch (error) {
        if (copy) {
          try { remove(copy); } catch { return { status: 'failed', reason: 'ERROR' }; }
        }
        return { status: 'failed', reason: error instanceof NativeFileError ? error.code : 'ERROR' };
      } finally {
        if (source) {
          try { remove(source); } catch {
            if (copy) { try { remove(copy); } catch { /* Return only a safe result. */ } }
            return { status: 'failed', reason: 'ERROR' };
          }
        }
      }
    },
    share: action,
    save: action,
  };

  async function streamDownload(response: Response, signal?: AbortSignal | null, onProgress?: TransferProgress,
    maxBytes = ATTACHMENT_MAX_BYTES, mimeTypes: readonly string[] = COURSEWORK_MIME_TYPES): Promise<DiskDownload> {
    try { return await writeDownload(response, signal, onProgress, maxBytes, mimeTypes); }
    catch (error) {
      // Also stop the native response when validation rejects before a file/reader exists.
      if (!response.body?.locked) await response.body?.cancel().catch(() => {});
      throw error;
    }
  }

  async function writeDownload(response: Response, signal: AbortSignal | null | undefined, onProgress: TransferProgress | undefined,
    maxBytes: number, mimeTypes: readonly string[]): Promise<DiskDownload> {
    if (!fs) throw new NativeFileError('FILE_UNAVAILABLE');
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const length = response.headers.get('content-length');
    const expected = length === null ? undefined : Number(length);
    if (!mimeTypes.includes(mime)) throw new NativeFileError('ATTACHMENT_TYPE_UNSUPPORTED');
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected > maxBytes)) {
      throw new NativeFileError('ATTACHMENT_SIZE_INVALID');
    }
    abortIfNeeded(signal);
    const reader = response.body?.getReader();
    if (!reader) throw new NativeFileError('FILE_UNAVAILABLE');
    const file = fresh(mime);
    let handle: ReturnType<DiskFile['open']> | undefined;
    let complete = false;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      file.create();
      handle = file.open();
      let written = 0;
      onProgress?.(0, expected);
      for (;;) {
        abortIfNeeded(signal);
        const { done, value } = await reader.read();
        abortIfNeeded(signal);
        if (done) break;
        written += value.byteLength;
        if (written > maxBytes) throw new NativeFileError('ATTACHMENT_SIZE_INVALID');
        handle.writeBytes(value);
        onProgress?.(written, expected);
      }
      validate(written, mime, maxBytes, mimeTypes);
      if (expected !== undefined && written !== expected) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
      handle.close();
      handle = undefined;
      complete = true;
      return { localUri: file.uri, release: () => remove(file) };
    } finally {
      signal?.removeEventListener('abort', abort);
      try { handle?.close(); } finally {
        if (!complete) { await reader.cancel().catch(() => {}); remove(file); }
        reader.releaseLock();
      }
    }
  }

  function prepareUpload(form: FormData, path: string): FormData {
    if (!fs) throw new NativeFileError('FILE_UNAVAILABLE');
    const parts = (form as unknown as { _parts?: [string, unknown][] })._parts
      ?? Array.from(form.entries());
    const prepared = new FormData();
    const report = /^\/thesis\/groups\/[^/]+\/report\/file$/.test(path);
    const types = report ? REPORT_MIME_TYPES : /^\/(admissions|careers)\//.test(path) ? DOCUMENT_MIME_TYPES : COURSEWORK_MIME_TYPES;
    const maxBytes = report ? REPORT_MAX_BYTES : ATTACHMENT_MAX_BYTES;
    for (const [name, value] of parts) {
      if (typeof value === 'object' && value !== null && 'uri' in value) {
        const part = value as { uri: string; name?: string; type?: string };
        if (!cached(part.uri)) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
        const file = new fs.File(part.uri);
        const mime = (part.type ?? '').toLowerCase();
        validate(file.size, mime, maxBytes, types);
        // SDK 57 expo/fetch accepts File-like bytes(), but rejects RN's URI-only descriptor.
        prepared.append(name, { name: sanitizeFileName(part.name ?? 'attachment'), type: mime,
          bytes: async () => {
            const bytes = await file.bytes();
            validate(bytes.byteLength, mime, maxBytes, types);
            return bytes;
          } } as unknown as Blob);
      } else {
        if (value instanceof Blob) validate(value.size, value.type.toLowerCase(), maxBytes, types);
        prepared.append(name, value as string | Blob);
      }
    }
    return prepared;
  }

  async function readDiskDownload(download: DiskDownload): Promise<ArrayBuffer> {
    if (!fs || !owned.has(download.localUri)) throw new NativeFileError('ATTACHMENT_DATA_INVALID');
    const bytes = await new fs.File(download.localUri).bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  return { adapter, streamDownload, prepareUpload, readDiskDownload, fetch: modules.fetch };
}

export type NativeFileRuntime = ReturnType<typeof createNativeFileRuntime>;

/** Missing native binaries and web are capability results, never import-time crashes. */
export function loadNativeFileRuntime(): ReturnType<typeof createNativeFileRuntime> | undefined {
  try {
    const os = (require('react-native') as { Platform: { OS: string } }).Platform.OS;
    if (os !== 'android' && os !== 'ios') return undefined;
    const fs = require('expo-file-system') as NonNullable<NativeFileModules['fs']>;
    if (!fs.File || !fs.Paths?.cache?.uri) return undefined;
    let picker: NativeFileModules['picker'];
    let sharing: NativeFileModules['sharing'];
    try { picker = require('expo-document-picker'); } catch { /* Partial native build. */ }
    try { sharing = require('expo-sharing'); } catch { /* Partial native build. */ }
    const nativeFetch = (require('expo/fetch') as { fetch: typeof globalThis.fetch }).fetch;
    return createNativeFileRuntime({ os, fs, picker, sharing, fetch: nativeFetch });
  } catch { return undefined; }
}

let nativeRuntime: ReturnType<typeof createNativeFileRuntime> | undefined;
let checked = false;
export function getNativeFileRuntime() {
  if (!checked) { nativeRuntime = loadNativeFileRuntime(); checked = true; }
  return nativeRuntime;
}
