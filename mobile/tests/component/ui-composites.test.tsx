import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import {
  ChartSummary,
  ChoiceField,
  DataList,
  DateField,
  FileRow,
  FilterSheet,
  barRatios,
  toggleFilterValue,
} from '../../src/components/ui/index';
import { auditTree } from '../a11y/audit';

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const rows = [
  { id: 'a', title: 'Lớp A' },
  { id: 'b', title: 'Lớp B' },
];
const renderRow = (row: { id: string; title: string }) => <Text>{row.title}</Text>;

describe('DataList', () => {
  test('renders rows by stable key and loads more on demand', async () => {
    const onLoadMore = jest.fn();
    await render(wrap(<DataList data={rows} keyExtractor={(r) => r.id} renderItem={renderRow} hasMore onLoadMore={onLoadMore} />));
    expect(screen.getByText('Lớp A')).toBeOnTheScreen();
    expect(screen.getByText('Lớp B')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Tải thêm' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('shows a busy footer instead of the load-more button while paging', async () => {
    await render(wrap(<DataList data={rows} keyExtractor={(r) => r.id} renderItem={renderRow} hasMore loadingMore onLoadMore={() => {}} />));
    expect(screen.getByText('Đang tải thêm…')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull();
  });

  test('empty, loading and error states are distinct and error can retry', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(wrap(<DataList data={[]} keyExtractor={(r: { id: string }) => r.id} renderItem={() => null} loading />));
    expect(screen.getByLabelText('Đang tải…')).toBeOnTheScreen();

    await rerender(wrap(<DataList data={[]} keyExtractor={(r: { id: string }) => r.id} renderItem={() => null} />));
    expect(screen.getByText('Chưa có dữ liệu')).toBeOnTheScreen();

    await rerender(wrap(<DataList data={[]} keyExtractor={(r: { id: string }) => r.id} renderItem={() => null} error="Mất kết nối" onRetry={onRetry} />));
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('follows the English locale', async () => {
    await render(wrap(<DataList data={rows} keyExtractor={(r) => r.id} renderItem={renderRow} hasMore onLoadMore={() => {}} />, 'en'));
    expect(screen.getByRole('button', { name: 'Load more' })).toBeOnTheScreen();
  });
});

describe('FilterSheet', () => {
  const groups = [
    { id: 'status', label: 'Trạng thái', options: [{ value: 'open', label: 'Đang mở' }, { value: 'closed', label: 'Đã đóng' }] },
    { id: 'tags', label: 'Nhãn', multiple: true, options: [{ value: 'x', label: 'Nhãn X' }, { value: 'y', label: 'Nhãn Y' }] },
  ];

  test('toggle logic is single-select for radios and additive for checkboxes', () => {
    const single = toggleFilterValue({ status: ['open'] }, groups[0], 'closed');
    expect(single.status).toEqual(['closed']);
    expect(toggleFilterValue(single, groups[0], 'closed').status).toEqual([]);
    const multi = toggleFilterValue(toggleFilterValue({}, groups[1], 'x'), groups[1], 'y');
    expect(multi.tags).toEqual(['x', 'y']);
  });

  test('applies the draft only when confirmed', async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    await render(wrap(<FilterSheet visible onClose={onClose} groups={groups} value={{}} onApply={onApply} />));
    const option = screen.getByRole('radio', { name: 'Đã đóng' });
    expect(option.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(option);
    expect(screen.getByRole('radio', { name: 'Đã đóng' }).props.accessibilityState.checked).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onApply).toHaveBeenCalledWith({ status: ['closed'] });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ChoiceField', () => {
  const options = [
    { value: 'a', label: 'Khoa A' },
    { value: 'b', label: 'Khoa B' },
    { value: 'c', label: 'Khoa C' },
    { value: 'd', label: 'Khoa D' },
  ];

  test('opens a sheet for many options and reports the chosen value', async () => {
    const onChange = jest.fn();
    await render(wrap(<ChoiceField label="Khoa" options={options} value="b" onChange={onChange} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Khoa: Khoa B' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Khoa D' }));
    expect(onChange).toHaveBeenCalledWith('d');
  });

  test('uses segments for a short option list', async () => {
    const onChange = jest.fn();
    await render(wrap(<ChoiceField label="Loại" options={options.slice(0, 2)} value="a" onChange={onChange} />));
    await fireEvent.press(screen.getByRole('tab', { name: 'Khoa B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('DateField', () => {
  test('rejects impossible and out-of-range dates, then commits a valid one', async () => {
    const onChange = jest.fn();
    await render(wrap(<DateField label="Hạn nộp" value="" onChange={onChange} min="2026-01-01" />));
    await fireEvent.press(screen.getByRole('button', { name: /Hạn nộp/ }));
    const input = screen.getByLabelText('Chọn ngày');
    await fireEvent.changeText(input, '31/02/2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.getByText('Ngày không hợp lệ')).toBeOnTheScreen();
    await fireEvent.changeText(input, '15/12/2025');
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.getByText('Ngày phải từ 01/01/2026 trở đi')).toBeOnTheScreen();
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '15/03/2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onChange).toHaveBeenCalledWith('2026-03-15');
  });

  test('required field refuses an empty entry', async () => {
    const onChange = jest.fn();
    await render(wrap(<DateField label="Ngày" value="" onChange={onChange} required />));
    await fireEvent.press(screen.getByRole('button', { name: /Ngày/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.getByText('Vui lòng nhập ngày')).toBeOnTheScreen();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FileRow', () => {
  test('shows size and status and keeps actions labelled by file', async () => {
    const onOpen = jest.fn();
    await render(wrap(<FileRow name="de-cuong.pdf" sizeBytes={1536} actions={[{ key: 'open', label: 'Mở', onPress: onOpen }]} />));
    expect(screen.getByText('1,5 KB')).toBeOnTheScreen();
    expect(screen.getByText('Sẵn sàng')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở: de-cuong.pdf' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('disables actions while busy and exposes progress', async () => {
    const onOpen = jest.fn();
    await render(wrap(<FileRow name="b.pdf" status="busy" progress={0.4} actions={[{ key: 'open', label: 'Mở', onPress: onOpen }]} />));
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(40);
    await fireEvent.press(screen.getByRole('button', { name: 'Mở: b.pdf' }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('ChartSummary', () => {
  test('bar ratios scale to the largest value and ignore negatives', () => {
    expect(barRatios([5, 10, -3, Number.NaN])).toEqual([0.5, 1, 0, 0]);
    expect(barRatios([0, 0])).toEqual([0, 0]);
  });

  test('exposes a text alternative for bars and sparkline', async () => {
    const series = [{ label: 'T1', value: 7.5 }, { label: 'T2', value: 9 }];
    const { rerender } = await render(wrap(<ChartSummary title="Điểm" series={series} unit="điểm" />));
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Điểm: T1 7,5 điểm, T2 9 điểm');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);

    await rerender(wrap(<ChartSummary title="Điểm" series={series} kind="sparkline" />));
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Điểm: T1 - T2; thấp nhất 7,5, cao nhất 9, mới nhất 9');

    await rerender(wrap(<ChartSummary title="Điểm" series={[]} />));
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Điểm: Chưa có số liệu');
  });
});
