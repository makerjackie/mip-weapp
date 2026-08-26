import type {
  AdminUserContentDetail,
  AdminUserContentListItem,
  MipAdminGateway,
} from '../src/modules/mip-admin'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  parseAdminUserContentDetail,
  parseAdminUserContentPage,
} from '../src/modules/mip-admin/user-content'
import {
  activeAdminWorkspaceItemKey,
  buildAdminWorkspaceNavigation,
} from '../src/packages/admin/components/workspace-nav/model'

vi.mock('../src/modules/platform/cloudbase', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '10000000-0000-4000-8000-000000000002'
const BRANCH_ID = '10000000-0000-4000-8000-000000000003'
const SEED_PUBLISHED_AT = '2026-08-25T12:00:00.000Z'

interface DemoSeed {
  branches: Array<{ id: string, name: string, cityName: string }>
  cooperationCards: Array<{
    id: string
    ownerUserId: string
    roleKey: string
    positioning: string
    targetSummary: string
    roleFields: Record<string, string | string[]>
  }>
  superCases: Array<{
    id: string
    ownerUserId: string
    projectName: string
    summary: string
    startedOn: string
    endedOn: string
    responsibility: string
    cityTagId: string
    industryTagId: string
    caseType: string
    description: string
  }>
  tags: Array<{ id: string, label: string }>
  users: Array<{ id: string, nickname: string, branchId: string }>
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const listItem: AdminUserContentListItem = {
  id: CONTENT_ID,
  kind: 'COOPERATION_CARD',
  title: '品牌视觉合作',
  summary: '寻找消费品牌项目',
  roleKey: 'visual_designer',
  status: 'PUBLISHED',
  contentSafetyStatus: 'APPROVED',
  version: 3,
  owner: {
    userId: USER_ID,
    nickname: '林然',
    branchId: BRANCH_ID,
    branchName: '深圳分会',
    cityName: '深圳',
  },
  publishedAt: '2030-01-01T00:00:00.000Z',
  archivedAt: null,
  updatedAt: '2030-01-02T00:00:00.000Z',
}

const cardDetail: AdminUserContentDetail = {
  id: CONTENT_ID,
  kind: 'COOPERATION_CARD',
  status: 'PUBLISHED',
  contentSafetyStatus: 'APPROVED',
  version: 3,
  owner: listItem.owner,
  publishedAt: listItem.publishedAt,
  archivedAt: null,
  updatedAt: listItem.updatedAt,
  moderationHistory: [],
  roleKey: 'visual_designer',
  positioning: '品牌视觉合作',
  targetSummary: '寻找消费品牌项目',
  roleFields: { visual_types: ['品牌视觉'], portfolio_summary: '消费品牌案例', target: '服务 5 个品牌' },
  abilityScores: { resource: 3, business: 2, capital: 1, strategy: 4, design: 5, delivery: 4 },
}

describe('MIP admin user content client contract', () => {
  it('accepts all six demo cooperation cards and three demo cases through the strict DTO', () => {
    const seed = JSON.parse(read('database/mysql/mip/seed.demo.json')) as DemoSeed
    const users = new Map(seed.users.map(user => [user.id, user]))
    const branches = new Map(seed.branches.map(branch => [branch.id, branch]))
    const tags = new Map(seed.tags.map(tag => [tag.id, tag.label]))
    const owner = (ownerUserId: string) => {
      const user = users.get(ownerUserId)
      const branch = user ? branches.get(user.branchId) : undefined
      if (!user || !branch) {
        throw new Error(`Incomplete demo owner: ${ownerUserId}`)
      }
      return {
        userId: user.id,
        nickname: user.nickname,
        branchId: branch.id,
        branchName: branch.name,
        cityName: branch.cityName,
      }
    }

    expect(seed.cooperationCards).toHaveLength(6)
    expect(seed.superCases).toHaveLength(3)
    const details = [
      ...seed.cooperationCards.map(card => ({
        id: card.id,
        kind: 'COOPERATION_CARD' as const,
        status: 'PUBLISHED' as const,
        contentSafetyStatus: 'APPROVED' as const,
        version: 1,
        owner: owner(card.ownerUserId),
        publishedAt: SEED_PUBLISHED_AT,
        archivedAt: null,
        updatedAt: SEED_PUBLISHED_AT,
        moderationHistory: [],
        roleKey: card.roleKey,
        positioning: card.positioning,
        targetSummary: card.targetSummary,
        roleFields: card.roleFields,
        abilityScores: {
          business_development: 3,
          resource_integration: 3,
          capital_operation: 3,
          strategy_planning: 3,
          visual_design: 3,
          delivery_management: 3,
        },
      })),
      ...seed.superCases.map(item => ({
        id: item.id,
        kind: 'SUPER_CASE' as const,
        status: 'PUBLISHED' as const,
        contentSafetyStatus: 'APPROVED' as const,
        version: 1,
        owner: owner(item.ownerUserId),
        publishedAt: SEED_PUBLISHED_AT,
        archivedAt: null,
        updatedAt: SEED_PUBLISHED_AT,
        moderationHistory: [],
        projectName: item.projectName,
        summary: item.summary,
        startedOn: item.startedOn,
        endedOn: item.endedOn,
        responsibility: item.responsibility,
        cityLabel: tags.get(item.cityTagId) || '',
        industryLabel: tags.get(item.industryTagId) || '',
        caseType: item.caseType,
        description: item.description,
        coverUrl: '',
        media: [],
      })),
    ]

    expect(details.map(detail => parseAdminUserContentDetail(detail))).toEqual(details)
    expect(parseAdminUserContentPage({
      items: details.map(detail => ({
        id: detail.id,
        kind: detail.kind,
        title: detail.kind === 'COOPERATION_CARD' ? detail.positioning : detail.projectName,
        summary: detail.kind === 'COOPERATION_CARD' ? detail.targetSummary : detail.summary,
        roleKey: detail.kind === 'COOPERATION_CARD' ? detail.roleKey : null,
        status: detail.status,
        contentSafetyStatus: detail.contentSafetyStatus,
        version: detail.version,
        owner: detail.owner,
        publishedAt: detail.publishedAt,
        archivedAt: detail.archivedAt,
        updatedAt: detail.updatedAt,
      })),
      nextCursor: null,
    }).items).toHaveLength(9)
  })

  it('uses neutral operations and validates the version transition', async () => {
    const requests: unknown[] = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request))
        if (request.action.endsWith('.list')) {
          return { items: [listItem], nextCursor: null } as never
        }
        if (request.action.endsWith('.get')) {
          return cardDetail as never
        }
        return {
          id: CONTENT_ID,
          kind: 'COOPERATION_CARD',
          status: 'UNPUBLISHED',
          version: 4,
        } as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.listUserContent({ kind: 'COOPERATION_CARD', status: 'PUBLISHED' })
    await gateway.getUserContent('COOPERATION_CARD', CONTENT_ID)
    await gateway.unpublishUserContent({
      kind: 'COOPERATION_CARD',
      contentId: CONTENT_ID,
      expectedVersion: 3,
      reason: '信息已经失效',
    })

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.userContent.list',
        input: { kind: 'COOPERATION_CARD', status: 'PUBLISHED' },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.userContent.get',
        input: { kind: 'COOPERATION_CARD', contentId: CONTENT_ID },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.userContent.unpublish',
        input: {
          kind: 'COOPERATION_CARD',
          contentId: CONTENT_ID,
          expectedVersion: 3,
          reason: '信息已经失效',
        },
      },
    ])
  })

  it('fails closed on extra, missing, cross-kind, and malformed fields', () => {
    expect(parseAdminUserContentPage({ items: [listItem], nextCursor: null })).toEqual({
      items: [listItem],
      nextCursor: null,
    })
    expect(parseAdminUserContentDetail(cardDetail)).toEqual(cardDetail)

    expect(() => parseAdminUserContentPage({
      items: [{ ...listItem, openId: 'must-not-pass' }],
      nextCursor: null,
    })).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseAdminUserContentDetail({
      ...cardDetail,
      roleFields: { visual_types: [] },
    })).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseAdminUserContentDetail({
      ...cardDetail,
      kind: 'SUPER_CASE',
    })).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
  })

  it('caches reads and invalidates list, detail, users, and audit after success only', async () => {
    const spies = {
      listUserContent: vi.fn<MipAdminGateway['listUserContent']>(async () => ({
        items: [listItem],
        nextCursor: null,
      })),
      getUserContent: vi.fn<MipAdminGateway['getUserContent']>(async () => cardDetail),
      unpublishUserContent: vi.fn<MipAdminGateway['unpublishUserContent']>(async () => ({
        id: CONTENT_ID,
        kind: 'COOPERATION_CARD',
        status: 'UNPUBLISHED',
        version: 4,
      })),
    }
    const module = createMipAdminModule(spies as unknown as MipAdminGateway)
    const filter = { kind: 'COOPERATION_CARD' as const }
    await module.userContent.list(filter)
    await module.userContent.list(filter)
    await module.userContent.get('COOPERATION_CARD', CONTENT_ID)
    await module.userContent.get('COOPERATION_CARD', CONTENT_ID)
    expect(spies.listUserContent).toHaveBeenCalledTimes(1)
    expect(spies.getUserContent).toHaveBeenCalledTimes(1)

    await module.userContent.unpublish({
      kind: 'COOPERATION_CARD',
      contentId: CONTENT_ID,
      expectedVersion: 3,
      reason: '信息失效',
    })
    await module.userContent.list(filter)
    await module.userContent.get('COOPERATION_CARD', CONTENT_ID)
    expect(spies.listUserContent).toHaveBeenCalledTimes(2)
    expect(spies.getUserContent).toHaveBeenCalledTimes(2)

    const failure = new Error('CONFLICT')
    spies.unpublishUserContent.mockRejectedValueOnce(failure)
    await expect(module.userContent.unpublish({
      kind: 'COOPERATION_CARD',
      contentId: CONTENT_ID,
      expectedVersion: 4,
      reason: '再次处理',
    })).rejects.toBe(failure)
    await module.userContent.list(filter)
    expect(spies.listUserContent).toHaveBeenCalledTimes(2)
  })
})

