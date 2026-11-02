import type { MetadataRoute } from 'next';
import { defaultLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export default function manifest(): MetadataRoute.Manifest {
  const copy = getMessages(defaultLocale).meta.manifest;
  const englishScreenshotLabel = getMessages('en').meta.manifest.screenshots.homeEnLabel;
  const vietnameseScreenshotLabel = getMessages('vi').meta.manifest.screenshots.homeViLabel;

  return {
    name: copy.name,
    short_name: copy.shortName,
    description: copy.description,
    id: '/vi',
    start_url: '/vi',
    display: 'standalone',
    background_color: '#002D62',
    theme_color: '#003F87',
    categories: ['education', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/home-en.svg',
        sizes: '1440x1024',
        type: 'image/svg+xml',
        form_factor: 'wide',
        label: englishScreenshotLabel,
      },
      {
        src: '/screenshots/home-vi.svg',
        sizes: '1440x1024',
        type: 'image/svg+xml',
        form_factor: 'wide',
        label: vietnameseScreenshotLabel,
      },
    ],
  };
}
