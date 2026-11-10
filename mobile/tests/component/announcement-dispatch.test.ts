import { describe, expect, test } from '@jest/globals';

import {
  dispatchProseDate,
  dispatchReference,
  dispatchSubjectHeading,
} from '../../src/screens/content/announcement-dispatch';

describe('announcement dispatch presentation', () => {
  test('dispatch reference matches the web hash algorithm', () => {
    expect(dispatchReference({ id: 'n1', title: 'Notice' })).toMatch(/^\d{3}\/TB-ĐHCNKT-ĐT$/);
  });

  test('vietnamese subject lines gain the V/v prefix', () => {
    expect(dispatchSubjectHeading('THÔNG BÁO đăng ký')).toBe('V/v đăng ký');
    expect(dispatchSubjectHeading('Course registration')).toBe('V/v Course registration');
  });

  test('vietnamese prose dates use day month year wording', () => {
    const line = dispatchProseDate('vi', new Date('2026-10-28T08:00:00Z'));
    expect(line).toMatch(/năm 2026$/);
    expect(line.toLowerCase()).toContain('tháng');
  });
});
