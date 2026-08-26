#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertWebpAssetsAnalyzed, discoverSourceWebpAssets } from './lib/analyze-asset-contract.mjs'

const root = path.resolve(import.meta.dirname, '..')
const reportPath = path.join(root, '.tmp/analyze-budget.json')
fs.mkdirSync(path.dirname(reportPath), { recursive: true })

const result = spawnSync('pnpm', [
  'exec',
  'wv',
  'analyze',
  '--budget-check',
  '--json',
  '--output',
  path.relative(root, reportPath),
], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const summary = assertWebpAssetsAnalyzed(discoverSourceWebpAssets(root), report)
console.log(`WebP analyze contract passed (${summary.assetCount} assets, ${summary.totalBytes} bytes)`)
