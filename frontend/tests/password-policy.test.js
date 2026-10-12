const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

async function loadPolicyModule() {
  const source = fs.readFileSync(path.join(root, 'src/lib/password-policy.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'password-policy.ts',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('short candidates report PASSWORD_TOO_SHORT', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  assert.equal(checkPasswordPolicy(''), 'PASSWORD_TOO_SHORT');
  assert.equal(checkPasswordPolicy('ab1'), 'PASSWORD_TOO_SHORT');
  assert.equal(checkPasswordPolicy('abcdefg'), 'PASSWORD_TOO_SHORT');
  assert.equal(checkPasswordPolicy('a1b2c3d'), 'PASSWORD_TOO_SHORT');
});

test('over-length and over-byte candidates report PASSWORD_TOO_LONG', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  // 129 chars is over the character cap even with digits+letters.
  assert.equal(checkPasswordPolicy('a'.repeat(128) + '1'), 'PASSWORD_TOO_LONG');
  // Just under the byte cap with letter+digit passes all client rules.
  const seventyOneBytes = 'a'.repeat(68) + 'é' + '1'; // 68+2+1 = 71 bytes
  assert.equal(checkPasswordPolicy(seventyOneBytes), null);
});

test('72-byte boundary is measured in UTF-8 bytes, not characters', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  // Exactly 72 bytes passes the byte rule (then needs letter+digit):
  // 70 ASCII letters + 'é' (2 bytes) = 72 bytes, has letter, add '1' → 73.
  const withinBytes = 'a'.repeat(69) + 'é' + '1'; // 69+2+1 = 72 bytes, 71 chars
  assert.equal(checkPasswordPolicy(withinBytes), null);
  // One byte over → TOO_LONG even though only 72 characters long.
  const overBytes = 'a'.repeat(70) + 'é' + '1'; // 70+2+1 = 73 bytes, 72 chars
  assert.equal(checkPasswordPolicy(overBytes), 'PASSWORD_TOO_LONG');
  // Multi-byte heavy string: 40 '€' chars = 120 bytes, well under 128 chars.
  assert.equal(checkPasswordPolicy('€'.repeat(39) + 'a1'), 'PASSWORD_TOO_LONG');
});

test('unicode letters count for the weakness rule', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  assert.equal(checkPasswordPolicy('đặtlại123'), null); // Vietnamese letters + digits
  assert.equal(checkPasswordPolicy('密碼123456'), null); // CJK letters + digits
  assert.equal(checkPasswordPolicy('onlyletters'), 'PASSWORD_TOO_WEAK'); // no digit
  assert.equal(checkPasswordPolicy('12345678!'), 'PASSWORD_TOO_WEAK'); // no letter
  assert.equal(checkPasswordPolicy('        9'), 'PASSWORD_TOO_WEAK'); // spaces are not letters
});

test('identity rule mirrors the backend local-part semantics', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  const email = 'sinhvien@campuscore.edu';
  // equality with full email or local-part, case-insensitive
  assert.equal(checkPasswordPolicy('SinhVien@CampusCore.edu', { email }), 'PASSWORD_CONTAINS_IDENTITY');
  assert.equal(checkPasswordPolicy('SINHVIEN', { email }), 'PASSWORD_CONTAINS_IDENTITY');
  // substring containment applies when the local-part has >= 4 chars
  assert.equal(checkPasswordPolicy('sinhvien1234', { email }), 'PASSWORD_CONTAINS_IDENTITY');
  // short local-part (<4 chars): substring containment must not fire
  assert.equal(checkPasswordPolicy('abc999zz', { email: 'abc@x.edu' }), null);
  // unrelated password passes when email is known
  assert.equal(checkPasswordPolicy('khonglienquan1', { email }), null);
  // without an email the rule is skipped entirely
  assert.equal(checkPasswordPolicy('sinhvien1234'), null);
});

test('email without @ uses the whole trimmed value as the local part', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  assert.equal(checkPasswordPolicy('MyPass9x', { email: 'mypass' }), 'PASSWORD_CONTAINS_IDENTITY');
  assert.equal(checkPasswordPolicy('unrelated9x', { email: 'mypass' }), null);
});

test('reused and confirmation checks run only when the option is supplied', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  assert.equal(
    checkPasswordPolicy('NewPass123', { currentPassword: 'NewPass123' }),
    'PASSWORD_REUSED',
  );
  assert.equal(
    checkPasswordPolicy('NewPass123', { currentPassword: 'OtherPass1' }),
    null,
  );
  assert.equal(
    checkPasswordPolicy('NewPass123', { confirmPassword: 'NewPass124' }),
    'PASSWORD_MISMATCH',
  );
  assert.equal(
    checkPasswordPolicy('NewPass123', { confirmPassword: 'NewPass123' }),
    null,
  );
  // no options → only the candidate rules apply
  assert.equal(checkPasswordPolicy('NewPass123'), null);
});

test('rule precedence matches the backend order', async () => {
  const { checkPasswordPolicy } = await loadPolicyModule();
  const email = 'student@campuscore.edu';
  // short wins over every other rule
  assert.equal(checkPasswordPolicy('stu', { email }), 'PASSWORD_TOO_SHORT');
  // identity reported before weakness (an identity-matching candidate with
  // no digit still reports identity, not weakness)
  assert.equal(
    checkPasswordPolicy('studentx', { email }),
    'PASSWORD_CONTAINS_IDENTITY',
  );
  // too-long wins over identity even when it contains the local part
  assert.equal(
    checkPasswordPolicy('student' + 'a'.repeat(200), { email }),
    'PASSWORD_TOO_LONG',
  );
});

test('mapPasswordErrorCode only recognizes the known code namespace', async () => {
  const { mapPasswordErrorCode } = await loadPolicyModule();
  for (const code of [
    'PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', 'PASSWORD_CONTAINS_IDENTITY',
    'PASSWORD_TOO_WEAK', 'PASSWORD_TOO_COMMON', 'PASSWORD_REUSED',
    'PASSWORD_MISMATCH', 'RESET_TOKEN_INVALID', 'INVALID_OLD_PASSWORD',
    'RATE_LIMIT_EXCEEDED',
  ]) {
    assert.equal(mapPasswordErrorCode(code), code);
  }
  assert.equal(mapPasswordErrorCode('VALIDATION_ERROR'), null);
  assert.equal(mapPasswordErrorCode(''), null);
  assert.equal(mapPasswordErrorCode(undefined), null);
  assert.equal(mapPasswordErrorCode('password_too_short'), null); // case-sensitive
});
