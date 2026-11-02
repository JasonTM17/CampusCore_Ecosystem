const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDashboardShell,
  elements,
  loadMessages,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const LECTURER = {
  id: 'lecturer-1',
  email: 'lecturer@campuscore.edu',
  firstName: 'Linh',
  lastName: 'Le',
  roles: ['LECTURER'],
};
const STUDENT = {
  id: 'student-1',
  email: 'student@campuscore.edu',
  firstName: 'An',
  lastName: 'Nguyen',
  roles: ['STUDENT'],
};
const ADMIN = {
  id: 'admin-1',
  email: 'admin@campuscore.edu',
  firstName: 'Quan',
  lastName: 'Tran',
  roles: ['ADMIN'],
};
const DEAN = {
  id: 'dean-1',
  email: 'dean@campuscore.edu',
  firstName: 'Hoa',
  lastName: 'Pham',
  // Faculty heads always carry LECTURER alongside TRUONG_KHOA.
  roles: ['LECTURER', 'TRUONG_KHOA'],
};

function bellPanelHrefs(tree, messages) {
  const anchors = elements(tree).filter((element) => typeof element.props?.href === 'string');
  const noticeBoard = anchors.find((element) =>
    textOf(element).includes(messages.dashboardShell.notifications.academicAffairsNoticeBoard));
  return noticeBoard?.props.href;
}

function openBell(tree) {
  const trigger = elements(tree).find(
    (element) => element.props?.['aria-controls'] === 'dashboard-notifications-panel',
  );
  assert.ok(trigger, 'the bell trigger is rendered');
  trigger.props.onClick();
}

async function mountShell({ user, pathname }) {
  const shell = createDashboardShell({ user, pathname });
  const tree = await shell.pump();
  return { shell, tree };
}

test('an admin opening the shared self-service profile page is not bounced to the admin console', async () => {
  for (const pathname of ['/dashboard/profile', '/dashboard/editor', '/dashboard/sign-out', '/dashboard/thesis/topics']) {
    const { shell } = await mountShell({ user: ADMIN, pathname });
    assert.deepEqual(shell.replaced, [], `${pathname} must stay inside the dashboard shell`);
  }

  const superAdmin = { ...ADMIN, id: 'super-1', roles: ['SUPER_ADMIN'] };
  const { shell: superShell } = await mountShell({
    user: superAdmin,
    pathname: '/dashboard/profile',
  });
  assert.deepEqual(superShell.replaced, [], 'SUPER_ADMIN keeps the same profile access');

  // Every other dashboard route still belongs to the admin console.
  for (const pathname of ['/dashboard', '/dashboard/announcements', '/dashboard/grades', '/dashboard/notifications']) {
    const { shell } = await mountShell({ user: ADMIN, pathname });
    assert.deepEqual(shell.replaced, ['/admin'], `${pathname} keeps the admin redirect`);
  }
});

test('the bell notice-board footer resolves to a board each role can open', async () => {
  const { noticeBoardHrefFor } = loadTs('src/lib/notification-targets.ts', {});
  assert.equal(noticeBoardHrefFor(STUDENT.roles), '/dashboard/announcements');
  assert.equal(noticeBoardHrefFor(LECTURER.roles), '/dashboard/lecturer/announcements');
  assert.equal(noticeBoardHrefFor(DEAN.roles), '/dashboard/lecturer/announcements');
  assert.equal(noticeBoardHrefFor(ADMIN.roles), '/admin/announcements');
  assert.equal(noticeBoardHrefFor(['SUPER_ADMIN']), '/admin/announcements');
  assert.equal(noticeBoardHrefFor(['TRUONG_BO_MON']), '/dashboard/notifications');
  assert.equal(noticeBoardHrefFor(undefined), '/dashboard/notifications');

  for (const [user, pathname, expected] of [
    [STUDENT, '/dashboard', '/dashboard/announcements'],
    [LECTURER, '/dashboard/lecturer', '/dashboard/lecturer/announcements'],
    [ADMIN, '/dashboard/editor', '/admin/announcements'],
  ]) {
    const shell = createDashboardShell({ user, pathname });
    const initial = await shell.pump();
    openBell(initial);
    const opened = await shell.pump(1);
    assert.equal(
      bellPanelHrefs(opened, shell.messages),
      expected,
      `${user.roles.join(',')} footer must point at ${expected}`,
    );
  }
});

test('signed-in shells expose the staff desks as a real navigation entry', async () => {
  const vi = loadMessages('vi');
  const en = loadMessages('en');
  assert.equal(vi.dashboardShell.menu.staffDesks, 'Bàn làm việc cán bộ');
  assert.equal(en.dashboardShell.menu.staffDesks, 'Staff desks');

  for (const [user, pathname] of [
    [STUDENT, '/dashboard'],
    [LECTURER, '/dashboard/lecturer'],
    [DEAN, '/dashboard/dean'],
    [ADMIN, '/dashboard/editor'],
  ]) {
    const { tree, shell } = await mountShell({ user, pathname });
    const staffLink = elements(tree).find(
      (element) => element.props?.href === '/staff',
    );
    assert.ok(staffLink, `${user.roles.join(',')} must see the /staff entry`);
    assert.equal(
      staffLink.props['aria-label'],
      shell.messages.dashboardShell.menu.staffDesks,
      'the entry takes its accessible name from the shared nav label',
    );
  }
});
