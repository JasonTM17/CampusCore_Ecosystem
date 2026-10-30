'use client';

import * as React from 'react';
import { useI18n } from '@/i18n';
import { LocalizedLink } from '@/components/LocalizedLink';

export default function NotFound() {
  const { locale, messages } = useI18n();
  const isVi = locale === 'vi';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a href="#main-content" className="portal-skip-link">
        {messages.home.skipToContent}
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-4 text-center"
      >
        <div className="mx-auto max-w-md space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            404 Not Found
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {isVi ? 'Trang không tồn tại' : 'Page Not Found'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isVi
              ? 'Đường dẫn bạn yêu cầu không tồn tại hoặc đã được chuyển sang vị trí mới.'
              : 'The page you requested does not exist or has been moved.'}
          </p>
          <nav
            className="pt-2"
            aria-label={isVi ? 'Liên kết khôi phục' : 'Recovery links'}
          >
            <LocalizedLink
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isVi ? 'Quay lại trang chủ' : 'Back to Home'}
            </LocalizedLink>
          </nav>
        </div>
      </main>
    </div>
  );
}
