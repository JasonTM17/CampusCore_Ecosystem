import { expect, test } from '@playwright/test';
import {
  adminRoutes,
  apiUrl,
  buildCookieHeaders,
  expectOkResponse,
  frontendBaseURL,
  getSharedSessionArtifacts,
  lecturerRoutes,
  seedBrowserSession,
  studentRoutes,
  visitRoute,
  visitRoutes,
} from './helpers';

test('student can traverse people and academic routes without losing jwt-backed session claims', async ({
  page,
  playwright,
}) => {
  const loginData = await seedBrowserSession(page, playwright, 'student', {
    shared: true,
  });
  expect(loginData.user.studentId).toBeTruthy();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();

  await visitRoutes(page, studentRoutes);
});

test('people-service read-through keeps student enrollment history reachable through the public path', async ({
  playwright,
}) => {
  const api = await playwright.request.newContext();

  try {
    const studentSession = await getSharedSessionArtifacts(playwright, 'student');
    const adminSession = await getSharedSessionArtifacts(playwright, 'admin');
    const studentData = studentSession.authData;
    const adminData = adminSession.authData;

    expect(studentData.user.studentId).toBeTruthy();
    expect(adminData.user.roles).toContain('ADMIN');

    const enrollmentHistoryResponse = await api.get(
      apiUrl(`/students/${studentData.user.studentId}/enrollments`),
      {
        headers: buildCookieHeaders(adminSession, {
          Authorization: `Bearer ${adminData.accessToken}`,
        }),
      },
    );

    await expectOkResponse(
      enrollmentHistoryResponse,
      'GET /students/:id/enrollments',
    );
    const enrollmentHistory = await enrollmentHistoryResponse.json();
    expect(Array.isArray(enrollmentHistory)).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('lecturer can traverse teaching flows without losing lecturer claims', async ({
  page,
  playwright,
}) => {
  const loginData = await seedBrowserSession(page, playwright, 'lecturer', {
    shared: true,
  });
  expect(loginData.user.lecturerId).toBeTruthy();

  await page.goto('/dashboard/lecturer');
  await expect(page).toHaveURL(/\/dashboard\/lecturer$/);
  await expect(
    page.getByRole('heading', { name: /Lecturer Portal/i }),
  ).toBeVisible();

  await visitRoutes(page, lecturerRoutes);

  await test.step(
    'visit /dashboard/lecturer/grades and open a section detail route',
    async () => {
      await visitRoute(page, {
        path: '/dashboard/lecturer/grades',
        heading: 'Grade Management',
        ready: async (currentPage) => {
          const manageButtons = currentPage.getByRole('button', {
            name: /Manage Grades|Enter Grades/i,
          });

          if ((await manageButtons.count()) === 0) {
            await expect(
              currentPage.getByRole('heading', { name: 'No Sections Found' }),
            ).toBeVisible();
            return;
          }

          await expect(manageButtons.first()).toBeVisible();
          await manageButtons.first().click();
          await expect(currentPage).toHaveURL(
            /\/dashboard\/lecturer\/grades\/[^/]+$/,
          );
          await expect(
            currentPage.getByRole('button', { name: 'Save Grades' }),
          ).toBeVisible();
          await expect(
            currentPage.getByRole('button', { name: 'Publish Grades' }),
          ).toBeVisible();
          await expect(
            currentPage
              .getByRole('link', { name: /Back to grade management/i })
              .first(),
          ).toBeVisible();
        },
      });
    },
  );
});

test('admin can still reach roster-style people and academic management routes', async ({
  page,
  playwright,
}) => {
  test.setTimeout(75_000);

  await seedBrowserSession(page, playwright, 'admin', { shared: true });

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole('heading', { name: 'Admin Dashboard' }),
  ).toBeVisible();

  const rosterRoutes = adminRoutes.filter((route) =>
    [
      '/admin/users',
      '/admin/lecturers',
      '/admin/courses',
      '/admin/sections',
      '/admin/enrollments',
      '/admin/classrooms',
      '/admin/semesters',
      '/admin/academic-years',
      '/admin/departments',
    ].includes(route.path),
  );

  for (const route of rosterRoutes) {
    await visitRoute(page, route);
  }
});
