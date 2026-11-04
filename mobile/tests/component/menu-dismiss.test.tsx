import { afterEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { MenuPanel } from '../../src/components/MenuPanel';

afterEach(() => { jest.restoreAllMocks(); });

const panel = (activeRoute: 'dashboard.student' | 'grades', onClose: () => void) => (
  <ThemeProvider forcedScheme="light">
    <MenuPanel
      activeRoute={activeRoute}
      role="student"
      onClose={onClose}
      onNavigate={() => {}}
      onSwitchRole={() => {}}
      allowRoleSwitch={false}
    />
  </ThemeProvider>
);

test('hardware back closes the open menu and consumes the press', async () => {
  const onClose = jest.fn();
  const addListener = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }) as ReturnType<typeof BackHandler.addEventListener>);

  await render(panel('dashboard.student', onClose));

  expect(addListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
  const handler = addListener.mock.calls[0][1] as () => boolean | null | undefined;
  expect(handler()).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Đóng' })).toBeOnTheScreen();
});

test('a route change closes the menu that was left open', async () => {
  const onClose = jest.fn();
  const view = await render(panel('dashboard.student', onClose));
  await view.rerender(panel('grades', onClose));
  expect(onClose).toHaveBeenCalledTimes(1);
});
