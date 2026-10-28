// File access boundary for pick / share / save. The default adapter reports
// every operation as unavailable and never fabricates a result; a native
// implementation is registered with `setFileAdapter` once its module has been
// verified for this build.

export type FileOperation = 'pick' | 'share' | 'save';

export type FileCapability = { available: true } | { available: false; reason: string };

export interface PickedFile {
  uri: string;
  name: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface PickOptions {
  /** MIME types the picker should offer, for example ['application/pdf']. */
  mimeTypes?: readonly string[];
  /** Upper bound enforced by the caller after the pick. */
  maxBytes?: number;
}

export interface FileTarget {
  uri: string;
  name: string;
  mimeType?: string;
}

export type FilePickResult =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export type FileActionResult =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export interface FileAdapter {
  capability(operation: FileOperation): FileCapability;
  pick(options?: PickOptions): Promise<FilePickResult>;
  share(file: FileTarget): Promise<FileActionResult>;
  save(file: FileTarget): Promise<FileActionResult>;
}

export const FILE_UNAVAILABLE_REASON = 'File access is not available in this build.';

export function createUnavailableFileAdapter(reason: string = FILE_UNAVAILABLE_REASON): FileAdapter {
  const unavailable = { status: 'unavailable', reason } as const;
  return {
    capability: () => ({ available: false, reason }),
    pick: async () => unavailable,
    share: async () => unavailable,
    save: async () => unavailable,
  };
}

let current: FileAdapter = createUnavailableFileAdapter();

export function getFileAdapter(): FileAdapter {
  return current;
}

/** Registers an implementation; passing nothing restores the unavailable default. */
export function setFileAdapter(adapter?: FileAdapter): void {
  current = adapter ?? createUnavailableFileAdapter();
}
