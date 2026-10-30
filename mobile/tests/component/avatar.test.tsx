import { describe, expect, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { Avatar, IdentityHeader } from '../../src/components/ui/avatar';
import { auditTree } from '../a11y/audit';

function wrap(ui: ReactElement, scheme: 'light' | 'dark' = 'light', locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme={scheme}>
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

type JsonNode = { type: string; props?: Record<string, any>; children?: (JsonNode | string)[] | null };
function findImages(node: JsonNode | string | null, out: JsonNode[] = []): JsonNode[] {
  if (!node || typeof node === 'string') return out;
  if (node.type === 'Image') out.push(node);
  node.children?.forEach((child) => findImages(child, out));
  return out;
}
const renderedImages = () => findImages(screen.toJSON() as JsonNode);

describe('Avatar', () => {
  test('renders initials with a localized image label', async () => {
    await render(wrap(<Avatar name="Nguyễn Đức Minh" />));
    expect(screen.getByText('MN')).toBeOnTheScreen();
    expect(screen.getByRole('image', { name: 'Ảnh của Nguyễn Đức Minh' })).toBeOnTheScreen();
  });

  test('adds the role to the spoken label and follows the English locale', async () => {
    await render(wrap(<Avatar name="Trần Hoàng Nam" role="student" roleLabel="Sinh viên" />));
    expect(screen.getByRole('image', { name: 'Ảnh của Trần Hoàng Nam, Sinh viên' })).toBeOnTheScreen();

    await render(wrap(<Avatar name="Trần Hoàng Nam" roleLabel="Student" />, 'light', 'en'));
    expect(screen.getByRole('image', { name: 'Photo of Trần Hoàng Nam, Student' })).toBeOnTheScreen();
  });

  test('renders the portrait over the initials when a URL exists', async () => {
    await render(wrap(<Avatar name="Phạm Anh Thư" imageUrl="https://example.edu/thu.png" />));
    const [photo] = renderedImages();
    expect(photo.props?.source).toEqual({ uri: 'https://example.edu/thu.png' });
    expect(photo.props?.resizeMode).toBe('cover');
    // The initials stay mounted underneath: loading needs no layout shift.
    expect(screen.getByText('TP')).toBeOnTheScreen();
  });

  test('falls back to initials on image error and never retries the URL', async () => {
    await render(wrap(<Avatar name="Lê Khánh Vy" imageUrl="https://example.edu/missing.png" />));
    const [photo] = renderedImages();
    expect(photo).toBeTruthy();
    await act(async () => {
      photo.props?.onError?.({ nativeEvent: { error: '404' } });
    });
    expect(renderedImages()).toHaveLength(0);
    expect(screen.getByText('VL')).toBeOnTheScreen();
  });

  test('renders initials alone when there is no URL', async () => {
    await render(wrap(<Avatar name="Đỗ Quang Huy" />));
    expect(renderedImages()).toHaveLength(0);
    expect(screen.getByText('HĐ')).toBeOnTheScreen();
  });

  test('honours named and numeric sizes without layout jump', async () => {
    await render(wrap(<Avatar name="Minh" size="sm" testID="a" />));
    expect(flat(screen.getByTestId('a').props.style)).toMatchObject({ width: 32, height: 32 });
    await render(wrap(<Avatar name="Minh" size={48} testID="b" />));
    expect(flat(screen.getByTestId('b').props.style)).toMatchObject({ width: 48, height: 48 });
  });

  test('switches initials ink and tone between light and dark', async () => {
    await render(wrap(<Avatar name="Nguyễn Đức Minh" />, 'light'));
    expect(flat(screen.getByText('MN').props.style).color).toBe(tokens.colors.onPrimary);

    await render(wrap(<Avatar name="Nguyễn Đức Minh" />, 'dark'));
    expect(flat(screen.getByText('MN').props.style).color).toBe(tokens.colorsDark.onPrimary);
  });

  test('is hidden from assistive tech when decorative', async () => {
    await render(wrap(<Avatar decorative name="Nguyễn Đức Minh" />));
    expect(screen.getByText('MN', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('image')).toBeNull();
  });

  test('status dot and role badge render without a11y violations', async () => {
    await render(wrap(<Avatar name="Nguyễn Văn A" role="lecturer" status="active" ring size="lg" />));
    expect(screen.getByRole('image', { name: 'Ảnh của Nguyễn Văn A' })).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});

describe('IdentityHeader', () => {
  test('shows portrait slot, name, id and chips like the web card', async () => {
    await render(
      wrap(
        <IdentityHeader
          chips={['Sinh viên', 'K22']}
          name="Nguyễn Đức Minh"
          role="student"
          roleLabel="Sinh viên"
          subtitle="2022SE0417"
        />,
      ),
    );
    expect(screen.getByText('Nguyễn Đức Minh')).toBeOnTheScreen();
    expect(screen.getByText('2022SE0417')).toBeOnTheScreen();
    expect(screen.getByText('Sinh viên')).toBeOnTheScreen();
    expect(screen.getByText('K22')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('renders on the navy chrome surface', async () => {
    await render(
      wrap(<IdentityHeader chips={['Sinh viên']} name="Phạm Anh Thư" onBrand subtitle="2023BA0192" />, 'dark'),
    );
    expect(screen.getByText('Phạm Anh Thư')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});
