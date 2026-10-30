'use client';

import React from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  FileEdit,
  FileText,
  Minus,
  Moon,
  Plus,
  Printer,
  Share2,
  Sun,
  Type,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFontFamily = 'sans' | 'serif';
export type ReaderFontSize = 'sm' | 'base' | 'lg' | 'xl';
export type ReaderMode = 'EDITORIAL' | 'OFFICIAL';

export interface ReadingPreferences {
  mode: ReaderMode;
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: ReaderFontSize;
}

interface ReadingToolbarProps {
  preferences: ReadingPreferences;
  onPreferencesChange: (updater: (prev: ReadingPreferences) => ReadingPreferences) => void;
  onPrint: () => void;
  onShare: () => void;
  /** Three states on purpose: a rejected clipboard write must not read as "Copied". */
  copyState: 'idle' | 'copied' | 'failed';
  onClose: () => void;
  onEdit?: () => void;
  locale?: Locale;
}

const fontSizes: ReaderFontSize[] = ['sm', 'base', 'lg', 'xl'];

export function ReadingToolbar({
  preferences,
  onPreferencesChange,
  onPrint,
  onShare,
  copyState,
  onClose,
  onEdit,
  locale = 'vi',
}: ReadingToolbarProps) {
  const isVi = locale === 'vi';

  const currentFontIndex = fontSizes.indexOf(preferences.fontSize);

  const handleDecreaseFont = () => {
    if (currentFontIndex > 0) {
      onPreferencesChange((prev) => ({
        ...prev,
        fontSize: fontSizes[currentFontIndex - 1],
      }));
    }
  };

  const handleIncreaseFont = () => {
    if (currentFontIndex < fontSizes.length - 1) {
      onPreferencesChange((prev) => ({
        ...prev,
        fontSize: fontSizes[currentFontIndex + 1],
      }));
    }
  };

  const toggleFontFamily = () => {
    onPreferencesChange((prev) => ({
      ...prev,
      fontFamily: prev.fontFamily === 'sans' ? 'serif' : 'sans',
    }));
  };

  const setTheme = (theme: ReaderTheme) => {
    onPreferencesChange((prev) => ({ ...prev, theme }));
  };

  const toggleMode = (mode: ReaderMode) => {
    onPreferencesChange((prev) => ({ ...prev, mode }));
  };

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/95 backdrop-blur-md px-4 py-2.5 shadow-xs print:hidden">
      {/* Left Group: Mode Switcher */}
      <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/40 p-1">
        <button
          type="button"
          onClick={() => toggleMode('EDITORIAL')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-11 sm:min-h-8',
            preferences.mode === 'EDITORIAL'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/80',
          )}
          title={isVi ? 'Giao diện Báo chí Học thuật' : 'Academic Magazine View'}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{isVi ? 'Dạng Bản tin' : 'Magazine'}</span>
        </button>

        <button
          type="button"
          onClick={() => toggleMode('OFFICIAL')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-11 sm:min-h-8',
            preferences.mode === 'OFFICIAL'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/80',
          )}
          title={isVi ? 'Giao diện Công văn Hành chính e-Office' : 'Official Institutional Dispatch'}
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{isVi ? 'Công văn' : 'Dispatch'}</span>
        </button>
      </div>

      {/* Middle Group: Reader Comfort Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Font Size Adjusters */}
        <div className="flex items-center rounded-lg border border-border/70 bg-secondary/30 p-0.5">
          <button
            type="button"
            onClick={handleDecreaseFont}
            disabled={currentFontIndex === 0}
            className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40 sm:h-7 sm:w-7"
            title={isVi ? 'Giảm cỡ chữ (A-)' : 'Decrease font size'}
            aria-label={isVi ? 'Giảm cỡ chữ' : 'Decrease font size'}
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="px-1.5 text-xs font-semibold uppercase text-foreground">
            A
          </span>
          <button
            type="button"
            onClick={handleIncreaseFont}
            disabled={currentFontIndex === fontSizes.length - 1}
            className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40 sm:h-7 sm:w-7"
            title={isVi ? 'Tăng cỡ chữ (A+)' : 'Increase font size'}
            aria-label={isVi ? 'Tăng cỡ chữ' : 'Increase font size'}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        {/* Font Family Switcher */}
        <button
          type="button"
          onClick={toggleFontFamily}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium transition-colors hover:bg-secondary/60 sm:h-8',
            preferences.fontFamily === 'serif' ? 'font-serif bg-secondary/40' : 'font-sans',
          )}
          title={
            preferences.fontFamily === 'serif'
              ? isVi
                ? 'Đang dùng phông có chân (Serif). Bấm để đổi sang Sans.'
                : 'Serif font. Click for Sans.'
              : isVi
                ? 'Đang dùng phông không chân (Sans). Bấm để đổi sang Serif.'
                : 'Sans font. Click for Serif.'
          }
        >
          <Type className="h-3.5 w-3.5" />
          <span>{preferences.fontFamily === 'serif' ? 'Serif' : 'Sans'}</span>
        </button>

        {/* Theme Palette Switcher */}
        <div className="flex items-center rounded-lg border border-border/70 bg-secondary/30 p-0.5">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors sm:h-7 sm:w-7',
              preferences.theme === 'light'
                ? 'reader-theme-light shadow-xs ring-1 ring-[var(--reader-border)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={isVi ? 'Nền sáng tiêu chuẩn' : 'Light background'}
            aria-label={isVi ? 'Nền sáng tiêu chuẩn' : 'Light background'}
          >
            <Sun className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setTheme('sepia')}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-sm font-serif font-bold text-xs transition-colors sm:h-7 sm:w-7',
              preferences.theme === 'sepia'
                ? 'reader-theme-sepia shadow-xs ring-1 ring-[var(--reader-border)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={isVi ? 'Nền Sepia dịu mắt ban đêm' : 'Warm eye-care Sepia mode'}
            aria-label={isVi ? 'Nền Sepia dịu mắt ban đêm' : 'Warm eye-care Sepia mode'}
          >
            S
          </button>

          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors sm:h-7 sm:w-7',
              preferences.theme === 'dark'
                ? 'reader-theme-dark shadow-xs ring-1 ring-[var(--reader-border)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={isVi ? 'Nền tối chống chói' : 'Dark mode'}
            aria-label={isVi ? 'Nền tối chống chói' : 'Dark mode'}
          >
            <Moon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Right Group: Action Controls */}
      <div className="flex items-center gap-1.5">
        {onEdit && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onEdit}
            className="h-11 gap-1.5 rounded-lg text-xs font-semibold shadow-xs sm:h-8"
            title={isVi ? 'Chỉnh sửa bài viết' : 'Edit announcement'}
          >
            <FileEdit className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{isVi ? 'Chỉnh sửa' : 'Edit'}</span>
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrint}
          className="h-11 gap-1.5 rounded-lg text-xs sm:h-8"
          title={isVi ? 'In tài liệu (chuẩn khổ A4)' : 'Print document'}
        >
          <Printer className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{isVi ? 'In' : 'Print'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onShare}
          className="h-11 gap-1.5 rounded-lg text-xs sm:h-8"
          title={isVi ? 'Sao chép liên kết bài viết' : 'Copy notice link'}
        >
          {copyState === 'copied' ? (
            <>
              <Check className="h-3.5 w-3.5 text-status-success" />
              <span className="text-status-success-foreground font-semibold">{isVi ? 'Đã chép!' : 'Copied!'}</span>
            </>
          ) : copyState === 'failed' ? (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-status-warning" />
              <span className="text-status-warning-foreground font-semibold" role="status">
                {isVi ? 'Không chép được liên kết' : 'Could not copy the link'}
              </span>
            </>
          ) : (
            <>
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{isVi ? 'Chia sẻ' : 'Share'}</span>
            </>
          )}
        </Button>

        {/* Sticky Close Button with 44x44 target */}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 focus:outline-none focus:ring-2 focus:ring-destructive/40"
          title={isVi ? 'Đóng cửa sổ đọc (Esc)' : 'Close reader (Esc)'}
          aria-label={isVi ? 'Đóng cửa sổ đọc' : 'Close reader'}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