describe('MIP admin user content route and responsive UI', () => {
  it('registers a reachable workspace route and contextual profile links', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const project = JSON.parse(read('config/project.json')) as { routes: Array<{ pathName: string }> }
    const runtime = JSON.parse(read('config/runtime-pages.json')) as {
      routeCount: number
      routes: Array<{ path: string, states: string[] }>
    }
    const admin = app.subPackages.find(item => item.root === 'packages/admin')
    const route = 'packages/admin/user-content/index'
    expect(admin?.pages).toContain('user-content/index')
    expect(project.routes.some(item => item.pathName === route)).toBe(true)
    expect(runtime.routeCount).toBe(101)
    expect(runtime.routes.find(item => item.path === route)?.states).toEqual([
      'loading',
      'ready',
      'empty',
      'error',
      'forbidden',
      'conflict',
    ])
    expect(activeAdminWorkspaceItemKey(route)).toBe('user-content')
    expect(buildAdminWorkspaceNavigation([{
      capability: 'userContent.moderate',
      scopeType: 'BRANCH',
      scopeId: BRANCH_ID,
    }], route).flatMap(group => group.items).map(item => item.key)).toContain('user-content')

    const profile = read('src/packages/admin/profiles/index.ts')
    const profileView = read('src/packages/admin/profiles/index.wxml')
    expect(profile).toContain('/packages/admin/user-content/index?ownerUserId=')
    expect(profile).toContain('&kind=SUPER_CASE&contentId=')
    expect(profile).toContain('/packages/member/mip-cases/detail/index?id=')
    expect(profileView).toContain('data-kind="COOPERATION_CARD" bind:tap="openUserContent"')
    expect(profileView).toContain('data-kind="SUPER_CASE" bind:tap="openUserContent"')
    expect(profileView).toContain('wx:if="{{detail.relatedRecords.superCases.length}}"')
  })

  it('uses the shared 375 bottom panel and a 960 desktop grid without exposing publish or delete actions', () => {
    const template = read('src/packages/admin/user-content/index.wxml')
    const script = read('src/packages/admin/user-content/index.ts')
    const config = JSON.parse(read('src/packages/admin/user-content/index.json')) as {
      usingComponents: Record<string, string>
    }
    const stylesheet = postcss.parse(read('src/packages/admin/user-content/index.wxss'))
    const desktop = stylesheet.nodes.find(node => (
      node.type === 'atrule' && node.name === 'media' && node.params === '(min-width: 960px)'
    ))

    expect(config.usingComponents['mip-admin-responsive-panel'])
      .toBe('/packages/admin/components/responsive-panel/index')
    expect(template).toContain('<mip-admin-responsive-panel visible="{{detailOpen}}"')
    for (const state of ['loading', 'error', 'forbidden']) {
      expect(template).toContain(`detailState === '${state}`)
    }
    expect(template).toContain('bind:tap="unpublish"')
    expect(template).toContain('下架原因会保存在审计记录中')
    expect(script).toContain('hasCapability(session.capabilities, \'userContent.moderate\')')
    expect(script).toContain('expectedVersion: detail.version')
    expect(script).toMatch(/const seq = this\.listRequestSeq \+ 1[\s\S]+seq !== this\.listRequestSeq/)
    expect(script).toMatch(/const seq = this\.detailRequestSeq \+ 1[\s\S]+seq !== this\.detailRequestSeq/)
    expect(script).toMatch(/closeDetail\(\)[\s\S]+this\.detailRequestSeq \+= 1/)
    expect(script).not.toMatch(/\b(?:publish|create|delete|restore)UserContent\b/)
    expect(desktop).toBeDefined()
    expect(desktop?.toString()).toContain('.admin-user-content-grid')
    expect(desktop?.toString()).toContain('repeat(2, minmax(0, 1fr))')
  })
})
