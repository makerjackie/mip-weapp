import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPackageSizeContract,
  collectReachableNpmFiles,
  PACKAGE_SIZE_BUDGETS,
} from '../scripts/lib/package-size-contract.mjs'
import { normalizeSubpackageNpmComponentReferences } from '../scripts/lib/subpackage-npm-references.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-package-size-'))
  const dist = path.join(root, 'dist')

  function write(file: string, content: string) {
    const absolutePath = path.join(dist, file)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content)
  }

  write('app.json', JSON.stringify({
    pages: ['pages/index/index'],
    subPackages: [{ root: 'packages/member', pages: ['index'] }],
  }))
  write('pages/index/index.json', JSON.stringify({
    usingComponents: {
      't-button': '/miniprogram_npm/tdesign-miniprogram/button/button',
    },
  }))
  write('packages/member/index.js', 'Page({})')
  write('miniprogram_npm/tdesign-miniprogram/button/button.js', `require('../common/utils')`)
  write('miniprogram_npm/tdesign-miniprogram/button/button.json', JSON.stringify({
    usingComponents: { 't-icon': '../icon/icon' },
  }))
  write('miniprogram_npm/tdesign-miniprogram/button/button.wxml', '<view />')
  write('miniprogram_npm/tdesign-miniprogram/button/button.wxss', '@import "../common/base.wxss";')
  write('miniprogram_npm/tdesign-miniprogram/icon/icon.js', 'Component({})')
  write('miniprogram_npm/tdesign-miniprogram/icon/icon.json', '{}')
  write('miniprogram_npm/tdesign-miniprogram/icon/icon.wxml', '<view />')
  write('miniprogram_npm/tdesign-miniprogram/icon/icon.wxss', '')
  write('miniprogram_npm/tdesign-miniprogram/common/utils.js', 'module.exports = {}')
  write('miniprogram_npm/tdesign-miniprogram/common/base.wxss', '')

  const report = {
    packages: [
      {
        id: '__main__',
        files: [
          'app.json',
          'pages/index/index.json',
        ].map(file => ({ file, size: fs.statSync(path.join(dist, file)).size })),
      },
      {
        id: 'packages/member',
        files: [{
          file: 'packages/member/index.js',
          size: fs.statSync(path.join(dist, 'packages/member/index.js')).size,
        }],
      },
    ],
  }

  return { root, dist, report, write }
}

describe('compiled package size contract', () => {
  it('makes non-independent subpackage npm component paths explicitly main-package absolute', () => {
    const item = fixture()
    item.write('packages/member/index.json', JSON.stringify({
      usingComponents: {
        't-button': '../../miniprogram_npm/tdesign-miniprogram/button/button',
        'app-card': '/components/card/index',
      },
    }))
    const appJson = JSON.parse(fs.readFileSync(path.join(item.dist, 'app.json'), 'utf8'))

    expect(normalizeSubpackageNpmComponentReferences(item.dist, appJson))
      .toEqual({ updatedFiles: 1, updatedReferences: 1 })
    expect(JSON.parse(fs.readFileSync(path.join(item.dist, 'packages/member/index.json'), 'utf8')).usingComponents)
      .toEqual({
        't-button': '/miniprogram_npm/tdesign-miniprogram/button/button',
        'app-card': '/components/card/index',
      })
  })

  it('reconciles every package and counts the recursive npm runtime closure', () => {
    const item = fixture()
    const reachable = collectReachableNpmFiles(item.dist)
    expect([...reachable.keys()].sort()).toEqual([
      'miniprogram_npm/tdesign-miniprogram/button/button.js',
      'miniprogram_npm/tdesign-miniprogram/button/button.json',
      'miniprogram_npm/tdesign-miniprogram/button/button.wxml',
      'miniprogram_npm/tdesign-miniprogram/button/button.wxss',
      'miniprogram_npm/tdesign-miniprogram/common/base.wxss',
      'miniprogram_npm/tdesign-miniprogram/common/utils.js',
      'miniprogram_npm/tdesign-miniprogram/icon/icon.js',
      'miniprogram_npm/tdesign-miniprogram/icon/icon.json',
      'miniprogram_npm/tdesign-miniprogram/icon/icon.wxml',
      'miniprogram_npm/tdesign-miniprogram/icon/icon.wxss',
    ])

    const summary = assertPackageSizeContract(item.root, item.report)
    expect(summary.reachableNpmFileCount).toBe(10)
    expect(summary.mainWithReachableNpmBytes).toBeGreaterThan(summary.sizes.__main__)
  })

  it('rejects npm copied into any declared subpackage', () => {
    const item = fixture()
    item.write('packages/member/miniprogram_npm/tdesign-miniprogram/button/button.js', '')
    expect(() => assertPackageSizeContract(item.root, item.report))
      .toThrow('Subpackage packages/member must reuse main-package npm dependencies')
  })

  it('rejects an analyze report that omits a physical output file', () => {
    const item = fixture()
    item.write('packages/member/extra.js', '')
    expect(() => assertPackageSizeContract(item.root, item.report))
      .toThrow('Analyze/dist mismatch for packages/member')
  })

  it('rejects a package whose reachable runtime closure exceeds the internal budget', () => {
    const item = fixture()
    expect(() => assertPackageSizeContract(item.root, item.report, {
      ...PACKAGE_SIZE_BUDGETS,
      dependencyAwarePackageBytes: 1,
    })).toThrow('Package __main__ with reachable runtime dependencies exceeds internal budget')
  })
})
