import { expect, test } from '@playwright/test';
import {
  apiUrl,
  buildCookieHeaders,
  expectOkResponse,
  getSharedSessionArtifacts,
  seedBrowserSession,
} from './helpers';

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('student checkout completes through the provider handoff and syncs the invoice timeline', async ({
  page,
  playwright,
}) => {
  const studentApi = await playwright.request.newContext();

  try {
    const session = await getSharedSessionArtifacts(playwright, 'student');
    const invoicesResponse = await studentApi.get(apiUrl('/finance/my/invoices'), {
      headers: buildCookieHeaders(session),
    });
    await expectOkResponse(invoicesResponse, 'GET /finance/my/invoices');

    const invoices = (await invoicesResponse.json()) as Array<{
      id: string;
      invoiceNumber: string;
      status: string;
      balance: number;
    }>;
    const targetInvoice = invoices.find((invoice) => invoice.balance > 0);

    expect(targetInvoice, 'Expected at least one invoice with an outstanding balance').toBeTruthy();

    await seedBrowserSession(page, playwright, 'student', { shared: true });
    await page.goto('/dashboard/invoices');

    await page
      .getByRole('button', {
        name: new RegExp(
          `View details for invoice ${escapeForRegExp(
            targetInvoice!.invoiceNumber,
          )}`,
          'i',
        ),
      })
      .click();

    await expect(
      page.getByRole('heading', { name: /Invoice details|Chi tiết hóa đơn/i }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^MoMo$/i }).click();
    await expect(
      page.getByRole('button', { name: /Continue to provider/i }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Continue to provider/i }).click();
    await expect(page).toHaveURL(
      /\/api\/v1\/finance\/payment-providers\/momo\/handoff\//,
    );
    await expect(
      page.getByRole('link', { name: /Complete payment/i }),
    ).toBeVisible();

    await page.getByRole('link', { name: /Complete payment/i }).click();
    await expect(page).toHaveURL(/dashboard\/invoices/);
    await expect(
      page.getByRole('heading', { name: /Invoice details|Chi tiết hóa đơn/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/Confirmed|Paid|Đã xác nhận|Đã thanh toán/i).first(),
    ).toBeVisible();

    const detailResponse = await studentApi.get(
      apiUrl(`/finance/my/invoices/${targetInvoice!.id}`),
      {
        headers: buildCookieHeaders(session),
      },
    );
    await expectOkResponse(detailResponse, 'GET /finance/my/invoices/:id');
    const detail = await detailResponse.json();

    expect(detail.status).toBe('PAID');
    expect(Array.isArray(detail.payments)).toBe(true);
    expect(detail.payments.length).toBeGreaterThan(0);
  } finally {
    await studentApi.dispose();
  }
});

test('student invoice surface stays localized on the Vietnamese route', async ({
  page,
  playwright,
}) => {
  const studentApi = await playwright.request.newContext();

  try {
    const session = await getSharedSessionArtifacts(playwright, 'student');
    const invoicesResponse = await studentApi.get(apiUrl('/finance/my/invoices'), {
      headers: buildCookieHeaders(session),
    });
    await expectOkResponse(invoicesResponse, 'GET /finance/my/invoices');
    const invoices = (await invoicesResponse.json()) as Array<{
      invoiceNumber: string;
      balance: number;
    }>;

    await seedBrowserSession(page, playwright, 'student', { shared: true });
    await page.goto('/vi/dashboard/invoices');

    await expect(page).toHaveURL(/\/vi\/dashboard\/invoices$/);
    await expect(
      page.getByRole('heading', { name: /Hóa đơn/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: /Chọn học kỳ cho hóa đơn/ }),
    ).toBeVisible();
    await expect(page.getByText(/Số dư cần theo dõi/)).toBeVisible();

    const preferredInvoice = invoices.find((invoice) => invoice.balance > 0);
    const detailButton = preferredInvoice
      ? page.getByRole('button', {
          name: new RegExp(
            `Xem chi tiết hóa đơn ${escapeForRegExp(
              preferredInvoice.invoiceNumber,
            )}`,
            'i',
          ),
        })
      : page.getByRole('button', { name: /Xem chi tiết hóa đơn/i }).first();

    await expect(detailButton).toBeVisible();
    await detailButton.click();

    await expect(
      page.getByRole('heading', { name: /Chi tiết hóa đơn/ }),
    ).toBeVisible();
    await expect(page.getByText(/Phương thức thanh toán/)).toBeVisible();

    if (preferredInvoice) {
      await expect(page.getByText(/MoMo/)).toBeVisible();
      await expect(page.getByText(/ZaloPay/)).toBeVisible();
      await expect(page.getByText(/VNPay/)).toBeVisible();
      await expect(page.getByText(/PayPal/)).toBeVisible();
      await expect(page.getByText(/Visa|thẻ quốc tế/i)).toBeVisible();
    }
  } finally {
    await studentApi.dispose();
  }
});
