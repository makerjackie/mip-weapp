#!/usr/bin/env node
/**
 * Layer-1 geometry alignment: snap off-scale rpx font sizes and radii to the
 * MIP design scales (DESIGN.md §3/§4.1, rpx = design px x 2).
 *
 * Line heights are deliberately left alone — a taller leading than the glyph box
 * is not a token violation, but shrinking one would clip text.
 *
 *   node scripts/ui-fidelity/apply-geometry-mapping.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { repoRoot } from './lib/palette.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const EXTS = new Set(['.css', '.wxss', '.wxml'])
const SKIP_DIRS = new Set(['assets', 'node_modules', 'dist', '.tmp'])

// Off-scale rpx -> registered rpx.
// 22rpx (11px) and 30rpx (15px) are registered sizes — they must not be snapped.
const FONT = {
  17: 20, 19: 20, 21: 20,
  23: 24, 25: 24, 26: 24,
  27: 28, 29: 28,
  31: 32, 33: 32,
  35: 34, 36: 34, 37: 34,
  38: 40, 39: 40, 41: 40, 42: 40,
  44: 48, 46: 48, 47: 48, 50: 48, 52: 48,
}
const RADIUS = {
  6: 8, 10: 8, 12: 8, 14: 16, 18: 16, 20: 16, 22: 24, 26: 24, 28: 32, 36: 32, 40: 32,
}

/** [prefix, value, suffix] capture groups so the replacement can be rebuilt exactly. */
const PATTERNS = [
  { kind: 'font', re: /(\bfont-size:\s*)(\d+)(rpx)/g },
  { kind: 'font', re: /(\btext-\[(?:length:)?)(\d+)(rpx\])/g },
  { kind: 'font', re: /(--[a-z0-9-]*(?:font|text|size)[a-z0-9-]*:\s*)(\d+)(rpx)/g },
  { kind: 'radius', re: /(\bborder-radius:\s*)(\d+)(rpx)/g },
  { kind: 'radius', re: /(\brounded(?:-[a-z]{1,2})*-\[)(\d+)(rpx\])/g },
  { kind: 'radius', re: /(--[a-z0-9-]*radius[a-z0-9-]*:\s*)(\d+)(rpx)/g },
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (entry.isDirectory() && SKIP_DIRS.has(entry.name))) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const dryRun = process.argv.includes('--dry-run')
const counts = new Map()
let filesChanged = 0

for (const file of walk(SRC)) {
  const before = fs.readFileSync(file, 'utf8')
  let text = before
  for (const { kind, re } of PATTERNS) {
    const table = kind === 'font' ? FONT : RADIUS
    text = text.replace(re, (matched, prefix, value, suffix) => {
      const next = table[Number.parseInt(value, 10)]
      if (!next) return matched
      const key = `${kind} ${value}->${next}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return `${prefix}${next}${suffix}`
    })
  }
  if (text !== before) {
    filesChanged += 1
    if (!dryRun) fs.writeFileSync(file, text)
  }
}

console.log(`${dryRun ? 'would rewrite' : 'rewrote'} ${filesChanged} files`)
for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${key}  x${count}`)
