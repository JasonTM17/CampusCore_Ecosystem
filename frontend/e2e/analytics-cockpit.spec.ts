import { expect, test } from '@playwright/test';
import { seedBrowserSession } from './helpers';

test('Vietnamese admin analytics keeps the operator queue readable on desktop', async ({
  page,
  playwright,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await seedBrowserSession(page, playwright, 'admin', { shared: true });

  await page.goto('/vi/admin/analytics');

  await expect(
    page.getByRole('heading', { name: /Báo cáo và phân tích/i }),
  ).toBeVisible();
  await expect(page.getByTestId('admin-analytics-action-queue')).toBeVisible();

  const actionQueueBox = await page
    .getByTestId('admin-analytics-action-queue')
    .boundingBox();

  expect(actionQueueBox?.width ?? 0).toBeGreaterThan(520);
  await expect(page.getByText(/Hàng đợi cần chú ý/i)).toBeVisible();
});
