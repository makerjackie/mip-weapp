/**
 * Semantic color tokens mirrored from the `@theme` block of src/app.css.
 *
 * mip-icon renders its glyph as a data-URI SVG inside `<image>`, which is a
 * separate document: page CSS variables never resolve inside it. Templates
 * still pass `var(--color-*)` tokens (assertSemanticIconColors forbids hex
 * literals in WXML), and the component resolves them to hex right here.
 *
 * Keep in sync with src/app.css — tests/mip-design-tokens.test.ts pins the
 * mirror, so a token change fails the suite until both files move together.
 */
export const ICON_COLOR_TOKENS: Record<string, string> = {
  '--color-canvas': '#080808',
  '--color-panel': '#202020',
  '--color-panel-raised': '#242424',
  '--color-panel-muted': '#242424',
  '--color-ink': '#ffffff',
  '--color-muted': '#b3b3b3',
  '--color-line': '#333333',
  '--color-brand': '#fcdf03',
  '--color-on-brand': '#080808',
  '--color-brand-active': '#d0b801',
  '--color-brand-soft': '#4d4400',
  '--color-tag-player': '#fde530',
  '--color-brand-alt': '#fde104',
  '--color-tag-type': '#80ccff',
  '--color-tag-type-line': '#4b90bf',
  '--color-ios-gray': '#8e8e93',
  '--color-coral': '#fcdf03',
  '--color-accent': '#fcdf03',
  '--color-gold': '#fcdf03',
  '--color-danger': '#ff4d5e',
  '--color-success': '#18e779',
  '--color-membership-brand': '#fcdf03',
  '--color-membership-muted': '#b3b3b3',
  '--color-membership-panel': '#202020',
}

/** Accepts a hex color or a `var(--color-*)` token; unknown tokens fall back to white. */
export function resolveIconColor(color: string): string {
  const value = String(color ?? '').trim()
  const token = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/u.exec(value)
  if (token) {
    return ICON_COLOR_TOKENS[token[1]] ?? '#ffffff'
  }
  return value || '#ffffff'
}
