import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const {
  MAX_AVATAR_DATA_URL_LENGTH,
  buildProfileAvatarDataUrl,
  buildProfileUpdatePayload,
  isAllowedProfileAvatarMime,
  profileAvatarDirty,
  validateProfileAvatarDataUrl,
} = await loadTs('src/screens/account/profile-avatar-model.ts');

test('allowed avatar mime types match the web profile picker', () => {
  assert.equal(isAllowedProfileAvatarMime('image/png'), true);
  assert.equal(isAllowedProfileAvatarMime('image/jpeg'), true);
  assert.equal(isAllowedProfileAvatarMime('image/webp'), true);
  assert.equal(isAllowedProfileAvatarMime('application/pdf'), false);
});

test('profile save payload carries phone, address and avatar together', () => {
  const avatar = 'data:image/png;base64,abcd';
  assert.deepEqual(buildProfileUpdatePayload('0901', 'Addr', avatar), {
    phone: '0901',
    address: 'Addr',
    avatar,
  });
});

test('rejects oversize avatar data URLs at the web length cap', () => {
  const prefix = 'data:image/jpeg;base64,';
  const payload = 'A'.repeat(MAX_AVATAR_DATA_URL_LENGTH - prefix.length + 1);
  assert.equal(validateProfileAvatarDataUrl(prefix + payload), 'too-large');
});

test('avatar dirty tracks staged preview against the saved value', () => {
  assert.equal(profileAvatarDirty('data:image/png;base64,x', 'data:image/png;base64,x'), false);
  assert.equal(profileAvatarDirty('', null), false);
  assert.equal(profileAvatarDirty('data:image/png;base64,y', 'data:image/png;base64,x'), true);
});

test('data URL builder normalizes mime and strips whitespace', () => {
  const dataUrl = buildProfileAvatarDataUrl('IMAGE/JPEG; charset=utf-8', 'YWJj\n');
  assert.equal(dataUrl, 'data:image/jpeg;base64,YWJj');
  assert.equal(validateProfileAvatarDataUrl(dataUrl), null);
});
