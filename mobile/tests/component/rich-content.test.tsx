import { afterEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { RichContent } from '../../src/components/content/rich-content';

const renderRich = (html: string) => render(
  <ThemeProvider forcedScheme="light"><RichContent html={html} /></ThemeProvider>,
);

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders every supported block and inline tag', async () => {
  await renderRich([
    '<h1>Tiêu đề một</h1>',
    '<h2>Tiêu đề hai</h2>',
    '<h3>Tiêu đề ba</h3>',
    '<h4>Tiêu đề bốn</h4>',
    '<p>Đoạn <strong>đậm</strong> <b>đậm hai</b> <em>nghiêng</em> <i>nghiêng hai</i>.</p>',
    '<ul><li>Mục không thứ tự</li></ul>',
    '<ol><li>Mục có thứ tự</li></ol>',
    '<blockquote>Trích dẫn</blockquote>',
    '<p><a href="https://example.test/story">Liên kết</a></p>',
    '<img src="https://example.test/photo.png" alt="Ảnh minh họa" />',
    '<table><tbody><tr><td>Ô A</td><td>Ô B</td></tr></tbody></table>',
  ].join(''));

  expect(screen.getByRole('header', { name: 'Tiêu đề một' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Tiêu đề hai' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Tiêu đề ba' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Tiêu đề bốn' })).toBeOnTheScreen();
  expect(screen.getByText(/Đoạn/)).toBeOnTheScreen();
  expect(StyleSheet.flatten(screen.getByText('đậm').props.style).fontFamily).toBe('BeVietnamPro_700Bold');
  expect(StyleSheet.flatten(screen.getByText('đậm hai').props.style).fontFamily).toBe('BeVietnamPro_700Bold');
  expect(StyleSheet.flatten(screen.getByText('nghiêng').props.style).fontStyle).toBe('italic');
  expect(StyleSheet.flatten(screen.getByText('nghiêng hai').props.style).fontStyle).toBe('italic');
  expect(screen.getByText('Mục không thứ tự')).toBeOnTheScreen();
  expect(screen.getByText('Mục có thứ tự')).toBeOnTheScreen();
  expect(screen.getByText('Trích dẫn')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Liên kết' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Ảnh minh họa')).toBeOnTheScreen();
  expect(screen.getByText('Ô A')).toBeOnTheScreen();
  expect(screen.getByText('Ô B')).toBeOnTheScreen();
});

test('opens a safe link through the platform handler', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await renderRich('<p><a href="https://example.test/story">Liên kết</a></p>');

  await fireEvent.press(screen.getByRole('link', { name: 'Liên kết' }));
  expect(open).toHaveBeenCalledWith('https://example.test/story');
});

test('opens an internal document link on its canonical web page', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await renderRich('<p><a href="/docs/quy-che-dao-tao">Quy chế</a></p>');

  await fireEvent.press(screen.getByRole('link', { name: 'Quy chế' }));
  expect(open).toHaveBeenCalledWith('https://www.campusute.io.vn/docs/quy-che-dao-tao');
});

test('drops scripts, styles, iframes, event handlers and javascript URLs', async () => {
  await renderRich([
    '<script>alert(1)</script>',
    '<style>p{color:red}</style>',
    '<iframe src="https://evil.test">iframe text</iframe>',
    '<p onclick="alert(2)">An toàn ',
    '<a href="javascript:alert(3)">bấm</a>',
    '<img src="javascript:alert(4)" onerror="alert(5)" alt="bad" />',
    '</p>',
  ].join(''));

  expect(screen.getByText(/An toàn/)).toBeOnTheScreen();
  expect(screen.getByText(/bấm/)).toBeOnTheScreen();
  expect(screen.queryByText(/alert\(/)).toBeNull();
  expect(screen.queryByText(/color:red/)).toBeNull();
  expect(screen.queryByText('iframe text')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByLabelText('bad')).toBeNull();
});

test('keeps text from malformed and unclosed markup', async () => {
  await renderRich('<p>Mở <strong>đậm <a href="/docs/quy-che">tài liệu</a>');

  expect(screen.getByText(/Mở/)).toBeOnTheScreen();
  expect(screen.getByText(/đậm/)).toBeOnTheScreen();
  expect(screen.getByText('tài liệu')).toBeOnTheScreen();
});
