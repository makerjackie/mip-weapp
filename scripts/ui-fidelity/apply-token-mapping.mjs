#!/usr/bin/env node
/**
 * One-shot Layer-1 alignment: rewrite off-token color literals to their MIP token
 * equivalents across src. Idempotent; prints per-mapping replacement counts.
 *
 *   node scripts/ui-fidelity/apply-token-mapping.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { repoRoot } from './lib/palette.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const EXTS = new Set(['.css', '.wxss', '.wxml', '.ts', '.json'])
const SKIP_DIRS = new Set(['assets', 'node_modules', 'dist', '.tmp'])

// Off-token literal -> MIP registered value (see config/mip-palette.json).
const MAPPING = [
  { from: '#040404', to: '#080808', note: 'canvas -> bg-page' },
  { from: '#090909', to: '#080808', note: 'near-black -> bg-page' },
  { from: '#111111', to: '#080808', note: 'near-black -> bg-page' },
  { from: '#040000', to: '#080808', note: 'onBrand -> text-on-brand' },
  { from: '#a3a3a3', to: '#b3b3b3', note: 'muted -> text-secondary' },
  { from: '#363636', to: '#333333', note: 'line -> bg-surface-2' },
  { from: '#2a2a2a', to: '#242424', note: 'raised -> bg-surface-3' },
  { from: '#e65c5c', to: '#ff4d5e', note: 'danger' },
  { from: '#43b581', to: '#18e779', note: 'success' },
  { from: '#e3c900', to: '#d0b801', note: 'brand active -> brand-dark-stroke' },
  { from: '#3b3505', to: '#4d4400', note: 'brand soft -> progress-slot' },
  { from: '#72680f', to: '#4d4400', note: 'brand disabled -> progress-slot' },
  { from: 'rgb(4 4 4', to: 'rgb(8 8 8', note: 'scrim of bg-page' },
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith('.')
      || (entry.isDirectory() && SKIP_DIRS.has(entry.name))
    ) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    }
    else if (EXTS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

function regexFor(literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundary = literal.startsWith('#') ? '(?![0-9a-fA-F])' : '(?!\\d)'
  return new RegExp(`${escaped}${boundary}`, 'gi')
}

function matchCase(sample, target) {
  const hexish = /^#[0-9a-f]+$/i.test(sample)
  return hexish && sample.slice(1) !== sample.slice(1).toLowerCase()
    ? target.toUpperCase()
    : target
}

const dryRun = process.argv.includes('--dry-run')
const counts = new Map(MAPPING.map(entry => [entry.from, 0]))
let filesChanged = 0

for (const file of walk(SRC)) {
  let text = fs.readFileSync(file, 'utf8')
  const before = text
  for (const { from, to } of MAPPING) {
    text = text.replace(regexFor(from), (matched) => {
      counts.set(from, (counts.get(from) ?? 0) + 1)
      return matchCase(matched, to)
    })
  }
  if (text !== before) {
    filesChanged += 1
    if (!dryRun) {
      fs.writeFileSync(file, text)
    }
  }
}

console.log(`${dryRun ? 'would rewrite' : 'rewrote'} ${filesChanged} files`)
for (const { from, to, note } of MAPPING) {
  const count = counts.get(from) ?? 0
  if (count) {
    console.log(`  ${from} -> ${to}  x${count}  (${note})`)
  }
}
