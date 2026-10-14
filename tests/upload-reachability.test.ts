import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectStaticAssetReferences, findStrippedAssetCandidates } from '../scripts/lib/upload-reachability.mjs'

function makeDist(files: Record<string, string>) {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-reachability-'))
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(distRoot, relative)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, content)
  }
  return distRoot
}

describe('upload asset reachability (ignoreUploadUnusedFiles mirror)', () => {
  it('keeps statically referenced assets and strips js-literal-only assets (MIW-100 behavior)', () => {
    const distRoot = makeDist({
      'app.json': '{"pages":["pages/index/index"]}',
      'pages/index/index.wxml': '<image src="/assets/kept.png" />',
      'pages/index/index.js': 'const dynamicOnly = "/assets/lost.png"',
      'assets/kept.png': 'png',
      'assets/lost.png': 'png',
    })

    const summary = findStrippedAssetCandidates(distRoot, [])
    expect(summary.assetCount).toBe(2)
    expect(summary.stripped).toEqual(['/assets/lost.png'])
  })

  it('does not mistake {{}} interpolations for static references', () => {
    const distRoot = makeDist({
      'pages/index/index.wxml': '<image src="/assets/badge-{{item.key}}.png" />',
      'assets/badge-heart.png': 'png',
    })

    expect(findStrippedAssetCandidates(distRoot, []).stripped).toEqual(['/assets/badge-heart.png'])
  })

  it('honors exact and prefix allowlist entries and reports stale ones', () => {
    const distRoot = makeDist({
      // fixed.png 已有静态引用：它的 allowlist 条目不再命中任何被剔资产，应报 stale。
      'pages/index/index.wxml': '<image src="/assets/kept.png" /><image src="/assets/fixed.png" />',
      'assets/kept.png': 'png',
      'assets/known.webp': 'png',
      'assets/gone.png': 'png',
      'assets/fixed.png': 'png',
    })

    const summary = findStrippedAssetCandidates(distRoot, [
      { path: '/assets/known.webp', reason: 'known dynamic-only' },
      { path: '/assets/gone*', reason: 'dynamic cohort' },
      { path: '/assets/fixed.png', reason: 'stale entry' },
    ])
    expect(summary.stripped).toEqual([])
    expect(summary.allowlisted.map(item => item.asset)).toEqual(['/assets/gone.png', '/assets/known.webp'])
    expect(summary.stale).toEqual(['/assets/fixed.png'])
  })

  it('requires a reason on every allowlist entry', () => {
    const distRoot = makeDist({ 'assets/a.png': 'png' })
    expect(() => findStrippedAssetCandidates(distRoot, [{ path: '/assets/a.png', reason: ' ' }]))
      .toThrow(/non-empty path and reason/)
  })

  it('collects wxss and json references alongside wxml', () => {
    const distRoot = makeDist({
      'app.json': '{"tabBar":{"list":[{"iconPath":"/assets/tab.png"}]}}',
      'pages/index/index.wxss': '.hero { background-image: url("/assets/hero.png"); }',
      'assets/tab.png': 'png',
      'assets/hero.png': 'png',
    })

    const references = collectStaticAssetReferences(distRoot)
    expect(references.has('/assets/tab.png')).toBe(true)
    expect(references.has('/assets/hero.png')).toBe(true)
  })
})
