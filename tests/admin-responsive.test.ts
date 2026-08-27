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

function findMedia(rootNode: Root, params: string) {
  const matches = rootNode.nodes.filter(
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

  expect(matches).toHaveLength(1)
  return matches[0]
}

function expectDeclarations(container: Container, selector: string, expected: Record<string, string>, topLevel = false) {
  const rule = findRule(container, selector, topLevel)
  const declarations = Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [
        node.prop,
        node.value
          .replace(/\s+/g, ' ')
          .replace(/\(\s+/g, '(')
          .replace(/\s+\)/g, ')')
          .trim(),
      ]),
  )

  expect(declarations).toMatchObject(expected)
}

const gridPrimitives = [
  '.mip-admin-card-list',
  '.mip-admin-form-grid',
  '.mip-admin-menu-grid',
  '.mip-admin-metric-grid',
  '.mip-admin-summary-grid',
  '.mip-admin-filter-grid',
  '.mip-admin-section-grid',
  '.mip-admin-media-grid',
  '.mip-admin-banner-grid',
]

const recordPrimitives = [
  '.mip-admin-record-list',
  '.mip-admin-record-header',
  '.mip-admin-record-row',
  '.mip-admin-record-cell',
  '.mip-admin-record-label',
  '.mip-admin-record-actions',
]

const recordColumns = 'minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.5fr)'
const recordColumnsDeclaration = `--mip-admin-record-columns: ${recordColumns};`
const inheritedRecordColumns = `var(--mip-admin-record-columns, ${recordColumns})`

