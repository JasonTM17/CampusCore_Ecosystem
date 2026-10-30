import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const FILES = {
  content: ['src/i18n/content-messages.ts', 'contentMessages'],
  campus: ['src/i18n/campus-messages.ts', 'campusMessages'],
  records: ['src/i18n/records-messages.ts', 'recordsMessages'],
  library: ['src/i18n/library-messages.ts', 'libraryMessages'],
  careers: ['src/i18n/careers-messages.ts', 'careersMessages'],
  admissions: ['src/i18n/admissions-messages.ts', 'admissionsMessages'],
  learning: ['src/i18n/learning-messages.ts', 'learningMessages'],
};

const leaves = (value, prefix = '') => Object.entries(value).flatMap(([key, entry]) => (
  entry && typeof entry === 'object' ? leaves(entry, `${prefix}${key}.`) : [[`${prefix}${key}`, entry]]
));

for (const [name, [file, exportName]] of Object.entries(FILES)) {
  const messages = (await loadTs(file))[exportName];

  test(`${name} messages: vi and en carry the same keys, all non-empty`, () => {
    assert.deepEqual(leaves(messages.vi).map(([key]) => key).sort(), leaves(messages.en).map(([key]) => key).sort());
    for (const locale of ['vi', 'en']) {
      for (const [key, text] of leaves(messages[locale])) {
        assert.equal(typeof text, 'string', `${name}.${locale}.${key}`);
        assert.ok(text.trim(), `${name}.${locale}.${key} is empty`);
      }
    }
  });

  test(`${name} messages: placeholders match between vi and en`, () => {
    const en = new Map(leaves(messages.en));
    const holes = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [key, text] of leaves(messages.vi)) assert.equal(holes(text), holes(en.get(key)), `${name}.${key}`);
  });
}

test('the Vietnamese copy is actually Vietnamese for the main actions', () => {
  // A copied English string would pass the parity checks above, so spot-check key actions.
  const check = async (file, exportName, keys) => {
    const messages = (await loadTs(file))[exportName];
    for (const key of keys) assert.notEqual(messages.vi[key], messages.en[key], `${exportName}.${key} is untranslated`);
  };
  return Promise.all([
    check('src/i18n/library-messages.ts', 'libraryMessages', ['hold', 'cancel', 'myLoans', 'emptyLoans']),
    check('src/i18n/careers-messages.ts', 'careersMessages', ['apply', 'withdraw', 'myApplications']),
    check('src/i18n/admissions-messages.ts', 'admissionsMessages', ['submit', 'withdraw', 'fullName']),
    check('src/i18n/learning-messages.ts', 'learningMessages', ['submit', 'saveDraft', 'materials']),
    check('src/i18n/content-messages.ts', 'contentMessages', ['offline', 'pickFile', 'fileSave']),
  ]);
});
