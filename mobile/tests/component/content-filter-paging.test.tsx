import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { UiText } from '../../src/components/Ui';
import { ListFrame } from '../../src/screens/content/content-ui';
import type { PagedList } from '../../src/screens/content/use-paged-list';

interface Row { id: string }

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
  campusApi: {},
  createAssistantClientRequestId: () => 'test-request',
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { attempts: { keyFor: () => 'test-key', settle: () => {} } },
}));

const loadMore = jest.fn();
const list: PagedList<Row> = {
  items: [],
  total: 220,
  hasMore: true,
  loading: false,
  loadingMore: false,
  refreshing: false,
  error: null,
  warning: null,
  loadMoreError: null,
  errorStatus: null,
  loadMore,
  refresh: jest.fn(),
  reload: async () => {},
  patch: jest.fn(),
  preview: false,
};

describe('filtered content paging', () => {
  test('an empty filtered page still offers a way to fetch later pages', async () => {
    loadMore.mockClear();
    await render(
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">
          <ListFrame
            title="Thông báo"
            list={list}
            items={[]}
            filtered
            keyOf={(row) => row.id}
            renderItem={(row) => <UiText>{row.id}</UiText>}
            emptyTitle="Không có thông báo phù hợp"
          />
        </LocaleProvider>
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Tải thêm' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
