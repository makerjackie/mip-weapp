import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_COLOR_TOKENS, resolveIconColor } from '../src/components/mip-icon/colors'
import { ICONS } from '../src/components/mip-icon/icons'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walkWxml(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkWxml(full, out)
    }
    else if (entry.name.endsWith('.wxml')) {
      out.push(full)
    }
  }
  return out
}

function normalizeHex(hex: string): string {
  const value = hex.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/u.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return value
}

describe('MIP design token mirror for mip-icon', () => {
  it('mirrors every --color-* theme token from app.css without drift', () => {
    const appCss = read('src/app.css')
    const themeTokens: Record<string, string> = {}
    for (const match of appCss.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
      themeTokens[`--${match[1]}`] = normalizeHex(match[2])
    }
    expect(Object.keys(themeTokens).length).toBeGreaterThan(0)
    expect(Object.keys(ICON_COLOR_TOKENS).sort()).toEqual(Object.keys(themeTokens).sort())
    for (const [token, hex] of Object.entries(themeTokens)) {
      expect(ICON_COLOR_TOKENS[token], token).toBe(hex)
    }
  })

  it('resolves var() tokens, passes hex through and falls back to white', () => {
    expect(resolveIconColor('var(--color-brand)')).toBe('#fcdf03')
    expect(resolveIconColor('var( --color-muted )')).toBe('#b3b3b3')
    expect(resolveIconColor('#ff4d5e')).toBe('#ff4d5e')
    expect(resolveIconColor('')).toBe('#ffffff')
    expect(resolveIconColor('var(--color-not-a-token)')).toBe('#ffffff')
  })

  it('keeps icon color attributes token-only in every template', () => {
    for (const file of walkWxml(path.join(root, 'src'))) {
      const source = read(path.relative(root, file))
      for (const match of source.matchAll(/<(?:t-icon|mip-icon)\b[^>]*>/g)) {
        const color = /color="([^"]*)"/u.exec(match[0])?.[1] ?? ''
        expect(color.includes('#'), `${path.relative(root, file)}: ${match[0].slice(0, 100)}`).toBe(false)
      }
    }
  })

  it('ships exactly the registry subset referenced by templates — no dead glyphs, no missing glyphs', () => {
    const referenced = new Set<string>()
    for (const file of walkWxml(path.join(root, 'src'))) {
      const source = read(path.relative(root, file))
      for (const match of source.matchAll(/<mip-icon\b[^>]*>/g)) {
        const name = /name="([^"{}]+)"/u.exec(match[0])?.[1]
        if (name) {
          referenced.add(name)
        }
      }
    }
    const shipped = new Set(Object.keys(ICONS))
    expect([...referenced].filter(name => !shipped.has(name)).sort()).toEqual([])
    expect([...shipped].filter(name => !referenced.has(name)).sort()).toEqual([])
    // Package-size guard: the registry is a main-package asset (was 417KB at 444 glyphs).
    expect(fs.statSync(path.join(root, 'src/components/mip-icon/icons.ts')).size).toBeLessThan(24 * 1024)
  })
})
