#!/usr/bin/env node
/**
 * Regenerate the vendored Layer-1 baseline (config/mip-palette.json) from the
 * mip-design-system skill snapshot. Run this after the skill is updated.
 *
 *   node scripts/ui-fidelity/build-baseline.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  buildPaletteFromTokensWxss,
  DESIGN_SCALES,
  THEME_MAPPING,
} from './lib/palette.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const skillDir = path.join(root, '.claude/skills/mip-design-system')
const tokensPath = path.join(skillDir, 'assets/wechat/tokens.wxss')
const manifestPath = path.join(skillDir, 'assets/MANIFEST.md')
const outPath = path.join(root, 'config/mip-palette.json')

if (!fs.existsSync(tokensPath)) {
  console.error(
    `missing SOT: ${tokensPath}\nInstall the mip-design-system skill before regenerating the baseline.`,
  )
  process.exit(1)
}

const tokensSource = fs.readFileSync(tokensPath, 'utf8')
const snapshot
  = (manifestPath && fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, 'utf8')
    : ''
  ).match(/snapshot[:\s]+([0-9.]+)/i)?.[1] ?? 'unknown'
const scales
  = tokensSource.match(/--mip-([a-z0-9-]+)\s*:\s*([^;\s][^;]*);/g) ?? []

function rpxScale(name) {
  const decl = scales.find(line => line.includes(`--mip-${name}:`))
  return decl ? Number.parseFloat(decl.split(':')[1]) : null
}

const doc = {
  schemaVersion: 1,
  generatedFrom:
    'mip-design-system skill (assets/wechat/tokens.wxss + references/DESIGN.md)',
  skillSnapshot: snapshot,
  conversion: '1 design px = 2 rpx',
  colors: buildPaletteFromTokensWxss(tokensSource),
  scales: {
    ...DESIGN_SCALES,
    contentWidthRpx: rpxScale('content-width'),
    pageMarginRpx: rpxScale('page-margin'),
    rowHeightRpx: rpxScale('row-height'),
  },
  themeMapping: THEME_MAPPING,
  hardRules: [
    'page background must be #080808',
    'card/row surface must be #202020',
    'brand yellow is #fcdf03; unregistered yellows are forbidden',
    'yellow actions and activated chips need a #080808 keyline',
    'content width 702rpx with 24rpx side margins on a 750rpx page',
    'icons come from the mip-icon registry only',
    'no local image paths in WXSS background-image',
  ],
}

fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`)
console.log(
  `wrote ${path.relative(root, outPath)} (${doc.colors.length} colors)`,
)
