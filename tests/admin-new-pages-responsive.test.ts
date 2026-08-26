import type { AtRule, Root, Rule } from 'postcss'

import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function findMedia(stylesheet: Root, params: string) {
  const match = stylesheet.nodes.find(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params,
  )
  expect(match).toBeDefined()
  return match!
}

function findRule(container: Root | AtRule, selector: string) {
  const match = container.nodes?.find(
    (node): node is Rule => node.type === 'rule' && node.selectors.includes(selector),
  )
  expect(match).toBeDefined()
  return match!
}

function declarations(rule: Rule) {
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value.replace(/\s+/g, ' ').trim()]),
  )
}

describe('new operations admin pages responsive contracts', () => {
  it('stacks long review actions on phones while retaining two desktop columns', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const actionGrid = findRule(stylesheet, '.mip-admin-action-grid')
    const actionItems = findRule(stylesheet, '.mip-admin-action-grid > *')
    const phone = findMedia(stylesheet, '(max-width: 599px)')
    const phoneGrid = findRule(phone, '.mip-admin-action-grid')

    expect(declarations(actionGrid)).toMatchObject({ 'min-width': '0' })
    expect(declarations(actionItems)).toMatchObject({ 'min-width': '0', 'max-width': '100%' })
    expect(declarations(phoneGrid)).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr)' })
  })

  it('allows exceptions section filters to wrap within the phone viewport', () => {
    const source = read('src/packages/admin/exceptions/index.wxml')

    expect(source.match(/class="flex flex-wrap items-end justify-between gap-3"/g)).toHaveLength(2)
    expect(source.match(/class="min-w-0 flex-1"><view class="text-\[length:30rpx\] font-semibold"/g)).toHaveLength(2)
    expect(source.match(/class="flex max-w-full flex-wrap gap-2"/g)).toHaveLength(2)
  })

  it('keeps the new ledger and detail pages on the shared shell contracts', () => {
    const ledger = read('src/packages/admin/membership-ledger/index.wxml')
    const detail = read('src/packages/admin/message-delivery-review/index.wxml')

    for (const source of [ledger, detail]) {
      expect(source).toContain('mip-admin-page mip-admin-workspace-page')
      expect(source).toContain('<mip-admin-workspace-nav />')
      expect(source).toContain('<app-page-exit />')
    }
    expect(ledger).toContain('class="mip-admin-record-list mt-5"')
    expect(ledger).toContain('break-all text-[length:19rpx] text-muted')
    expect(detail).toContain('class="mip-admin-action-grid mt-4 grid grid-cols-2 gap-2"')
  })
})
