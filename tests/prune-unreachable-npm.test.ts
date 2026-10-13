import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNestedVendorTreePresent, pruneUnreachableNpmFiles } from '../scripts/lib/prune-unreachable-npm.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-prune-npm-'))
  const dist = path.join(root, 'dist')

  function write(file: string, content: string) {
    const absolutePath = path.join(dist, file)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content)
  }

  write('app.json', JSON.stringify({ pages: ['pages/index/index'] }))
  write('pages/index/index.js', 'Page({})')
  write('pages/index/index.json', JSON.stringify({
    usingComponents: {
      't-button': '/miniprogram_npm/tdesign-miniprogram/button/button',
    },
  }))
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
  // 与 button 同级的未使用组件（calendar），必须被裁掉
  write('miniprogram_npm/tdesign-miniprogram/calendar/calendar.js', 'Component({})')
  write('miniprogram_npm/tdesign-miniprogram/calendar/calendar.json', '{}')
  // 嵌套依赖树：裸 require 探不到（解析只查主包顶层），必须整棵保留
  write('miniprogram_npm/tdesign-miniprogram/miniprogram_npm/tslib/tslib.js', 'module.exports = {}')

  return { dist, write }
}

describe('prune unreachable npm files', () => {
  it('removes unused vendor components and keeps the reachable closure', () => {
    const item = fixture()
    const summary = pruneUnreachableNpmFiles(item.dist)

    expect(summary.removedFiles).toEqual([
      'miniprogram_npm/tdesign-miniprogram/calendar/calendar.js',
      'miniprogram_npm/tdesign-miniprogram/calendar/calendar.json',
    ])
    expect(fs.existsSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/calendar'))).toBe(false)
    expect(fs.existsSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/button/button.js'))).toBe(true)
    expect(fs.existsSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/icon/icon.js'))).toBe(true)
    expect(fs.existsSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/common/utils.js'))).toBe(true)
    expect(summary.bytesSaved).toBeGreaterThan(0)
  })

  it('keeps the nested vendor dependency tree the reachability walk cannot see', () => {
    const item = fixture()
    pruneUnreachableNpmFiles(item.dist)

    expect(fs.existsSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/miniprogram_npm/tslib/tslib.js')))
      .toBe(true)
  })

  it('build gate passes on a healthy tree and fails when the nested tree is missing', () => {
    const item = fixture()
    expect(() => assertNestedVendorTreePresent(item.dist)).not.toThrow()

    fs.rmSync(path.join(item.dist, 'miniprogram_npm/tdesign-miniprogram/miniprogram_npm'), { recursive: true })
    expect(() => assertNestedVendorTreePresent(item.dist)).toThrow(/嵌套 vendor 依赖树/)
  })
})
