import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Share } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));

import type { MobilePublicAnnouncement } from '../../src/api/client';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { recordsMessages } from '../../src/i18n/records-messages';
import { DispatchReaderSheet } from '../../src/screens/content/DispatchReaderSheet';

const mockNotice: MobilePublicAnnouncement = {
  id: 'notice-48',
  title: 'Thông báo xét cấp học bổng khuyến khích học tập HK1',
  content: '<p>Nội dung công văn chi tiết về việc xét học bổng.</p>',
  priority: 'HIGH',
  publishAt: '2026-10-28T08:00:00Z',
  publishedBy: 'Phòng Đào tạo',
  semesterName: 'HK1 2026-2027',
};

const renderThemed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{element}</LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dispatch reader reading toolbar & progress bar', () => {
  test.each([
    {
      locale: 'vi' as const,
      progressLabel: recordsMessages.vi.announcementsReadingProgress,
      shareLabel: recordsMessages.vi.announcementsShare,
    },
    {
      locale: 'en' as const,
      progressLabel: recordsMessages.en.announcementsReadingProgress,
      shareLabel: recordsMessages.en.announcementsShare,
    },
  ])(
    'renders reading progress bar and share button with web copy in $locale',
    async ({ locale, progressLabel, shareLabel }) => {
      await renderThemed(
        <DispatchReaderSheet item={mockNotice} visible={true} onClose={jest.fn()} />,
        locale,
      );

      const progressBar = screen.getByTestId('reading-progress-bar');
      expect(progressBar).toBeOnTheScreen();
      expect(screen.getByLabelText(progressLabel)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: shareLabel })).toBeOnTheScreen();
    },
  );

  test('scroll event updates reading progress percentage', async () => {
    await renderThemed(
      <DispatchReaderSheet item={mockNotice} visible={true} onClose={jest.fn()} />,
      'vi',
    );

    const scroll = screen.getByTestId('dispatch-reader-scroll');
    const progressBar = screen.getByTestId('reading-progress-bar');

    // Initially progress is 0
    expect(progressBar.props.accessibilityValue.now).toBe(0);

    // Scroll halfway through content: total scroll = 1200 - 400 = 800; offset = 400 => 50%
    await fireEvent.scroll(scroll, {
      nativeEvent: {
        contentOffset: { y: 400 },
        contentSize: { height: 1200 },
        layoutMeasurement: { height: 400 },
      },
    });

    expect(progressBar.props.accessibilityValue.now).toBe(50);

    // Scroll to bottom => 100%
    await fireEvent.scroll(scroll, {
      nativeEvent: {
        contentOffset: { y: 800 },
        contentSize: { height: 1200 },
        layoutMeasurement: { height: 400 },
      },
    });

    expect(progressBar.props.accessibilityValue.now).toBe(100);
  });

  test('tapping share action triggers React Native Share API with title and web URL', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' });

    await renderThemed(
      <DispatchReaderSheet item={mockNotice} visible={true} onClose={jest.fn()} />,
      'vi',
    );

    const shareButton = screen.getByRole('button', {
      name: recordsMessages.vi.announcementsShare,
    });
    await fireEvent.press(shareButton);

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: mockNotice.title,
        url: 'https://www.campusute.io.vn/dashboard/announcements?id=notice-48',
        message: expect.stringContaining(
          'https://www.campusute.io.vn/dashboard/announcements?id=notice-48',
        ),
      }),
    );
  });

  test('keeps layout safe with long titles and font scale layout constraints', async () => {
    const longTitle =
      'Thông báo rất dài về việc xét cấp học bổng khuyến khích học tập và hỗ trợ chi phí học tập cho sinh viên chính quy các khóa năm học 2026-2027';

    await renderThemed(
      <DispatchReaderSheet
        item={{
          ...mockNotice,
          title: longTitle,
        }}
        visible={true}
        onClose={jest.fn()}
      />,
      'vi',
    );

    expect(screen.getByTestId('reading-progress-bar')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: recordsMessages.vi.announcementsShare }),
    ).toBeOnTheScreen();
    expect(screen.getByText(longTitle)).toBeOnTheScreen();
  });
});
