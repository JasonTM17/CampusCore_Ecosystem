import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { uiMessages } from '../../src/i18n/locale';
import { Badge, Button, ScreenShell, SectionHeading, StatePanel } from '../../src/components/Ui';
import {
  Dialog,
  FilterChip,
  FormField,
  InlineError,
  SectionCard,
  SegmentedControl,
  Skeleton,
  StatusPill,
  Toast,
} from '../../src/components/ui/index';

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const flat = (style: unknown) =>
  (StyleSheet.flatten(typeof style === 'function' ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false }) : style as never) ?? {}) as Record<string, any>;

describe('status pill', () => {
  test('renders the excused tone as a navy rectangle with medium meta text', async () => {
    await render(wrap(<StatusPill label="Có phép" tone="info" />));
    const label = screen.getByText('Có phép');
    expect(flat(label.props.style).color).toBe(tokens.colors.primary);
    const pill = flat(label.parent?.props.style);
    expect(pill.backgroundColor).toBe(tokens.colors.primaryFixed);
    expect(pill.borderRadius).toBe(6);
    expect(pill.minHeight).toBeGreaterThanOrEqual(Math.ceil(tokens.typography.meta.lineHeight * 1.3));
    expect(pill.paddingHorizontal).toBe(10);
    expect(pill.paddingVertical).toBe(2);
  });

  test('Badge shares the status pill geometry and supports the info tone', async () => {
    await render(wrap(<Badge label="Beta" tone="info" />));
    const label = screen.getByText('Beta');
    const pill = flat(label.parent?.props.style);
    expect(pill.borderRadius).toBe(6);
    expect(pill.paddingHorizontal).toBe(10);
    expect(pill.paddingVertical).toBe(2);
    expect(pill.minHeight).toBeGreaterThanOrEqual(Math.ceil(tokens.typography.meta.lineHeight * 1.3));
    expect(flat(label.props.style).color).toBe(tokens.colors.primary);
  });
});

describe('filter chips', () => {
  test('selected chip fills navy and flips its label to the on-primary ink', async () => {
    await render(wrap(<FilterChip label="Tất cả" selected onPress={() => {}} />));
    const chip = flat(screen.getByRole('button', { name: 'Tất cả' }).props.style);
    expect(chip.backgroundColor).toBe(tokens.colors.primary);
    expect(chip.borderColor).toBe(tokens.colors.primary);
    expect(flat(screen.getByText('Tất cả').props.style).color).toBe(tokens.colors.onPrimary);
  });

  test('unselected chip uses the low surface instead of a white card', async () => {
    await render(wrap(<FilterChip label="Học kỳ" selected={false} onPress={() => {}} />));
    const chip = flat(screen.getByRole('button', { name: 'Học kỳ' }).props.style);
    expect(chip.backgroundColor).toBe(tokens.colors.surfaceLow);
  });
});

describe('segmented control', () => {
  test('active segment fills navy with on-primary text', async () => {
    await render(wrap(
      <SegmentedControl
        options={[{ value: 'a', label: 'Kỳ 1' }, { value: 'b', label: 'Kỳ 2' }]}
        value="a"
        onChange={() => {}}
      />,
    ));
    const active = flat(screen.getByRole('tab', { name: 'Kỳ 1' }).props.style);
    expect(active.backgroundColor).toBe(tokens.colors.primary);
    expect(active.borderColor).toBe(tokens.colors.primary);
    expect(flat(screen.getByText('Kỳ 1').props.style).color).toBe(tokens.colors.onPrimary);
    expect(flat(screen.getByText('Kỳ 2').props.style).color).toBe(tokens.colors.textMuted);
  });
});

describe('page title', () => {
  test('renders as the navy 14px tab above the body', async () => {
    await render(wrap(<ScreenShell title="Bảng điều khiển"><></></ScreenShell>));
    const tab = flat(screen.getByTestId('page-title-tab').props.style);
    expect(tab.backgroundColor).toBe(tokens.colors.primary);
    const title = screen.getByRole('header', { name: 'Bảng điều khiển' });
    const style = flat(title.props.style);
    expect(style.fontSize).toBe(14);
    expect(style.color).toBe(tokens.colors.onPrimary);
  });
});

