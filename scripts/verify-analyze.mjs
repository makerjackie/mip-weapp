#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertWebpAssetsAnalyzed, discoverSourceWebpAssets } from './lib/analyze-asset-contract.mjs'
import { assertPackageSizeContract } from './lib/package-size-contract.mjs'
import { assertUploadAssetReachability } from './lib/upload-reachability.mjs'

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
const packageSummary = assertPackageSizeContract(root, report)
// MIW-100：镜像 ignoreUploadUnusedFiles 的上传过滤，纯动态引用的本地资产在构建期
// 就报出来（工具预览不 filtering，真机才会缺图，不能靠模拟器验收发现）。
const reachability = assertUploadAssetReachability(path.join(root, 'dist'), { verbose: true })
console.log(`WebP analyze contract passed (${summary.assetCount} assets, ${summary.totalBytes} bytes)`)
console.log(`Package size contract passed (${Object.entries(packageSummary.dependencyAwareSizes).map(([id, size]) => `${id} ${size} bytes with reachable dependencies`).join('; ')})`)
console.log(`Upload asset reachability passed (${reachability.assetCount} dist assets, ${reachability.allowlisted.length} allowlisted dynamic-only)`)
