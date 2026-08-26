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
      .map(node => [node.prop, node.value]),
  )

  expect(declarations).toMatchObject(expected)
}

describe('MIP member responsive foundation', () => {
  const app = JSON.parse(read('src/app.json')) as {
    pages: string[]
    subPackages: Array<{ root: string, pages: string[] }>
    tabBar: { list: Array<{ pagePath: string }> }
  }
  const memberPackage = app.subPackages.find(item => item.root === 'packages/member')

  it('centres all active member routes in the shared width-controlled shell', () => {
    expect(memberPackage).toBeDefined()
    if (!memberPackage) {
      return
    }

    const memberRoutes = [
      ...app.pages,
      ...memberPackage.pages.map(page => `${memberPackage.root}/${page}`),
    ]
    for (const route of memberRoutes) {
      const source = read(`src/${route}.wxml`)
      const rootView = source.match(/^\s*<view\b[^>]*>/)?.[0] || ''
      const className = rootView.match(/\bclass="([^"]+)"/)?.[1] || ''

      expect(className.split(/\s+/), route).toContain('mip-member-page')
    }
  })

  it('keeps every native TabBar page clear of the safe bottom area', () => {
    for (const tab of app.tabBar.list) {
      const source = read(`src/${tab.pagePath}.wxml`)
      const rootView = source.match(/^\s*<view\b[^>]*>/)?.[0] || ''
      const className = rootView.match(/\bclass="([^"]+)"/)?.[1] || ''

      expect(className.split(/\s+/), tab.pagePath).toContain('mip-member-tab-page')
    }

    expectDeclarations(postcss.parse(read('src/app.css')), '.mip-member-tab-page', {
      'padding-bottom': 'calc(env(safe-area-inset-bottom) + 220rpx)',
    }, true)
  })

  it('uses stable phone, tablet, and desktop content widths', () => {
    const stylesheet = postcss.parse(read('src/app.css'))

    expectDeclarations(stylesheet, '.mip-member-page', {
      'box-sizing': 'border-box',
      'width': '100%',
      'min-width': '0',
      'max-width': 'var(--mip-member-shell-max-width)',
      'margin-right': 'auto',
      'margin-left': 'auto',
    }, true)
    expectDeclarations(findMedia(stylesheet, '(max-width: 599px)'), '.mip-member-page', {
      '--mip-member-shell-max-width': '100%',
    })
    expectDeclarations(findMedia(stylesheet, '(min-width: 600px) and (max-width: 959px)'), '.mip-member-page', {
      '--mip-member-shell-max-width': '720px',
    })
    expectDeclarations(findMedia(stylesheet, '(min-width: 960px)'), '.mip-member-page', {
      '--mip-member-shell-max-width': '840px',
    })
  })

  it('uses one platform-backed custom-navigation inset on the city-led main tabs', () => {
    for (const page of [
      { route: 'events', prefix: 'events' },
      { route: 'opportunities', prefix: 'opportunities' },
    ]) {
      const pageConfig = JSON.parse(read(`src/pages/${page.route}/index.json`)) as {
        navigationBarTitleText?: string
        navigationStyle?: string
      }
      const pageSource = read(`src/pages/${page.route}/index.wxml`)
      const pageScript = read(`src/pages/${page.route}/index.ts`)
      const navigationStart = pageSource.indexOf(`id="${page.prefix}-custom-navigation"`)
      const navigationEnd = pageSource.indexOf('\n\n', navigationStart)
      const navigationMarkup = pageSource.slice(navigationStart, navigationEnd)

      expect(pageConfig.navigationStyle).toBe('custom')
      expect(pageConfig.navigationBarTitleText).toBeUndefined()
      expect(pageSource.match(/\{\{statusBarHeight\}\}/g)).toHaveLength(1)
      expect(pageSource).toContain(`id="${page.prefix}-status-bar"`)
      expect(pageSource).toContain('style="height: {{statusBarHeight}}px;"')
      expect(pageSource).not.toContain('safe-area-inset-top')
      expect(navigationMarkup).toContain('h-[88rpx]')
      expect(navigationMarkup).toContain('pr-[200rpx]')
      expect(navigationMarkup).toContain('max-w-[360rpx]')
      expect(navigationMarkup).toContain('truncate')
      expect(navigationMarkup).not.toContain('justify-center')
      expect(pageScript).toContain('getCustomNavigationStatusBarHeight')
      expect(pageScript).toContain('statusBarHeight: getCustomNavigationStatusBarHeight()')
      expect(pageScript).not.toContain('wx.getWindowInfo')
      expect(pageSource).not.toMatch(/<app-page-exit\b|aria-label="返回|bind:tap="(?:goBack|navigateBack|leavePage)"/)
    }
  })

  it('keeps the opaque custom TabBar above content while constraining its desktop row', () => {
    const stylesheet = postcss.parse(read('src/custom-tab-bar/index.wxss'))

    expectDeclarations(stylesheet, '.tab-bar', {
      'bottom': '0',
      'padding-bottom': 'env(safe-area-inset-bottom)',
      'background-color': '#202020',
      'z-index': '9999',
      'pointer-events': 'auto',
    })
    expectDeclarations(stylesheet, '.tab-bar-row', {
      'width': '100%',
      'max-width': '100%',
      'height': '96rpx',
      'margin-right': 'auto',
      'margin-left': 'auto',
    }, true)
    expectDeclarations(findMedia(stylesheet, '(min-width: 600px) and (max-width: 959px)'), '.tab-bar-row', {
      'max-width': '720px',
    })
    expectDeclarations(findMedia(stylesheet, '(min-width: 960px)'), '.tab-bar-row', {
      'max-width': '840px',
    })
  })

  it('constrains important fixed member actions to the same desktop shell', () => {
    for (const file of [
      'src/packages/member/mip-events/detail/index.wxml',
      'src/packages/member/mip-events/registration/index.wxml',
      'src/packages/member/mip-opportunities/detail/index.wxml',
      'src/packages/member/mip-opportunities/editor/index.wxml',
      'src/packages/member/mip-people/index.wxml',
      'src/packages/member/mip-public-profile/index.wxml',
    ]) {
      const hasConstrainedFixedAction = [...read(file).matchAll(/\bclass="([^"]+)"/g)]
        .some((match) => {
          const tokens = match[1].split(/\s+/)
          return tokens.includes('fixed')
            && tokens.some(token => ['mip-member-fixed-edge', 'mip-member-fixed-inset'].includes(token))
        })

      expect(hasConstrainedFixedAction, file).toBe(true)
    }
  })
})
