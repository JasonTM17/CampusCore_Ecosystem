/**
 * Shared client-side upload contract for the base64 attachment lanes
 * (admissions, careers, learning).
 *
 * Backend truth (java-services/restful-api):
 * - These lanes POST the file as base64 inside a JSON body, so the binding
 *   ceiling is JsonBodyCapFilter.MAX_JSON_BYTES_GLOBAL = 1 MiB of request
 *   body — not the 5 MiB MultipartAttachment.MAX_BYTES, which only the
 *   sibling multipart endpoints enforce. Base64 inflates by 4/3, so the
 *   theoretical max file is ~768 KiB minus the JSON envelope.
 * - The envelope shares the body with fileName, contentType, checksum and —
 *   for learning submissions — the caller's textBody, so the cap is set well
 *   under the theoretical bound (a ~90 KiB margin for companions).
 * - The multipart policies also define the intended type allowlists:
 *   DOCUMENTS (admissions, careers) and COURSEWORK (learning, adds
 *   spreadsheets, slides, archives and plain text). The base64 lane stores
 *   contentType verbatim, so the allowlist is mirrored here as intent.
 */
export const UPLOAD_MAX_BYTES = 700 * 1024;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  DOCX,
]);

const COURSEWORK_MIME_TYPES = new Set([
  ...DOCUMENT_MIME_TYPES,
  XLSX,
  PPTX,
  'application/zip',
  'text/plain',
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.doc': 'application/msword',
  '.docx': DOCX,
  '.xlsx': XLSX,
  '.pptx': PPTX,
  '.zip': 'application/zip',
  '.txt': 'text/plain',
};

/** `accept` strings mirroring the backend lane allowlists. */
export const UPLOAD_ACCEPT_DOCUMENTS = '.pdf,.png,.jpg,.jpeg,.doc,.docx';
export const UPLOAD_ACCEPT_COURSEWORK =
  `${UPLOAD_ACCEPT_DOCUMENTS},.xlsx,.pptx,.zip,.txt`;

export type UploadLane = 'documents' | 'coursework';
export type UploadRejection = 'too-large' | 'type-unsupported';

/** Null when the file is uploadable; otherwise the rejection reason. */
export function validateUploadFile(
  file: { name: string; size: number; type: string },
  lane: UploadLane,
): UploadRejection | null {
  if (file.size > UPLOAD_MAX_BYTES) {
    return 'too-large';
  }
  const allowed = lane === 'coursework' ? COURSEWORK_MIME_TYPES : DOCUMENT_MIME_TYPES;
  if (file.type) {
    return allowed.has(file.type.toLowerCase()) ? null : 'type-unsupported';
  }
  // Platforms that report no MIME type fall back to the file extension —
  // the extension the `accept` filter already advertised.
  const dot = file.name.lastIndexOf('.');
  const mime = dot >= 0 ? EXTENSION_MIME_TYPES[file.name.slice(dot).toLowerCase()] : undefined;
  return mime && allowed.has(mime) ? null : 'type-unsupported';
}

/** Error thrown by upload helpers before the file bytes are ever read. */
export class UploadValidationError extends Error {
  readonly code: 'UPLOAD_TOO_LARGE' | 'UPLOAD_TYPE_UNSUPPORTED';

  constructor(rejection: UploadRejection) {
    super(rejection === 'too-large' ? 'File exceeds the upload size limit' : 'File type is not supported');
    this.name = 'UploadValidationError';
    this.code = rejection === 'too-large' ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_TYPE_UNSUPPORTED';
  }
}

export function assertUploadFile(
  file: { name: string; size: number; type: string },
  lane: UploadLane,
): void {
  const rejection = validateUploadFile(file, lane);
  if (rejection) {
    throw new UploadValidationError(rejection);
  }
}
