import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import type { ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { StatStrip } from '../../src/components/ui/institutional';
import { Dialog, Sheet } from '../../src/components/ui/primitives';
import { DateField } from '../../src/components/ui/date-field';
import { FilterSheet } from '../../src/components/ui/filter-sheet';
import { ListRow, StatePanel } from '../../src/components/Ui';

afterEach(() => {
  jest.restoreAllMocks();
});

function setWindow(width: number, height = 800, fontScale = 1.0) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale });
}

function wrap(ui: ReactElement, insets = { top: 0, bottom: 0, left: 0, right: 0 }) {
  return (
    <SafeAreaInsetsContext.Provider value={insets}>
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
      </ThemeProvider>
    </SafeAreaInsetsContext.Provider>
  );
}

describe('shared responsive components layout contracts', () => {
  test('StatStrip stacks into a column at 360dp width when holding 4 items', async () => {
    setWindow(360, 800, 1.0);
    const items = [
      { icon: 'account-group-outline' as const, label: 'Tổng nhóm', value: '12' },
      { icon: 'clock-outline' as const, label: 'Chờ duyệt', value: '3' },
      { icon: 'check-circle-outline' as const, label: 'Đã duyệt', value: '8' },
      { icon: 'close-circle-outline' as const, label: 'Từ chối', value: '1' },
    ];
    await render(wrap(<StatStrip items={items} />));
    const firstTile = screen.getByLabelText('Tổng nhóm: 12');
    const strip = firstTile.parent;
    expect(strip).not.toBeNull();
    const style = StyleSheet.flatten(strip?.props.style);
    expect(style.flexDirection).toBe('column');
  });

  test('Sheet modal applies bottom safe area insets to avoid system gesture bar collision', async () => {
    setWindow(393, 852, 1.0);
    const insets = { top: 48, bottom: 34, left: 0, right: 0 };
    await render(
      wrap(
        <Sheet visible onClose={() => {}} title="Tùy chọn">
          <View testID="sheet-body" />
        </Sheet>,
        insets,
      ),
    );
    const panel = screen.getByLabelText('Tùy chọn');
    const style = StyleSheet.flatten(panel.props.style);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(insets.bottom + tokens.spacing.md);
  });

  test('Dialog in landscape on short heights constrains panel height and scrolls content', async () => {
    setWindow(640, 360, 1.0);
    await render(
      wrap(
        <Dialog
          visible
          title="Xác nhận hủy đề tài"
          description="Hành động này sẽ xóa toàn bộ nội dung đăng ký đề tài của nhóm bạn và không thể khôi phục."
          confirmLabel="Xác nhận"
          cancelLabel="Đóng"
          onConfirm={() => {}}
        />,
      ),
    );
    const dialogHeader = screen.getByRole('header', { name: 'Xác nhận hủy đề tài' });
    let panelNode = dialogHeader.parent;
    while (panelNode && panelNode.props.accessibilityRole !== 'alert') {
      panelNode = panelNode.parent;
    }
    expect(panelNode).not.toBeNull();
    const panelStyle = StyleSheet.flatten(panelNode?.props.style);
    expect(panelStyle.maxHeight).toBeDefined();
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeOnTheScreen();
  });

  test('action button rows in DateField and FilterSheet wrap on narrow widths', async () => {
    setWindow(360, 800, 1.3);
    await render(
      wrap(
        <>
          <DateField label="Ngày sinh" value="2004-05-12" onChange={() => {}} />
          <FilterSheet
            visible
            onClose={() => {}}
            title="Lọc"
            groups={[{ id: 'status', label: 'Trạng thái', options: [{ value: 'active', label: 'Đang học' }] }]}
            value={{}}
            onApply={() => {}}
          />
        </>,
      ),
    );
    const applyButton = screen.getByRole('button', { name: 'Áp dụng' });
    const actionContainer = applyButton.parent;
    expect(actionContainer).not.toBeNull();
    const actionStyle = StyleSheet.flatten(actionContainer?.props.style);
    expect(actionStyle.flexWrap).toBe('wrap');
  });

  test('StatePanel stacks vertically at large font scale with minWidth 0 on copy', async () => {
    setWindow(360, 800, 1.5);
    await render(
      wrap(
        <StatePanel
          kind="error"
          title="Không thể tải lịch học"
          description="Vui lòng kiểm tra kết nối mạng."
          actionLabel="Thử lại"
          onAction={() => {}}
        />,
      ),
    );
    const retryButton = screen.getByRole('button', { name: 'Thử lại' });
    let statePanelNode = retryButton.parent;
    while (statePanelNode && statePanelNode.props.accessibilityRole !== 'alert') {
      statePanelNode = statePanelNode.parent;
    }
    expect(statePanelNode).not.toBeNull();
    const panelStyle = StyleSheet.flatten(statePanelNode?.props.style);
    expect(panelStyle.flexDirection).toBe('column');
    expect(panelStyle.alignItems).toBe('stretch');

    const copyNode = screen.getByText('Không thể tải lịch học').parent;
    expect(copyNode).not.toBeNull();
    const copyStyle = StyleSheet.flatten(copyNode?.props.style);
    expect(copyStyle.minWidth).toBe(0);
  });

  test('ListRow preserves title flex alongside unread badge', async () => {
    setWindow(360, 800, 1.0);
    await render(wrap(<ListRow title="Cấu trúc dữ liệu và giải thuật" unread />));
    const unreadTitle = screen.getByText('Cấu trúc dữ liệu và giải thuật');
    const titleStyle = StyleSheet.flatten(unreadTitle.props.style);
    expect(titleStyle.flex).toBe(1);
    expect(titleStyle.minWidth).toBe(0);
  });
});
