import { describe, expect, test } from '@jest/globals';
import { parseCheckinLink } from '../../src/attendance-checkin/checkin-link';

const id = '12345678-1234-4abc-8def-123456789abc';
describe('lecturer check-in links', () => {
  test.each([
    `campuscore://attendance/checkin/${id}`,
    `https://www.campusute.io.vn/attendance/checkin/${id}`,
  ])('accepts only a session identifier from %s', (link) => {
    expect(parseCheckinLink(link)).toEqual({ ok: true, sessionId: id });
  });
  test.each([
    `https://campusute.io.vn.evil.com/attendance/checkin/${id}`,
    `https://www.campusute.io.vn.evil.com/attendance/checkin/${id}`,
    `https://www.campusute.io.vn@evil.com/attendance/checkin/${id}`,
    `https://evil.com@www.campusute.io.vn/attendance/checkin/${id}`,
    `HTTPS://www.campusute.io.vn/attendance/checkin/${id}`,
    `CAMPUSCORE://attendance/checkin/${id}`,
    `http://www.campusute.io.vn/attendance/checkin/${id}`,
    `https://campusute.io.vn/attendance/checkin/${id}`,
    'campuscore://attendance/checkin/',
    `campuscore://attendance/checkin/../checkin/${id}`,
    `campuscore://attendance/checkin/%2e%2e/${id}`,
    `campuscore://attendance/checkin/${id}?code=123456`,
    `campuscore://attendance/checkin/${id}?latitude=10&longitude=106`,
    `campuscore://attendance/checkin/${id}?`,
    `campuscore://attendance/checkin/${id}#`,
    `campuscore://attendance/checkin/${id}/`,
    `https://www.campusute.io.vn:443/attendance/checkin/${id}`,
    `campuscore://attendance\\checkin\\${id}`,
    ` campuscore://attendance/checkin/${id}`,
    `campuscore://attendance/checkin/${id}\n`,
    'campuscore://attendance/checkin/session_123',
    '',
  ])('rejects unexpected target or embedded authority in %s', (link) => {
    expect(parseCheckinLink(link).ok).toBe(false);
  });
});