describe('MIP admin responsive foundation', () => {
  it('allows the WeChat desktop window to be resized', () => {
    const app = JSON.parse(read('src/app.json')) as { resizable?: boolean }

    expect(app.resizable).toBe(true)
  })

  it('keeps every shared grid and its direct items shrinkable', () => {
    const styles = read('src/app.css')
    const stylesheet = postcss.parse(styles)

    for (const primitive of gridPrimitives) {
      expectDeclarations(stylesheet, primitive, { 'min-width': '0' }, true)
      expectDeclarations(stylesheet, `${primitive} > *`, { 'min-width': '0' }, true)
    }

    expectDeclarations(stylesheet, '.mip-admin-banner-image', {
      'display': 'block',
      'width': '100%',
      'height': 'auto',
      'aspect-ratio': '16 / 9',
      'object-fit': 'cover',
    }, true)

    for (const primitive of recordPrimitives) {
      expectDeclarations(stylesheet, primitive, { 'min-width': '0' }, true)
    }
    expectDeclarations(stylesheet, '.mip-admin-record-row', {
      'box-sizing': 'border-box',
      'width': '100%',
      'overflow-wrap': 'anywhere',
    }, true)
    expectDeclarations(stylesheet, '.mip-admin-record-actions', {
      'display': 'flex',
      'flex-direction': 'column',
      'width': '100%',
    }, true)
    expectDeclarations(stylesheet, '.mip-admin-record-actions > *', {
      'min-width': '0',
      'min-height': '88rpx',
    }, true)
  })

  it('defines one-column phone filters and sections with denser media', () => {
    const phone = findMedia(postcss.parse(read('src/app.css')), '(max-width: 599px)')

    expectDeclarations(phone, '.mip-admin-page', { 'max-width': '100%' })
    expectDeclarations(phone, '.mip-admin-filter-grid', {
      'display': 'grid',
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(phone, '.mip-admin-section-grid', {
      'display': 'grid',
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(phone, '.mip-admin-media-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(phone, '.mip-admin-banner-grid', {
      'display': 'grid',
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(phone, '.mip-admin-record-list', {
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(phone, '.mip-admin-record-header', { display: 'none' })
    expectDeclarations(phone, '.mip-admin-record-row', {
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(phone, '.mip-admin-record-label', { display: 'block' })
  })

  it('defines two-column tablet workspaces and three-column media', () => {
    const medium = findMedia(postcss.parse(read('src/app.css')), '(min-width: 600px) and (max-width: 959px)')

    expectDeclarations(medium, '.mip-admin-page', { 'max-width': '920px' })
    expectDeclarations(medium, '.mip-admin-filter-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-filter-wide', { 'grid-column': 'span 2 / span 2' })
    expectDeclarations(medium, '.mip-admin-section-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-metric-grid', {
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-media-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-banner-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-span-wide', { 'grid-column': '1 / -1' })
    expectDeclarations(medium, '.mip-admin-record-list', {
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(medium, '.mip-admin-record-header', { display: 'none' })
    expectDeclarations(medium, '.mip-admin-record-row', {
      'grid-template-columns': 'minmax(0, 1fr)',
    })
    expectDeclarations(medium, '.mip-admin-record-label', { display: 'block' })
  })

  it('defines desktop density without changing page state', () => {
    const desktop = findMedia(postcss.parse(read('src/app.css')), '(min-width: 960px)')

    expectDeclarations(desktop, '.mip-admin-page', { 'max-width': '1280px' })
    expectDeclarations(desktop, '.mip-admin-filter-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-filter-wide', { 'grid-column': 'span 2 / span 2' })
    expectDeclarations(desktop, '.mip-admin-section-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-metric-grid', {
      'grid-template-columns': 'repeat(2, minmax(240px, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-media-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-banner-grid', {
      'display': 'grid',
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-span-wide', { 'grid-column': '1 / -1' })
    expectDeclarations(desktop, '.mip-admin-record-list', { display: 'block' })
    expectDeclarations(desktop, '.mip-admin-record-header', {
      'display': 'grid',
      'grid-template-columns': inheritedRecordColumns,
    })
    expectDeclarations(desktop, '.mip-admin-record-row', {
      'grid-template-columns': inheritedRecordColumns,
    })
    expectDeclarations(desktop, '.mip-admin-record-label', { display: 'none' })
  })

  it('keeps the user filter controls aligned as a form on desktop', () => {
    const stylesheet = postcss.parse(read('src/packages/admin/profiles/index.wxss'))
    const desktop = findMedia(stylesheet, '(min-width: 960px)')

    expectDeclarations(stylesheet, '.mip-admin-page .mip-admin-profiles-filter', {
      'display': 'flex',
      'flex-direction': 'column',
    }, true)
    expectDeclarations(desktop, '.mip-admin-page .mip-admin-profiles-filter', {
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expectDeclarations(desktop, '.mip-admin-profiles-filter-group', {
      'grid-template-columns': '132px minmax(0, 1fr)',
      'align-items': 'center',
    })
  })

  it('uses the shared record contract for managed events without changing page actions', () => {
    const source = read('src/packages/admin/managed-events/index.wxml')

    expect(source).toContain(`class="mip-admin-record-list mt-5" style="${recordColumnsDeclaration}"`)
    expect(source).toContain('class="mip-admin-record-header"')
    expect(source).not.toContain('aria-hidden="true"')
    expect(source).toContain('class="mip-admin-record-row"')
    expect(source.match(/class="mip-admin-record-cell"/g)).toHaveLength(4)
    expect(source.match(/class="mip-admin-record-label"/g)).toHaveLength(4)
    for (const label of ['活动', '时间与城市', '报名与签到', '状态与操作']) {
      expect(source).toContain(`<view class="mip-admin-record-label">${label}</view>`)
    }
    for (const handler of ['openEvent', 'cloneEvent', 'archiveEvent', 'loadMoreEvents']) {
      expect(source).toContain(`tap="${handler}"`)
    }
    for (const state of ['loading', 'error', 'conflict', 'forbidden', 'ready']) {
      expect(source).toContain(`state === '${state}'`)
    }
    expect(source).toContain('wx:if="{{nextCursor}}"')
  })

  it('keeps dashboard metrics in two phone columns and gives desktop cards usable width', () => {
    const source = read('src/packages/admin/dashboard/index.wxml')

    expect(source).toContain('class="mip-admin-metric-grid mt-3 grid grid-cols-2 gap-3"')
    expect(source.match(/wx:for="\{\{view\.summaryMetrics\}\}"/g)).toHaveLength(1)
    expect(source).not.toMatch(/\b(?:break-all|whitespace-nowrap)\b/)
  })

  it('applies the shared shell to every registered admin page', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages?: Array<{ root: string, pages: string[] }>
    }
    const adminPackage = app.subPackages?.find(item => item.root === 'packages/admin')

    expect(adminPackage).toBeDefined()
    if (!adminPackage) {
      return
    }
    expect(adminPackage.pages.length).toBeGreaterThan(0)
    for (const page of adminPackage.pages) {
      const routeName = page.replace(/\/index$/, '').replaceAll('/', '-')
      const source = read(`src/${adminPackage.root}/${page}.wxml`)
      const rootView = source.match(/^\s*<view\b[^>]*>/)?.[0] || ''
      const className = rootView.match(/\bclass="([^"]+)"/)?.[1] || ''
      const classTokens = className.split(/\s+/)

      expect(rootView).toContain(`id="admin-${routeName}-page"`)
      expect(classTokens).toContain('mip-admin-page')
      expect(classTokens).toContain('min-h-screen')
      expect(className).toContain('pb-[calc(env(safe-area-inset-bottom)+48rpx)]')
    }
  })
})
