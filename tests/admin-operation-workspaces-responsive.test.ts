import type { AtRule, Root, Rule } from 'postcss'

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

function findRule(media: AtRule, selector: string) {
  const matches: Rule[] = []
  media.walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      matches.push(rule)
    }
  })
  expect(matches).toHaveLength(1)
  return matches[0]
}

function declarations(rule: Rule) {
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value.replace(/\s+/g, ' ').trim()]),
  )
}

const pagePaths = [
  'src/packages/admin/orders/index.wxml',
  'src/packages/admin/event-registrations/index.wxml',
  'src/packages/admin/event-participants/index.wxml',
]

describe('operation-dense admin workspaces', () => {
  it('keeps operation records in one-column cards on tablets', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const medium = findMedia(stylesheet, '(min-width: 600px) and (max-width: 959px)')

    expect(declarations(findRule(medium, '.mip-admin-filter-grid'))).toMatchObject({
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expect(declarations(findRule(medium, '.mip-admin-operations-workspace .mip-admin-section-grid'))).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expect(declarations(findRule(medium, '.mip-admin-operations-workspace .mip-admin-record-list'))).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expect(declarations(findRule(medium, '.mip-admin-operations-workspace .mip-admin-record-header'))).toMatchObject({
      display: 'none',
    })
    expect(declarations(findRule(medium, '.mip-admin-operations-workspace .mip-admin-record-row'))).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expect(declarations(findRule(medium, '.mip-admin-operations-workspace .mip-admin-record-label'))).toMatchObject({
      display: 'block',
    })
  })

  it('keeps the same card contract at 1024 and wider desktop widths', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const desktop = findMedia(stylesheet, '(min-width: 960px)')

    expect(desktop.params).not.toContain('max-width')
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-filter-grid'))).toMatchObject({
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-filter-wide'))).toMatchObject({
      'grid-column': 'span 2 / span 2',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-section-grid'))).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-record-list'))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-record-header'))).toMatchObject({
      display: 'none',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-record-row'))).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
      'margin-bottom': '0',
    })
    expect(declarations(findRule(desktop, '.mip-admin-operations-workspace .mip-admin-record-label'))).toMatchObject({
      display: 'block',
    })
  })

  it('scopes the safer desktop contract to the three operation-dense pages', () => {
    const app = JSON.parse(read('src/app.json')) as { subPackages?: Array<{ root: string, pages: string[] }> }
    const adminPackage = app.subPackages?.find(item => item.root === 'packages/admin')
    const scopedPages = (adminPackage?.pages || [])
      .map(page => `src/packages/admin/${page}.wxml`)
      .filter((page) => {
        const rootView = read(page).match(/^\s*<view\b[^>]*>/)?.[0] || ''
        const className = rootView.match(/\bclass="([^"]+)"/)?.[1] || ''
        return className.split(/\s+/).includes('mip-admin-operations-workspace')
      })

    expect(scopedPages.toSorted()).toEqual(pagePaths.toSorted())
    for (const pagePath of pagePaths) {
      const rootView = read(pagePath).match(/^\s*<view\b[^>]*>/)?.[0] || ''
      expect(rootView).toContain('mip-admin-operations-workspace')
    }
  })

  it('lets phone, export, and query actions wrap instead of exceeding their filter cell', () => {
    const stylesheet = postcss.parse(read('src/app.css'))
    const actionRule = stylesheet.nodes.find(
      (node): node is Rule => node.type === 'rule' && node.selectors.includes('.mip-admin-filter-actions'),
    )
    const childRule = stylesheet.nodes.find(
      (node): node is Rule => node.type === 'rule' && node.selectors.includes('.mip-admin-filter-actions > *'),
    )

    expect(actionRule).toBeDefined()
    expect(childRule).toBeDefined()
    expect(declarations(actionRule!)).toMatchObject({
      'display': 'flex',
      'flex-wrap': 'wrap',
      'width': '100%',
      'min-width': '0',
    })
    expect(declarations(childRule!)).toMatchObject({
      'flex': '1 1 200px',
      'min-width': '0',
      'max-width': '100%',
    })

    const registrations = read('src/packages/admin/event-registrations/index.wxml')
    const participants = read('src/packages/admin/event-participants/index.wxml')
    expect(registrations).toContain('class="mip-admin-filter-actions min-h-[88rpx] items-center"')
    expect(registrations).toContain('block size="small" variant="outline" bind:tap="showPhones"')
    expect(registrations).toContain('block size="small" variant="outline" loading="{{exportPending}}" bind:tap="createExport"')
    expect(participants).toContain('class="mip-admin-filter-actions mip-admin-span-wide"')
    expect(participants).toContain('class="min-w-0"><t-button block variant="outline" bind:tap="exportRows"')
    expect(participants).toContain('class="min-w-0"><t-button block theme="primary" bind:tap="search"')
  })
})
