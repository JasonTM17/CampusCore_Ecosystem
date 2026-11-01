export const chromeFontScaleCap = 1.3;
export const compactFontScaleCap = 1.6;

export function effectiveFontSizeMultiplier(requested: number | null | undefined, cap: number): number {
  return Math.min(requested ?? cap, cap);
}
