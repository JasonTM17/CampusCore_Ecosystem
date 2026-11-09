import { afterEach, describe, expect, jest, test } from '@jest/globals';

const mockGet = jest.fn<(path: string) => Promise<unknown>>();
const mockEnrollments = jest.fn<(semesterId?: string) => Promise<unknown>>();
const mockSummary = jest.fn<(semesterId?: string) => Promise<unknown>>();

jest.mock('../../src/api/client', () => ({
  apiClient: { get: (path: string) => mockGet(path), mode: 'live' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: {
    enrollments: (semesterId?: string) => mockEnrollments(semesterId),
    registrationSummary: (semesterId?: string) => mockSummary(semesterId),
  },
}));

import { academicApi } from '../../src/screens/academic/academic-api';

afterEach(() => {
  jest.clearAllMocks();
});

describe('dashboard academic read', () => {
  test('scopes enrollments and the credit summary to the preferred semester', async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: 'sem-1', name: 'Học kỳ 2 năm học 2025-2026', status: 'CLOSED' },
        { id: 'sem-2', name: 'Học kỳ 1 năm học 2026-2027', nameVi: 'Học kỳ 1 năm học 2026-2027', status: 'IN_PROGRESS' },
      ],
    });
    mockEnrollments.mockResolvedValue([{ id: 'enr-1', sectionId: 'sec-1', semesterId: 'sem-2', status: 'ENROLLED' }]);
    mockSummary.mockResolvedValue({ creditLimit: 24, creditsUsed: 3, creditsRemaining: 21 });

    const result = await academicApi.dashboard();

    expect(mockEnrollments).toHaveBeenCalledWith('sem-2');
    expect(mockSummary).toHaveBeenCalledWith('sem-2');
    expect(result.semesterId).toBe('sem-2');
    expect(result.semester?.name).toBe('Học kỳ 1 năm học 2026-2027');
    expect(result.creditLimit).toBe(24);
    expect(result.enrollments).toHaveLength(1);
  });

  test('a closed registration round leaves the credit cap unknown instead of failing', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 'sem-1', name: 'Học kỳ 1', status: 'IN_PROGRESS' }] });
    mockEnrollments.mockResolvedValue([]);
    mockSummary.mockRejectedValue(Object.assign(new Error('closed'), { code: 'WINDOW_CLOSED' }));

    const result = await academicApi.dashboard();

    expect(result.creditLimit).toBeNull();
    expect(result.enrollments).toEqual([]);
  });
});
