'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { locale } = useI18n();
  const nextThemeLabel =
    theme === 'light'
      ? locale === 'vi'
        ? 'Chuyển sang giao diện tối'
        : 'Switch to dark theme'
      : locale === 'vi'
        ? 'Chuyển sang giao diện sáng'
        : 'Switch to light theme';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={nextThemeLabel}
      title={nextThemeLabel}
    >
      {theme === 'light' ? (
        <Moon className="h-5 w-5 text-foreground" />
      ) : (
        <Sun className="h-5 w-5 text-[hsl(var(--accent-warm))]" />
      )}
    </Button>
  );
}
