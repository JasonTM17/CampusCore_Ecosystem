/** Mirrors frontend/src/app/dashboard/profile/page.tsx avatar limits. */
export const PROFILE_AVATAR_PICK_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_AVATAR_DATA_URL_LENGTH = 200_000;

export function normalizeAvatarMime(mime: string | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

export function isAllowedProfileAvatarMime(mime: string | undefined): boolean {
  return (PROFILE_AVATAR_PICK_MIME_TYPES as readonly string[]).includes(normalizeAvatarMime(mime));
}

export function buildProfileAvatarDataUrl(mime: string, base64: string): string {
  const normalized = normalizeAvatarMime(mime);
  return `data:${normalized};base64,${base64.replace(/\s/g, '')}`;
}

export type ProfileAvatarValidationError = 'type' | 'too-large';

const DATA_URI = /^data:([^;,]+)((?:;[^,]*)?),([\s\S]*)$/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

export function validateProfileAvatarDataUrl(dataUrl: string): ProfileAvatarValidationError | null {
  const match = DATA_URI.exec(dataUrl);
  if (!match) return 'type';
  const mime = normalizeAvatarMime(match[1]);
  if (!isAllowedProfileAvatarMime(mime)) return 'type';
  const payload = match[3].replace(/\s/g, '');
  if (!BASE64_BODY.test(payload)) return 'type';
  if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) return 'too-large';
  return null;
}

export function profileAvatarDirty(preview: string, saved: string | null | undefined): boolean {
  return preview !== (saved ?? '');
}

export function buildProfileUpdatePayload(phone: string, address: string, avatar: string) {
  return { phone, address, avatar };
}
