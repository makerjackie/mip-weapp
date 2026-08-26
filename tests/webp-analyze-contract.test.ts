import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzedWebpFiles, assertWebpAssetsAnalyzed } from '../scripts/lib/analyze-asset-contract.mjs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('WebP analyze contract', () => {
  it('registers WebP with the asset collector instead of copying it after analysis', () => {
    const config = source('weapp-vite.config.ts')
    const build = source('scripts/build.mjs')
    const packageJson = JSON.parse(source('package.json'))

    expect(config).toContain('include: [\'**/*.webp\']')
    expect(build).not.toContain('copyPassthroughAssets')
    expect(packageJson.scripts['verify:analyze']).toBe('node scripts/verify-analyze.mjs')
  })

  it('counts WebP output files across main and subpackages and fails closed when one is missing', () => {
    const report = {
      packages: [
        {
          id: '__main__',
          files: [{ file: 'assets/main.webp', size: 120 }],
        },
        {
          id: 'packages/member',
          files: [{ file: 'packages/member/assets/member.webp', size: 80 }],
        },
      ],
    }

    expect(analyzedWebpFiles(report)).toEqual([
      { file: 'assets/main.webp', size: 120 },
      { file: 'packages/member/assets/member.webp', size: 80 },
    ])
    expect(assertWebpAssetsAnalyzed([
      'assets/main.webp',
      'packages/member/assets/member.webp',
    ], report)).toEqual({ assetCount: 2, totalBytes: 200 })
    expect(() => assertWebpAssetsAnalyzed(['assets/missing.webp'], report))
      .toThrow('Analyze report omitted WebP assets: assets/missing.webp')
  })
})
