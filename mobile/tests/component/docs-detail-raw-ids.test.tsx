import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { DocDetail } from '../../src/screens/content/DocDetail';
import { docCategoryLabel } from '../../src/screens/content/docs-model';

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' } }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: {} }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => ({ data: undefined, isLoading: false, error: null, reload: async () => {} }),
}));
jest.mock('../../src/screens/content/preview-data', () => ({
  previewDocs: () => [
    {
      slug: 'unreviewed-document',
      categoryId: 'category-demo',
      publishedRevision: 1,
      titleVi: 'Tài liệu chưa có nhãn',
      titleEn: 'Document without a reviewed label',
      bodyVi: 'Nội dung',
      bodyEn: 'Content',
      tagIds: ['raw-tag-demo'],
    },
    {
      slug: 'reviewed-document',
      categoryId: 'regulations',
      publishedRevision: 1,
      titleVi: 'Quy chế đào tạo',
      titleEn: 'Training regulations',
      bodyVi: 'Nội dung',
      bodyEn: 'Content',
      tagIds: ['raw-tag-demo'],
    },
  ],
}));

const renderDoc = (slug: string) => render(
  <LocaleProvider initialLocale="vi">
    <ThemeProvider forcedScheme="light">
      <DocDetail slug={slug} onBack={() => {}} />
    </ThemeProvider>
  </LocaleProvider>,
);

describe('public document labels', () => {
  test('does not return an unknown category id as its label', () => {
    expect(docCategoryLabel('category-demo', { regulations: 'Quy chế' })).not.toBe('category-demo');
  });

  test('omits an unknown category id from the document hero', async () => {
    await renderDoc('unreviewed-document');
    expect(screen.queryByText(/category-demo/)).toBeNull();
  });

  test('omits raw tag ids from the document hero', async () => {
    await renderDoc('reviewed-document');
    expect(screen.queryByText(/raw-tag-demo/)).toBeNull();
  });

  test('keeps a category label that is already reviewed', async () => {
    await renderDoc('reviewed-document');
    expect(screen.getByText(/Danh mục: Quy chế/)).toBeOnTheScreen();
  });
});