describe('section eyebrow', () => {
  test('section heading shows an uppercase primary chip above the title', async () => {
    await render(wrap(<SectionHeading eyebrow="Học kỳ 1" title="Môn học" />));
    const eyebrow = screen.getByText('HỌC KỲ 1');
    const style = flat(eyebrow.props.style);
    expect(style.color).toBe(tokens.colors.primary);
    expect(style.fontFamily).toBe('BeVietnamPro_700Bold');
    const chip = flat(eyebrow.parent?.props.style);
    expect(chip.backgroundColor).toBe(tokens.colors.primaryFixed);
    expect(chip.borderColor).toBe(tokens.colors.primary);
  });

  test('section card shows the eyebrow chip too', async () => {
    await render(wrap(
      <SectionCard eyebrow="Học kỳ 1" title="Điểm danh">
        <></>
      </SectionCard>,
    ));
    expect(screen.getByText('HỌC KỲ 1')).toBeOnTheScreen();
  });
});

describe('shared state panel', () => {
  test('empty state is a centred dashed block with the web title size and default copy', async () => {
    await render(wrap(<StatePanel kind="empty" />));
    const panel = flat(screen.getByTestId('state-panel').props.style);
    expect(panel.borderStyle).toBe('dashed');
    expect(panel.flexDirection).toBe('column');
    expect(panel.minHeight).toBe(220);
    expect(screen.getByText(uiMessages.vi.empty)).toBeOnTheScreen();
    expect(flat(screen.getByText(uiMessages.vi.empty).props.style).fontSize).toBe(18);
  });

  test('loading state renders three skeleton bars instead of a spinner', async () => {
    await render(wrap(<StatePanel kind="loading" />));
    expect(screen.getAllByTestId('state-skeleton', { includeHiddenElements: true })).toHaveLength(3);
    expect(screen.queryByText('Đang tải…')).toBeOnTheScreen();
  });
});

describe('inline error', () => {
  test('is a card with icon, default title, description and retry', async () => {
    const onRetry = jest.fn();
    await render(wrap(<InlineError message="Mất kết nối" onRetry={onRetry} />));
    const card = screen.getByTestId('inline-error');
    const style = flat(card.props.style);
    expect(style.borderLeftWidth).toBeUndefined();
    expect(style.flexDirection).toBe('column');
    expect(screen.getByTestId('inline-error-icon')).toBeOnTheScreen();
    expect(screen.getByText(uiMessages.vi.errorGeneric)).toBeOnTheScreen();
    expect(screen.getByText('Mất kết nối')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('skeleton', () => {
  test('uses the low surface fill so placeholders stay near the canvas', async () => {
    await render(wrap(<Skeleton testID="bar" />));
    expect(flat(screen.getByTestId('bar').props.style).backgroundColor).toBe(tokens.colors.surfaceLow);
  });
});

describe('dialog', () => {
  test('header close control dismisses with the web close label', async () => {
    const onCancel = jest.fn();
    await render(wrap(
      <Dialog visible title="Xóa?" confirmLabel="Xóa" cancelLabel="Hủy" onConfirm={() => {}} onCancel={onCancel} />,
    ));
    await fireEvent.press(screen.getByRole('button', { name: uiMessages.vi.closeDialog }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('toast', () => {
  test('tone colours the border, adds a status glyph and drops the extra close action', async () => {
    await render(wrap(<Toast visible message="Đã lưu" tone="success" onDismiss={() => {}} />));
    const toast = flat(screen.getByTestId('toast').props.style);
    expect(toast.borderColor).toBe(tokens.colors.success);
    expect(screen.getByTestId('toast-icon')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('button', () => {
  test('secondary action uses ink text and the web 14px label', async () => {
    await render(wrap(<Button label="Hủy" onPress={() => {}} variant="secondary" />));
    const label = flat(screen.getByText('Hủy').props.style);
    expect(label.color).toBe(tokens.colors.text);
    expect(label.fontSize).toBe(14);
  });
});

describe('form field', () => {
  test('defaults to a single-line input and keeps multiline opt-in', async () => {
    await render(wrap(<FormField label="Email" />));
    expect(screen.getByLabelText('Email').props.multiline).toBe(false);

    await render(wrap(<FormField label="Ghi chú" multiline />));
    expect(screen.getByLabelText('Ghi chú').props.multiline).toBe(true);
  });
});
