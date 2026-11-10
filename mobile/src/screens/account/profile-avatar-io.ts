import type { PickedFile } from '../../files/file-adapter';
import { bytesToBase64 } from '../content/attachment-transfer';
import {
  buildProfileAvatarDataUrl,
  isAllowedProfileAvatarMime,
  validateProfileAvatarDataUrl,
  type ProfileAvatarValidationError,
} from './profile-avatar-model';

export type ReadProfileAvatarResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: ProfileAvatarValidationError };

export async function readPickedProfileAvatar(file: PickedFile): Promise<ReadProfileAvatarResult> {
  if (!isAllowedProfileAvatarMime(file.mimeType)) return { ok: false, error: 'type' };
  try {
    const fs = require('expo-file-system') as {
      File?: new (uri: string) => { bytes(): Promise<Uint8Array> };
    };
    if (!fs?.File) return { ok: false, error: 'type' };
    const bytes = await new fs.File(file.uri).bytes();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const dataUrl = buildProfileAvatarDataUrl(file.mimeType ?? 'image/jpeg', bytesToBase64(buffer));
    const issue = validateProfileAvatarDataUrl(dataUrl);
    if (issue) return { ok: false, error: issue };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, error: 'type' };
  }
}
