import type { AtRule, Root, Rule } from 'postcss'
import type { AdminCapabilityGrant } from '../src/modules/mip-admin'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import {
  activeAdminWorkspaceItemKey,
  adminWorkspaceGroups,
  buildAdminWorkspaceNavigation,
  redirectToAdminWorkspace,
} from '../src/packages/admin/components/workspace-nav/model'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function grant(capability: AdminCapabilityGrant['capability']): AdminCapabilityGrant {
  return { capability, scopeType: 'PLATFORM', scopeId: null }
}

function media(stylesheet: Root, params: string) {
  const matches = stylesheet.nodes.filter(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

function declarations(container: Root | AtRule, selector: string, topLevel = false) {
  const matches: Rule[] = []
  if (topLevel) {
    for (const node of container.nodes || []) {
      if (node.type === 'rule' && node.selectors.includes(selector)) {
        matches.push(node)
      }
    }
  }
  else {
    container.walkRules((rule) => {
      if (rule.selectors.includes(selector)) {
        matches.push(rule)
      }
    })
  }
  expect(matches).toHaveLength(1)
  return Object.fromEntries(
    matches[0].nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value]),
  )
}

describe('MIP admin desktop workspace navigation', () => {
  it('groups only authorized top-level destinations', () => {
    expect(adminWorkspaceGroups.map(group => group.label)).toEqual([
      '概览',
      '用户',
      '活动',
      '交易',
      '内容',
      '成长',
      '治理',
    ])

    const groups = buildAdminWorkspaceNavigation([
      grant('admin.dashboard'),
      grant('events.read'),
      grant('events.write'),
      grant('events.roster.read'),
      grant('branches.manage'),
      grant('messages.manage'),
      grant('growth.configure'),
    ], '/packages/admin/event-feedback/index?id=event-1')
    const items = groups.flatMap(group => group.items)

    expect(items.map(item => item.key)).toEqual([
      'dashboard',
      'managed-events',
      'event-participants',
      'message-campaigns',
      'message-delivery-records',
      'branches',
    ])
    expect(items.find(item => item.key === 'managed-events')?.active).toBe(true)
    expect(items.some(item => item.key === 'growth-levels')).toBe(false)
  })

  it('matches the minimum capabilities required to open growth and badge pages', () => {
    const groups = buildAdminWorkspaceNavigation([
      grant('growth.read'),
      grant('badges.manage'),
    ], '/packages/admin/growth-levels/index')
    const items = groups.flatMap(group => group.items)

    expect(items.map(item => item.key)).toEqual(['growth-entries', 'benefit-ledger', 'growth-transitions', 'growth-levels', 'badges'])
    expect(items.find(item => item.key === 'growth-levels')?.active).toBe(true)
  })

  it('exposes event catalogs and recaps only to their platform capabilities', () => {
    const groups = buildAdminWorkspaceNavigation([
      grant('events.catalog.manage'),
      grant('events.recaps.manage'),
    ], '/packages/admin/event-recaps/index')
    const items = groups.flatMap(group => group.items)

    expect(items.map(item => item.key)).toEqual(['event-catalogs', 'event-recaps'])
    expect(items.find(item => item.key === 'event-recaps')?.active).toBe(true)

    const branchOnly = buildAdminWorkspaceNavigation([{
      capability: 'events.catalog.manage',
      scopeType: 'BRANCH',
      scopeId: 'branch-1',
    }], '/packages/admin/event-catalogs/index')
    expect(branchOnly.flatMap(group => group.items)).toEqual([])
  })

  it('maps every registered admin route to one top-level destination', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const adminPackage = app.subPackages.find(item => item.root === 'packages/admin')

    expect(adminPackage?.pages.length).toBeGreaterThanOrEqual(42)
    for (const page of adminPackage?.pages || []) {
      expect(activeAdminWorkspaceItemKey(`/${adminPackage?.root}/${page}?from=test`), page).not.toBeNull()
    }
  })

  it('uses redirect navigation and ignores the current or unknown page', () => {
    const redirectTo = vi.fn()
    const navigator = { redirectTo }

    expect(redirectToAdminWorkspace(
      '/packages/admin/profiles/index',
      'packages/admin/profiles/index',
      navigator,
    )).toBe(false)
    expect(redirectTo).not.toHaveBeenCalled()

    expect(redirectToAdminWorkspace(
      'packages/admin/opportunity-detail/index?id=opportunity-1',
      'packages/admin/opportunities/index',
      navigator,
    )).toBe(true)
    expect(redirectTo).toHaveBeenCalledWith({ url: '/packages/admin/opportunities/index' })

    expect(redirectToAdminWorkspace(
      'packages/admin/dashboard/index',
      'packages/admin/not-registered/index',
      navigator,
    )).toBe(false)
    expect(redirectTo).toHaveBeenCalledTimes(1)
  })

  it('registers and renders the shared workspace in all 42 admin pages', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const adminPackage = app.subPackages.find(item => item.root === 'packages/admin')

    for (const page of adminPackage?.pages || []) {
      const sourcePath = `src/${adminPackage?.root}/${page}`
      const source = read(`${sourcePath}.wxml`)
      const config = JSON.parse(read(`${sourcePath}.json`)) as {
        usingComponents?: Record<string, string>
      }
      const rootView = source.match(/^\s*<view\b[^>]*>/)?.[0] || ''
      const classes = rootView.match(/\bclass="([^"]+)"/)?.[1].split(/\s+/) || []

      expect(classes, page).toContain('mip-admin-workspace-page')
      expect(source.match(/<mip-admin-workspace-nav\s*\/>/g), page).toHaveLength(1)
      expect(config.usingComponents?.['mip-admin-workspace-nav'], page)
        .toBe('/packages/admin/components/workspace-nav/index')
    }
  })

  it('keeps the phone and tablet shell unchanged and reserves desktop sidebar space', () => {
    const appStyles = postcss.parse(read('src/app.css'))
    const navStyles = postcss.parse(read('src/packages/admin/components/workspace-nav/index.wxss'))
    const tabletWorkspaceRules: Rule[] = []
    media(appStyles, '(min-width: 600px) and (max-width: 959px)').walkRules((rule) => {
      if (rule.selectors.includes('.mip-admin-workspace-page')) {
        tabletWorkspaceRules.push(rule)
      }
    })

    expect(tabletWorkspaceRules).toHaveLength(0)
    expect(declarations(media(appStyles, '(min-width: 960px)'), '.mip-admin-workspace-page'))
      .toMatchObject({ 'min-width': '0', 'padding-left': '296px' })
    expect(declarations(navStyles, '.mip-admin-workspace-nav', true)).toMatchObject({ display: 'none' })
    expect(declarations(media(navStyles, '(min-width: 960px)'), '.mip-admin-workspace-nav'))
      .toMatchObject({
        position: 'fixed',
        display: 'flex',
        width: '232px',
        overflow: 'hidden',
      })
  })

  it('loads the cached admin session and delegates route changes to wx.redirectTo', () => {
    const component = read('src/packages/admin/components/workspace-nav/index.ts')
    const config = JSON.parse(read('src/packages/admin/components/workspace-nav/index.json')) as {
      component?: boolean
      styleIsolation?: string
    }

    expect(config).toMatchObject({ component: true, styleIsolation: 'apply-shared' })
    expect(component).toContain('mipAdminModule.getSession()')
    expect(component).not.toContain('mipAdminModule.getSession(true)')
    expect(component).toContain('redirectToAdminWorkspace(currentAdminRoute(), targetRoute, wx)')
  })
})
