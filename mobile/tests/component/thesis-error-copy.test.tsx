import { describe, expect, test } from '@jest/globals';

import { thesisMessages } from '../../src/i18n/thesis-messages';
import { thesisErrorMessage } from '../../src/screens/thesis/thesis-model';

const codes = [
  'TOPIC_ROUND_MISMATCH',
  'TOPIC_NOT_PUBLISHED',
  'RESULT_ALREADY_RESOLVED',
  'TOPIC_ALREADY_GRADED',
  'TOPIC_FULL',
] as const;

describe('thesis assignment conflict copy', () => {
  test.each(['vi', 'en'] as const)('uses known-code guidance in %s', (locale) => {
    const copy = thesisMessages[locale];
    for (const code of codes) {
      const error = Object.assign(new Error('private server detail'), { status: 409, code });
      expect(thesisErrorMessage(copy, error)).toBe(copy.errors.codes[code]);
      expect(thesisErrorMessage(copy, error)).not.toBe(copy.errors.conflict);
    }
  });
});
