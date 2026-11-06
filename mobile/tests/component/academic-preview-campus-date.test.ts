import { describe, expect, it, jest } from '@jest/globals';

describe('academic preview campus dates', () => {
  it('anchors the preview term to the campus calendar across a device date boundary', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-05T11:00:00Z'));
    const deviceDate = Date;
    const originalGetFullYear = deviceDate.prototype.getFullYear;
    const originalGetMonth = deviceDate.prototype.getMonth;
    const originalGetDate = deviceDate.prototype.getDate;
    const originalSetDate = deviceDate.prototype.setDate;
    const deviceOffsetMs = 14 * 60 * 60 * 1000;
    const localDate = (instant: number) => new deviceDate(instant + deviceOffsetMs);
    deviceDate.prototype.getFullYear = function getDeviceYear() { return localDate(this.getTime()).getUTCFullYear(); };
    deviceDate.prototype.getMonth = function getDeviceMonth() { return localDate(this.getTime()).getUTCMonth(); };
    deviceDate.prototype.getDate = function getDeviceDate() { return localDate(this.getTime()).getUTCDate(); };
    deviceDate.prototype.setDate = function setDeviceDate(day: number) {
      const local = localDate(this.getTime());
      local.setUTCDate(day);
      return this.setTime(local.getTime() - deviceOffsetMs);
    };

    try {
      expect(new Date().getDate()).toBe(6);
      jest.isolateModules(() => {
        const { previewSemester } = require('../../src/screens/academic/academic-preview') as typeof import('../../src/screens/academic/academic-preview');
        expect(previewSemester.startDate).toBe('2026-09-10');
        expect(previewSemester.endDate).toBe('2026-12-31');
      });
    } finally {
      deviceDate.prototype.getFullYear = originalGetFullYear;
      deviceDate.prototype.getMonth = originalGetMonth;
      deviceDate.prototype.getDate = originalGetDate;
      deviceDate.prototype.setDate = originalSetDate;
      jest.useRealTimers();
    }
  });
});
