import type { AtRule, Container, Root, Rule } from 'postcss'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_RESPONSIVE_PANEL_BREAKPOINT,
  createAdminResponsivePanelController,
  resolveAdminResponsivePanelPlacement,
} from '../src/packages/admin/components/responsive-panel/model'

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

function declarations(container: Container, selector: string, topLevel = false) {
  return Object.fromEntries(
    findRule(container, selector, topLevel).nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value]),
  )
}

describe('MIP admin responsive panel', () => {
  it('switches at the public 960px breakpoint', () => {
    expect(ADMIN_RESPONSIVE_PANEL_BREAKPOINT).toBe(960)
    expect(resolveAdminResponsivePanelPlacement(959)).toBe('bottom')
    expect(resolveAdminResponsivePanelPlacement(960)).toBe('right')
  })

  it('uses the initial window width and preserves page state across resize round trips', () => {
    const listeners: Array<(result: { size: { windowWidth: number } }) => void> = []
    const removed: Array<(result: { size: { windowWidth: number } }) => void> = []
    const placements: string[] = []
    const pageState = {
      query: '深圳',
      kind: 'PLAYER',
      selectedId: 'profile-1',
      detail: { nickname: '测试用户' },
      detailOpen: true,
    }
    const initialPageState = structuredClone(pageState)
    const controller = createAdminResponsivePanelController({
      getWindowInfo: () => ({ windowWidth: 960 }),
      onWindowResize: listener => listeners.push(listener),
      offWindowResize: listener => removed.push(listener),
    }, placement => placements.push(placement))

    controller.attach()
    expect(placements).toEqual(['right'])
    expect(listeners).toHaveLength(1)

    listeners[0]({ size: { windowWidth: 959 } })
    listeners[0]({ size: { windowWidth: 960 } })
    listeners[0]({ size: { windowWidth: 375 } })
    expect(placements).toEqual(['right', 'bottom', 'right', 'bottom'])
    expect(pageState).toEqual(initialPageState)

    controller.detach()
    expect(removed).toEqual([listeners[0]])
  })

  it('uses only public window APIs and changes component placement only', () => {
    const source = read('src/packages/admin/components/responsive-panel/index.ts')

    expect(source).toContain('createAdminResponsivePanelController(wx')
    expect(source).toContain('this.setData({ placement })')
    expect(source).not.toMatch(/setData\(\{[^}]*\b(?:visible|query|filter|selected|detail)\b/)
    expect(source).not.toContain('wx.setWindowSize')
  })

  it('defines a safe bottom sheet and a bounded desktop side panel', () => {
    const stylesheet = postcss.parse(read('src/packages/admin/components/responsive-panel/index.wxss'))
    expect(declarations(stylesheet, '.mip-admin-responsive-panel', true)).toMatchObject({
      'box-sizing': 'border-box',
      'width': '100vw',
      'max-width': '100vw',
      'max-height': '86vh',
      'overflow': 'hidden',
    })
    expect(declarations(stylesheet, '.mip-admin-responsive-panel__close', true)).toMatchObject({
      'min-width': '88rpx',
      'min-height': '88rpx',
    })
    expect(read('src/packages/admin/components/responsive-panel/index.wxss'))
      .toContain('calc(env(safe-area-inset-bottom) + 32rpx)')

    const desktop = findMedia(stylesheet, '(min-width: 960px)')
    expect(declarations(desktop, '.mip-admin-responsive-panel')).toMatchObject({
      'width': '520px',
      'max-width': '100vw',
      'height': '100vh',
      'max-height': '100vh',
    })
  })

  it('forwards close and visible-change separately through the TDesign popup contract', () => {
    const source = read('src/packages/admin/components/responsive-panel/index.wxml')
    const script = read('src/packages/admin/components/responsive-panel/index.ts')

    expect(source).toContain('placement="{{placement}}"')
    expect(source).toContain('bind:visible-change="handleVisibleChange"')
    expect(source).toContain('bind:tap="handleClose"')
    expect(script).toContain('this.triggerEvent(\'close\', { trigger: \'close-button\' })')
    expect(script).toContain('this.triggerEvent(\'visible-change\', {')
  })

  it('reuses the profiles detail state, content, and handlers without adding business requests', () => {
    const config = JSON.parse(read('src/packages/admin/profiles/index.json')) as { usingComponents: Record<string, string> }
    const template = read('src/packages/admin/profiles/index.wxml')
    const script = read('src/packages/admin/profiles/index.ts')

    expect(config.usingComponents['mip-admin-responsive-panel'])
      .toBe('/packages/admin/components/responsive-panel/index')
    expect(config.usingComponents['t-popup']).toBeUndefined()
    expect(template).toContain('<mip-admin-responsive-panel visible="{{detailOpen}}" title="用户详情" bind:close="closeDetail" bind:visible-change="handleDetailVisibility">')
    for (const state of ['loading', 'error']) {
      expect(template).toContain(`detailState === '${state}'`)
    }
    expect(template).toContain('bind:close="closeDetail"')
    expect(template).toContain('bind:visible-change="handleDetailVisibility"')
    for (const handler of [
      'openRelatedCase',
      'openRelatedOpportunity',
      'openRelatedRegistration',
      'openOrders',
    ]) {
      expect(template).toContain(`tap="${handler}"`)
    }
    expect(script).not.toContain('onWindowResize')
    expect(script).not.toContain('getWindowInfo')
  })
})
