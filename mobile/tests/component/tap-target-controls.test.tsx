import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

jest.mock('../../src/api/client', () => ({
  get apiClient() {
    return { mode: 'preview' };
  },
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { minTapTarget } from '../../src/design/tokens';
import { ActionTile } from '../../src/components/Ui';
import { AppBar } from '../../src/components/AppBar';
import { MenuPanel } from '../../src/components/MenuPanel';
import { NavigationRail } from '../../src/components/NavigationRail';
import { PreviewPill } from '../../src/components/PreviewPill';
import {
  ChoiceField,
  DateField,
  FilterChip,
  FilterSheet,
  IconButton,
  SearchBar,
  SegmentedControl,
  SheetHeader,
  Button,
} from '../../src/components/ui/index';
import { SegmentTabs } from '../../src/screens/academic/academic-ui';
import { ContentIconAction } from '../../src/screens/content/content-ui';

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

function flattenStyle(style: any): any {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved) ?? {};
}

describe('shared controls keep the 48dp tap target', () => {
  test('short text buttons keep a 48dp minimum width', async () => {
    await render(wrap(<Button label="A" variant="text" onPress={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'A' }).props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('IconButton meets the target', async () => {
    await render(wrap(<IconButton icon="close" accessibilityLabel="Đóng" onPress={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'Đóng' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  });

  test('SheetHeader close button meets the target', async () => {
    await render(wrap(<SheetHeader title="Tiêu đề" closeLabel="Đóng lại" onClose={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'Đóng lại' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  });

  test('FilterChip meets the target', async () => {
    await render(wrap(<FilterChip label="A" selected={false} onPress={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'A' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('academic term tabs meet the 48dp minimum on both axes', async () => {
    await render(wrap(
      <SegmentTabs label="Chọn học kỳ" value="a" options={[{ value: 'a', label: 'Kỳ A' }, { value: 'b', label: 'Kỳ B' }]} onChange={() => {}} />,
    ));
    const style = flattenStyle(screen.getByRole('tab', { name: 'Kỳ A' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('compact content icon actions meet the 48dp minimum on both axes', async () => {
    await render(wrap(<ContentIconAction icon="close" accessibilityLabel="Xóa tệp" onPress={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'Xóa tệp' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('DateField trigger meets the target', async () => {
    await render(wrap(<DateField label="Hạn nộp" value="" onChange={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: /Hạn nộp/ }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  test('ChoiceField trigger and sheet options meet the target', async () => {
    const options = [
      { value: 'a', label: 'Khoa A' },
      { value: 'b', label: 'Khoa B' },
      { value: 'c', label: 'Khoa C' },
      { value: 'd', label: 'Khoa D' },
    ];
    await render(wrap(<ChoiceField label="Khoa" options={options} value="b" onChange={() => {}} />));
    const trigger = screen.getByRole('button', { name: 'Khoa: Khoa B' });
    expect(flattenStyle(trigger.props.style).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent.press(trigger);
    for (const option of screen.getAllByRole('radio')) {
      expect(flattenStyle(option.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  test('SearchBar clear button meets the target', async () => {
    await render(wrap(<SearchBar value="abc" onChangeText={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'Xóa tìm kiếm' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  });

  test('SegmentedControl options meet the target', async () => {
    await render(wrap(
      <SegmentedControl
        accessibilityLabel="Chọn kỳ"
        options={[{ value: 'a', label: 'Kỳ 1' }, { value: 'b', label: 'Kỳ 2' }]}
        value="a"
        onChange={() => {}}
      />,
    ));
    for (const tab of screen.getAllByRole('tab')) {
      expect(flattenStyle(tab.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  test('FilterSheet options meet the target', async () => {
    const groups = [
      { id: 'status', label: 'Trạng thái', options: [{ value: 'open', label: 'Đang mở' }, { value: 'closed', label: 'Đã đóng' }] },
      { id: 'tags', label: 'Nhãn', multiple: true, options: [{ value: 'x', label: 'Nhãn X' }] },
    ];
    await render(wrap(<FilterSheet visible onClose={() => {}} groups={groups} value={{}} onApply={() => {}} />));
    for (const option of [...screen.getAllByRole('radio'), ...screen.getAllByRole('checkbox')]) {
      expect(flattenStyle(option.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  test('ActionTile meets the target', async () => {
    await render(wrap(<ActionTile label="Thao tác" icon="calendar" onPress={() => {}} />));
    const style = flattenStyle(screen.getByRole('button', { name: 'Thao tác' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  });

  test('NavigationRail items meet the target', async () => {
    await render(wrap(
      <NavigationRail activeRoute="dashboard.student" role="student" onNavigate={() => {}} onMenu={() => {}} />,
    ));
    for (const tab of screen.getAllByRole('tab')) {
      const style = flattenStyle(tab.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.minWidth).toBeGreaterThanOrEqual(48);
    }
    const menu = flattenStyle(screen.getByRole('button', { name: shellMessages.vi.openMenu }).props.style);
    expect(menu.minHeight).toBeGreaterThanOrEqual(48);
    expect(menu.minWidth).toBeGreaterThanOrEqual(48);
  });

  test('MenuPanel role buttons meet the target', async () => {
    await render(wrap(
      <MenuPanel
        activeRoute="dashboard.student"
        role="student"
        onClose={() => {}}
        onNavigate={() => {}}
        onSwitchRole={() => {}}
        allowRoleSwitch
      />,
    ));
    const roleRow = screen.getByTestId('menu-panel-role-row');
    for (const button of within(roleRow).getAllByRole('button')) {
      expect(flattenStyle(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  test('AppBar icon and sign-in controls meet the target', async () => {
    await render(wrap(<AppBar role="student" onProfile={() => {}} onSignOut={() => {}} onSignIn={() => {}} />));
    for (const name of [shellMessages.vi.screens.profile, shellMessages.vi.signOut]) {
      const style = flattenStyle(screen.getByRole('button', { name }).props.style);
      expect(style.height).toBeGreaterThanOrEqual(48);
      expect(style.width).toBeGreaterThanOrEqual(48);
    }
    const signIn = flattenStyle(screen.getByRole('button', { name: shellMessages.vi.guestSignIn }).props.style);
    expect(signIn.minHeight).toBeGreaterThanOrEqual(48);
  });

  test('PreviewPill meets the target', async () => {
    await render(wrap(<PreviewPill />));
    const style = flattenStyle(screen.getByTestId('preview-pill').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });
});
