/**
 * Categorical palettes.
 *
 * Both palettes are ordered so that adjacent entries stay distinguishable, and
 * every entry clears 3:1 contrast against its own theme's row backgrounds —
 * bars carry a label, so they are treated as graphical objects with text on top
 * rather than as large text.
 */

/** Categorical colours tuned for light backgrounds. */
export const lightPalette: readonly string[] = [
  '#3b6fe0',
  '#0e9f6e',
  '#d97706',
  '#c2410c',
  '#9333ea',
  '#0891b2',
  '#be185d',
  '#4d7c0f',
  '#6366f1',
  '#a16207',
];

/** The same hues re-tuned for dark backgrounds: lighter, slightly desaturated. */
export const darkPalette: readonly string[] = [
  '#7aa2f7',
  '#4ade80',
  '#fbbf24',
  '#fb923c',
  '#c084fc',
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#a5b4fc',
  '#d4b106',
];
