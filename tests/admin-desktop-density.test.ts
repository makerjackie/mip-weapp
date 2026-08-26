import type { AtRule, Container, Root, Rule } from 'postcss'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function findMedia(stylesheet: Root, params: string) {
  const matches = stylesheet.nodes.filter(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

function findRule(container: Container, selector: string, topLevel = false) {
  const matches: Rule[] = []
  const collect = (rule: Rule) => {
    if (rule.selectors.includes(selector)) {
      matches.push(rule)
    }
  }

  if (topLevel) {
    for (const node of container.nodes || []) {
      if (node.type === 'rule') {
        collect(node)
      }
    }
  }
  else {
    container.walkRules(collect)
  }

  expect(matches, selector).toHaveLength(1)
  return matches[0]
}

function declarations(rule: Rule) {
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value.replace(/\s+/g, ' ').trim()]),
  )
}

describe('MIP admin desktop density', () => {
  it('keeps placeholder contrast scoped to the admin shell and TDesign variables', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const admin = declarations(findRule(stylesheet, '.mip-admin-page', true))

    expect(admin).toMatchObject({
      '--mip-admin-placeholder-color': '#a3a3a3',
      '--td-text-color-placeholder': 'var(--mip-admin-placeholder-color)',
      '--td-input-placeholder-text-color': 'var(--mip-admin-placeholder-color)',
      '--td-textarea-placeholder-color': 'var(--mip-admin-placeholder-color)',
    })
    expect(read('node_modules/tdesign-miniprogram/miniprogram_dist/input/input.wxss'))
      .toContain('var(--td-input-placeholder-text-color')
    expect(read('node_modules/tdesign-miniprogram/miniprogram_dist/textarea/textarea.wxss'))
      .toContain('var(--td-textarea-placeholder-color')
  })

  it('caps desktop typography, spacing, controls, and corners without zooming the page', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const desktop = findMedia(stylesheet, '(min-width: 960px)')
    const admin = declarations(findRule(desktop, '.mip-admin-page'))

    expect(admin).toMatchObject({
      '--spacing': '4px',
      '--mip-admin-font-body': '14px',
      '--mip-admin-font-display': '28px',
      '--td-button-large-height': '44px',
      '--td-input-vertical-padding': '11px 14px',
      '--td-textarea-padding': '12px 14px',
      'max-width': '1280px',
      'padding': '24px 32px 32px',
    })
    expect(admin).not.toHaveProperty('zoom')
    expect(admin).not.toHaveProperty('transform')

    const member = declarations(findRule(desktop, '.mip-member-page'))
    expect(member).toEqual({ '--mip-member-shell-max-width': '840px' })

    const fontMappings = new Map([
      ['.mip-admin-page .text-\\[length\\:22rpx\\]', 'var(--mip-admin-font-label)'],
      ['.mip-admin-page .text-\\[length\\:24rpx\\]', 'var(--mip-admin-font-body)'],
      ['.mip-admin-page .text-\\[length\\:28rpx\\]', 'var(--mip-admin-font-section)'],
      ['.mip-admin-page .text-\\[length\\:40rpx\\]', 'var(--mip-admin-font-display)'],
    ])
    for (const [selector, fontSize] of fontMappings) {
      expect(declarations(findRule(desktop, selector))).toMatchObject({ 'font-size': fontSize })
    }

    const controlMappings = new Map([
      ['.mip-admin-page .min-h-\\[88rpx\\]', '44px'],
      ['.mip-admin-page .min-h-\\[96rpx\\]', '48px'],
      ['.mip-admin-page .min-h-\\[104rpx\\]', '52px'],
    ])
    for (const [selector, minHeight] of controlMappings) {
      expect(declarations(findRule(desktop, selector))).toMatchObject({ 'min-height': minHeight })
    }

    expect(declarations(findRule(desktop, '.mip-admin-page .rounded-\\[12rpx\\]')))
      .toMatchObject({ 'border-radius': '8px' })
    expect(declarations(findRule(desktop, '.mip-admin-page .rounded-\\[16rpx\\]')))
      .toMatchObject({ 'border-radius': '12px' })
  })

  it('keeps catalog keys on one readable line instead of breaking every character', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const keyRule = declarations(findRule(stylesheet, '.mip-admin-catalog-key', true))
    const template = read('src/packages/admin/event-catalogs/index.wxml')
    const keyNode = template.match(/<view class="[^"]*">\{\{item\.key\}\}<\/view>/)?.[0] || ''

    expect(keyRule).toMatchObject({
      'overflow': 'hidden',
      'overflow-wrap': 'normal',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
      'word-break': 'normal',
    })
    expect(keyNode).toContain('mip-admin-catalog-key')
    expect(keyNode).not.toContain('break-all')
  })
})
