/**
 * Proxy-side emulation of src/components/mip-icon.
 *
 * The mini-program component builds its data-URI SVG inside a JS observer, which
 * the WXML proxy never runs. This mirrors that data path (same intrinsic-size and
 * currentColor rules) so registry glyphs appear in pixel screenshots.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Loads the icon registry without TS tooling by stripping its type surface. */
export function loadIconRegistry(srcDir) {
  const ts = fs.readFileSync(path.join(srcDir, 'components/mip-icon/icons.ts'), 'utf8')
  const body = ts
    .replace(/export interface[\s\S]*?\n}\n/, '')
    .replace(/export const ICONS[^=]*=/, 'return')
  return new Function(body)()
}

export function mipIconHtml(registry, { name, size, color = '#ffffff' }) {
  const icon = registry[name]
  if (!icon) { return '' }
  const n = Number(size) || 0
  const width = n > 0 ? n : Number(icon.w) || Number(icon.h) || 16
  const height = n > 0 ? n : Number(icon.h) || Number(icon.w) || 16
  const body = icon.mono ? (icon.body ?? '').replace(/currentColor/g, color) : (icon.body ?? '')
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.vb}"`,
    `width="${width}" height="${height}" fill="${icon.mono ? color : 'none'}">`,
    body,
    '</svg>',
  ].join(' ')
  return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" style="display:block;width:${width}px;height:${height}px;object-fit:contain">`
}
