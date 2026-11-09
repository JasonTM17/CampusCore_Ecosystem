import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { within } from '@testing-library/react-native';

const mockAdvisorDirectory = {
  loading: false,
  error: null,
  capped: false,
  failed: 0,
  entries: [{ lecturerId: 'lecturer-1', name: 'Giảng viên', email: null, topics: [{ id: 'topic-1', title: 'A thesis topic with important details that must remain available at large text sizes.' }] }],
};

jest.mock('../../src/screens/thesis/use-thesis', () => ({ useAdvisorDirectory: () => mockAdvisorDirectory }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' }, campusApi: {} }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { docs: jest.fn(), news: jest.fn() } }));
jest.mock('../../src/screens/content/DocDetail', () => ({ DocDetail: () => null }));
jest.mock('../../src/screens/content/NewsDetail', () => ({ NewsDetail: () => null }));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: ({ key }: { key: string }) => ({
    items: key.startsWith('content.docs')
      ? [{ slug: 'scale-doc', title: 'Document title', titleVi: 'Tiêu đề tài liệu', titleEn: 'Document title', summary: 'Long document summary that is secondary to its title.', summaryVi: 'Tóm tắt tài liệu dài, chỉ là nội dung phụ so với tiêu đề.', summaryEn: 'Long document summary that is secondary to its title.', publishedRevision: 1, publishedAt: null, categoryId: null }]
      : [{ id: 'scale-news', title: 'News title', summary: 'Long news summary that is secondary to its title.', content: '', priority: 'NORMAL', categoryId: null, publishAt: null }],
    total: 1,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    warning: null,
    loadMoreError: null,
    errorStatus: null,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(async () => {}),
    patch: jest.fn(),
    preview: true,
  }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

import { Button, InlineError, ListRow, Notice } from '../../src/components/Ui';
import { MenuPanel } from '../../src/components/MenuPanel';
import { StatusPill } from '../../src/components/ui/institutional';
import { UiText } from '../../src/components/ui/UiText';
import { compactFontScaleCap } from '../../src/design/font-scale';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { thesisMessages } from '../../src/i18n/thesis-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { civilKey, weekDates } from '../../src/screens/academic/academic-model';
import { WeekStrip } from '../../src/screens/academic/WeekStrip';
import { DocsScreen } from '../../src/screens/student/DocsScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { ThesisAdvisorsView } from '../../src/screens/thesis/ThesisAdvisorsView';

function setFontScale(fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const mobileProps = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

afterEach(() => { jest.restoreAllMocks(); });

describe('text scaling at 2.0', () => {
  test('UiText caps the multiplier at the token and honors a lower override', async () => {
    setFontScale(2);
    await render(wrap(
      <>
        <UiText>default</UiText>
        <UiText maxFontSizeMultiplier={1.3}>chrome</UiText>
        <UiText maxFontSizeMultiplier={3}>above cap</UiText>
      </>,
    ));
    expect(tokens.typography.maxFontScale).toBe(2);
    expect(screen.getByText('default').props.maxFontSizeMultiplier).toBe(2);
    expect(screen.getByText('chrome').props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByText('above cap').props.maxFontSizeMultiplier).toBe(2);
  });

  test('thesis advisor topic bullets keep their full primary content at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<ThesisAdvisorsView roundId="round-1" copy={thesisMessages.vi} />));
    expect(screen.getByText(/A thesis topic with important details/).props.numberOfLines).toBeUndefined();
  });

  test('document titles stay untruncated and summaries get more lines at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<DocsScreen {...mobileProps} />));
    expect(screen.getByText('Tiêu đề tài liệu').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('Tóm tắt tài liệu dài, chỉ là nội dung phụ so với tiêu đề.').props.numberOfLines).toBe(4);
  });

  test('news titles stay untruncated and summaries get more lines at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<NewsScreen {...mobileProps} />));
    expect(screen.getByText('News title').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('Long news summary that is secondary to its title.').props.numberOfLines).toBe(4);
  });

  test('Notice stacks its action and keeps the target at least 44dp at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<Notice message="A long notice" actionLabel="Thử lại" onAction={() => {}} />));
    expect(StyleSheet.flatten(screen.getByTestId('notice').props.style).flexDirection).toBe('column');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Thử lại' }).props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
  });

  test('InlineError stacks its action and keeps the target at least 44dp at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<InlineError message="A long error" retryLabel="Thử lại" onRetry={() => {}} />));
    expect(StyleSheet.flatten(screen.getByTestId('inline-error').props.style).flexDirection).toBe('column');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Thử lại' }).props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
  });

  test('the role row stacks at 2.0 and its buttons keep the 44dp target', async () => {
    setFontScale(2);
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
    expect(StyleSheet.flatten(roleRow.props.style).flexDirection).toBe('column');
    for (const button of within(roleRow).getAllByRole('button')) {
      expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
    }
  });

  test('ListRow keeps the primary title untruncated and stacks meta at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<ListRow title="Giải tích" subtitle="MA101" meta="07:00 – 09:00" />));
    expect(screen.getByText('Giải tích').props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('list-row-copy')).toContainElement(screen.getByText('07:00 – 09:00'));
  });

  test('ListRow keeps meta in its own column below the 1.3 threshold', async () => {
    setFontScale(1);
    await render(wrap(<ListRow title="Giải tích" subtitle="MA101" meta="07:00 – 09:00" />));
    expect(screen.getByTestId('list-row-copy')).not.toContainElement(screen.getByText('07:00 – 09:00'));
  });

  test('Button grows from minHeight instead of a fixed height', async () => {
    setFontScale(2);
    await render(wrap(<Button label="Đăng ký học phần" onPress={() => {}} />));
    const style = StyleSheet.flatten(screen.getByRole('button').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
    expect(style.height).toBeUndefined();
  });

  test('StatusPill keeps compact chrome above the metadata and never a fixed height', async () => {
    setFontScale(2);
    await render(wrap(<StatusPill label="Đã hoàn thành" tone="success" />));
    const label = screen.getByText('Đã hoàn thành');
    expect(label.props.maxFontSizeMultiplier).toBe(compactFontScaleCap);
    const pill = label.parent;
    expect(pill).not.toBeNull();
    const style = StyleSheet.flatten(pill?.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(Math.ceil(tokens.typography.meta.lineHeight * 1.3));
    expect(style.height).toBeUndefined();
  });

  test('the week strip wraps and keeps 44dp day cells at 2.0', async () => {
    setFontScale(2);
    const days = weekDates(new Date(2026, 10, 2));
    await render(wrap(
      <WeekStrip
        days={days}
        selectedIndex={2}
        todayKey={civilKey(days[0])}
        labels={['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']}
        onSelect={() => {}}
      />,
    ));
    expect(StyleSheet.flatten(screen.getByTestId('week-strip').props.style).flexWrap).toBe('wrap');
    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(7);
    for (const cell of cells) {
      const style = StyleSheet.flatten(cell.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
      expect(style.height).toBeUndefined();
    }
    expect(screen.getByText('T2').props.numberOfLines).toBeUndefined();
  });
});
