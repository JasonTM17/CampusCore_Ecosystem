import { expect, test } from '@playwright/test';
import {
  adminRoutes,
  apiUrl,
  buildCookieHeaders,
  expectOkResponse,
  getSharedSessionArtifacts,
  seedBrowserSession,
  studentRoutes,
  visitRoutes,
} from './helpers';

test('student finance routes expose invoice list and detail through the public finance boundary', async ({
  page,
  playwright,
}) => {
  const studentApi = await playwright.request.newContext();

  try {
    const session = await getSharedSessionArtifacts(playwright, 'student');
    const loginData = session.authData;
    const invoicesResponse = await studentApi.get(apiUrl('/finance/my/invoices'), {
      headers: buildCookieHeaders(session),
    });
    await expectOkResponse(
      invoicesResponse,
      'GET /finance/my/invoices',
    );

    const invoices = (await invoicesResponse.json()) as Array<{
      id: string;
      invoiceNumber: string;
    }>;
    expect(Array.isArray(invoices)).toBe(true);

    if (invoices.length > 0) {
      const invoiceDetailResponse = await studentApi.get(
        apiUrl(`/finance/my/invoices/${invoices[0].id}`),
        {
          headers: buildCookieHeaders(session),
        },
      );
      await expectOkResponse(
        invoiceDetailResponse,
        'GET /finance/my/invoices/:id',
      );
      const detail = await invoiceDetailResponse.json();
      expect(detail.invoiceNumber).toBe(invoices[0].invoiceNumber);
      expect(Array.isArray(detail.items)).toBe(true);
    }

    await seedBrowserSession(page, playwright, 'student', { shared: true });
    await page.goto('/dashboard/invoices');
    await visitRoutes(
      page,
      studentRoutes.filter((route) => route.path === '/dashboard/invoices'),
    );

    expect(loginData.user.studentId).toBeTruthy();
  } finally {
    await studentApi.dispose();
  }
});

test('engagement and analytics routes remain reachable through their service boundaries', async ({
  page,
  playwright,
}) => {
  const adminApi = await playwright.request.newContext();

  try {
    const session = await getSharedSessionArtifacts(playwright, 'admin');
    const loginData = session.authData;
    const authHeaders = {
      ...buildCookieHeaders(session),
      Authorization: `Bearer ${loginData.accessToken}`,
    };

    const announcementsResponse = await adminApi.get(apiUrl('/announcements'), {
      headers: authHeaders,
    });
    await expectOkResponse(announcementsResponse, 'GET /announcements');

    const supportTicketsResponse = await adminApi.get(
      apiUrl('/support-tickets'),
      {
        headers: authHeaders,
      },
    );
    await expectOkResponse(
      supportTicketsResponse,
      'GET /support-tickets',
    );

    const analyticsResponse = await adminApi.get(apiUrl('/analytics/overview'), {
      headers: authHeaders,
    });
    await expectOkResponse(analyticsResponse, 'GET /analytics/overview');
    const analytics = await analyticsResponse.json();
    expect(typeof analytics.totalStudents).toBe('number');

    await seedBrowserSession(page, playwright, 'admin', { shared: true });
    await page.goto('/admin');
    await visitRoutes(
      page,
      adminRoutes.filter((route) =>
        ['/admin/announcements', '/admin/invoices', '/admin/analytics'].includes(
          route.path,
        ),
      ),
    );
  } finally {
    await adminApi.dispose();
  }
});
