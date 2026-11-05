import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

const mockPagedData: {
  news: unknown[];
  docs: unknown[];
} = {
  news: [],
  docs: [],
};

const mockQuery = {
  value: {
    data: undefined as unknown,
    error: null as string | null,
    warning: null as string | null,
    isLoading: false,
    errorStatus: null as number | null,
  },
};

jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: ({ key }: { key: string }) => {
    const isDocs = key.startsWith('content.docs');
    const items = isDocs ? mockPagedData.docs : mockPagedData.news;
    return {
      items,
      total: items.length,
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
    };
  },
}));

jest.mock('../../src/api/client', () => ({
  get apiClient() {
    return { mode: 'preview', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ ...mockQuery.value, reload: jest.fn(async () => {}), setData: jest.fn() }),
}));

jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedOut', role: 'student', capabilities: [] }),
}));

jest.mock('../../src/auth/oidc-session', () => ({
  signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })),
}));

jest.mock('../../src/auth/mobile-session-store', () => ({
  sessionStore: {
    issuer: 'http://issuer.test',
    sessionEpoch: jest.fn(() => 0),
    saveRefresh: jest.fn(async () => {}),
    setAccessToken: jest.fn(),
    bumpEpoch: jest.fn(),
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

jest.mock('../../src/screens/content/NewsDetail', () => ({
  NewsDetail: () => null,
}));

jest.mock('../../src/screens/content/DocDetail', () => ({
  DocDetail: () => null,
}));

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { DocsScreen } from '../../src/screens/student/DocsScreen';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import { summaryRowAccessibilityLabel } from '../../src/screens/student/summary-label';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const mobileProps = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

function setFontScale(fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 360,
    height: 800,
    scale: 2,
    fontScale,
  } as ReturnType<typeof Dimensions.get>);
}

const renderThemed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        {element}
      </LocaleProvider>
    </ThemeProvider>,
  );

describe('summary row accessibility labels and text clamping', () => {
  beforeEach(() => {
    setFontScale(1);
    mockPagedData.news = [];
    mockPagedData.docs = [];
    mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false, errorStatus: null };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('news row accessibility label includes full summary and summary text specifies tail ellipsis', async () => {
    const longSummary = 'Kế hoạch tổ chức thi đánh giá năng lực ngoại ngữ học kỳ 1 năm học 2026-2027 với đầy đủ lịch trình và phòng thi dành cho sinh viên.';
    mockPagedData.news = [
      {
        id: 'news-1',
        title: 'Thi đánh giá năng lực tiếng Anh',
        summary: longSummary,
        content: '',
        priority: 'NORMAL',
        categoryId: 'academic-affairs',
        publishAt: '2026-10-28T01:00:00Z',
      },
    ];

    await renderThemed(<NewsScreen {...mobileProps} />);

    const summaryNode = screen.getByText(longSummary);
    expect(summaryNode.props.numberOfLines).toBe(2);
    expect(summaryNode.props.ellipsizeMode).toBe('tail');

    const rowButton = screen.getAllByRole('button').find((btn) =>
      typeof btn.props.accessibilityLabel === 'string' &&
      btn.props.accessibilityLabel.includes('Thi đánh giá năng lực tiếng Anh'),
    );
    expect(rowButton).toBeDefined();
    expect(rowButton?.props.accessibilityLabel).toContain(longSummary);
    expect(rowButton?.props.accessibilityLabel).toContain('28/10/2026');
  });

  test('docs row accessibility label includes full summary and date, and summary text specifies tail ellipsis', async () => {
    const longSummary = 'Tài liệu hướng dẫn quy chế đào tạo đại học theo học chế tín chỉ ban hành kèm theo quyết định số 1234 của Hiệu trưởng.';
    mockPagedData.docs = [
      {
        slug: 'quy-che-dao-tao',
        title: 'Quy chế đào tạo tín chỉ',
        titleVi: 'Quy chế đào tạo tín chỉ',
        titleEn: 'Credit-based Training Regulations',
        summary: longSummary,
        summaryVi: longSummary,
        summaryEn: longSummary,
        publishedRevision: 3,
        publishedAt: '2026-10-20T01:00:00Z',
        categoryId: 'regulations',
      },
    ];

    await renderThemed(<DocsScreen {...mobileProps} />);

    const summaryNode = screen.getByText(longSummary);
    expect(summaryNode.props.numberOfLines).toBe(2);
    expect(summaryNode.props.ellipsizeMode).toBe('tail');

    const rowButton = screen.getAllByRole('button').find((btn) =>
      typeof btn.props.accessibilityLabel === 'string' &&
      btn.props.accessibilityLabel.includes('Quy chế đào tạo tín chỉ'),
    );
    expect(rowButton).toBeDefined();
    expect(rowButton?.props.accessibilityLabel).toContain(longSummary);
    expect(rowButton?.props.accessibilityLabel).toContain('20/10/2026');
  });

  test('guest featured news card accessibility label includes full summary and summary text specifies tail ellipsis', async () => {
    const longSummary = 'Chương trình phát triển tài năng công nghệ trẻ và vườn ươm khởi nghiệp đổi mới sáng tạo năm 2026 chính thức mở đơn tiếp nhận.';
    mockPagedData.news = [
      {
        id: 'guest-featured-1',
        title: 'Vườn ươm công nghệ trẻ',
        summary: longSummary,
        slug: 'vuon-uom-cong-nghe-tre',
        publishAt: '2026-10-25T01:00:00Z',
        categoryId: 'innovation',
        priority: 'HIGH',
        coverImageUrl: 'https://example.test/cover.png',
      },
    ];

    await renderThemed(<SignInScreen {...mobileProps} />);

    const summaryNode = screen.getByText(longSummary);
    expect(summaryNode.props.numberOfLines).toBe(2);
    expect(summaryNode.props.ellipsizeMode).toBe('tail');

    const featuredCard = screen.getByTestId('signin-news-featured');
    expect(featuredCard.props.accessibilityLabel).toContain(longSummary);
    expect(featuredCard.props.accessibilityLabel).toContain('25/10/2026');
  });

  test('large font scale increases clamped summary line budget while keeping tail ellipsis', async () => {
    setFontScale(2.0);
    const longSummary = 'Thông báo mở đợt đăng ký học phần bổ sung với nhiều khung giờ mới phù hợp cho sinh viên có nhu cầu hoàn thiện tiến độ học tập.';
    mockPagedData.news = [
      {
        id: 'news-large-text',
        title: 'Đăng ký học phần bổ sung',
        summary: longSummary,
        content: '',
        priority: 'NORMAL',
        categoryId: null,
        publishAt: null,
      },
    ];

    await renderThemed(<NewsScreen {...mobileProps} />);

    const summaryNode = screen.getByText(longSummary);
    expect(summaryNode.props.numberOfLines).toBe(4);
    expect(summaryNode.props.ellipsizeMode).toBe('tail');
  });

  test('summaryRowAccessibilityLabel composes available parts and excludes falsy values cleanly', () => {
    expect(
      summaryRowAccessibilityLabel({
        title: 'Tiêu đề bài viết',
        badge: 'Học vụ',
        date: '28/10/2026',
        summary: 'Toàn văn tóm tắt nội dung.',
      }),
    ).toBe('Tiêu đề bài viết · Học vụ · 28/10/2026 · Toàn văn tóm tắt nội dung.');

    expect(
      summaryRowAccessibilityLabel({
        title: 'Chỉ có tiêu đề và tóm tắt',
        date: null,
        summary: 'Tóm tắt ngắn gọn.',
      }),
    ).toBe('Chỉ có tiêu đề và tóm tắt · Tóm tắt ngắn gọn.');

    expect(
      summaryRowAccessibilityLabel('Tiêu đề positional', '28/10/2026', 'Tóm tắt positional', 'Khẩn'),
    ).toBe('Tiêu đề positional · Khẩn · 28/10/2026 · Tóm tắt positional');
  });
});
