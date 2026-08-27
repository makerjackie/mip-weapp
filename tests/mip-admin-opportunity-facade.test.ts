import type { MipOpportunityAdmin } from '../src/modules/mip-admin/opportunity-admin'
import type {
  AdminMatchingSettings,
  AdminOpportunityCommentSettings,
  AdminOpportunityDetail,
  AdminOpportunityEditorOptions,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'
import { opportunityActionFailure } from '../src/packages/admin/opportunities/action-state'

const matchingSettings: AdminMatchingSettings = {
  scopeKey: 'branch-a',
  scopeType: 'BRANCH',
  scopeId: 'branch-a',
  talentMinScore: 35,
  projectMinScore: 30,
  maximumCandidates: 100,
  externalProviderEnabled: false,
  version: 2,
  updatedAt: null,
}

const commentSettings: AdminOpportunityCommentSettings = {
  commentsEnabled: true,
  reviewsEnabled: true,
  callsEnabled: true,
  moderationMode: 'REVIEW',
  version: 2,
}

function createHarness() {
  const spies = {
    listOpportunities: vi.fn<MipAdminGateway['listOpportunities']>(async () => ({ items: [], nextCursor: null })),
    getOpportunity: vi.fn<MipAdminGateway['getOpportunity']>(async opportunityId => ({
      id: opportunityId,
      history: [],
      teamMembers: [],
    } as AdminOpportunityDetail)),
    getOpportunityEditorOptions: vi.fn<MipAdminGateway['getOpportunityEditorOptions']>(async () => ({
      owners: [],
      branches: [],
      cities: [],
      tags: [],
      roles: [],
    } satisfies AdminOpportunityEditorOptions)),
    getOpportunityCommentAdminState: vi.fn<MipAdminGateway['getOpportunityCommentAdminState']>(async () => ({
      settings: commentSettings,
      comments: [],
      reports: [],
    })),
    getMatchingAdminState: vi.fn<MipAdminGateway['getMatchingAdminState']>(async () => ({
      settings: matchingSettings,
      requests: [],
    })),
    saveOpportunity: vi.fn<MipAdminGateway['saveOpportunity']>(async () => ({ id: 'opportunity-a', status: 'DRAFT', version: 2 })),
    publishOpportunity: vi.fn<MipAdminGateway['publishOpportunity']>(async () => ({ id: 'opportunity-a', status: 'PUBLISHED', version: 2 })),
    endOpportunity: vi.fn<MipAdminGateway['endOpportunity']>(async () => ({ id: 'opportunity-a', status: 'ENDED', version: 2 })),
    unpublishOpportunity: vi.fn<MipAdminGateway['unpublishOpportunity']>(async () => ({ id: 'opportunity-a', status: 'UNPUBLISHED', version: 2 })),
    archiveOpportunity: vi.fn<MipAdminGateway['archiveOpportunity']>(async () => ({
      id: 'opportunity-a',
      status: 'ARCHIVED',
      version: 2,
      archivedAt: '2026-08-25T00:00:00.000Z',
    })),
    saveOpportunityCommentSettings: vi.fn<MipAdminGateway['saveOpportunityCommentSettings']>(async () => commentSettings),
    moderateOpportunityComment: vi.fn<MipAdminGateway['moderateOpportunityComment']>(async () => ({
      id: 'comment-a',
      status: 'HIDDEN',
      version: 2,
    })),
    closeOpportunityCommentReport: vi.fn<MipAdminGateway['closeOpportunityCommentReport']>(async () => ({
      id: 'report-a',
      status: 'RESOLVED',
      version: 2,
    })),
    saveMatchingSettings: vi.fn<MipAdminGateway['saveMatchingSettings']>(async () => matchingSettings),
    recalculateOpportunityMatching: vi.fn<MipAdminGateway['recalculateOpportunityMatching']>(async () => ({
      id: 'request-a',
      resultCount: 3,
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const saveInput = {
  opportunityId: 'opportunity-a',
  expectedVersion: 1,
  draft: { title: '示例机会' },
}
const publishInput = { opportunityId: 'opportunity-a', expectedVersion: 1 }
const endInput = { opportunityId: 'opportunity-a', expectedVersion: 1 }
const unpublishInput = { opportunityId: 'opportunity-a', expectedVersion: 1, reason: '内容调整' }
const archiveInput = { opportunityId: 'opportunity-a', expectedVersion: 1, reason: '停止维护' }
const saveCommentSettingsInput = {
  opportunityId: 'opportunity-a',
  expectedVersion: 1,
  settings: {
    commentsEnabled: true,
    reviewsEnabled: true,
    callsEnabled: true,
    moderationMode: 'REVIEW' as const,
  },
}
const moderateCommentInput = {
  opportunityId: 'opportunity-a',
  commentId: 'comment-a',
  expectedVersion: 1,
  action: 'HIDE' as const,
  reason: '内容不符合要求',
}
const closeCommentReportInput = {
  opportunityId: 'opportunity-a',
  reportId: 'report-a',
  expectedVersion: 1,
  decision: 'RESOLVED' as const,
  reason: '确认违规',
}
const saveMatchingSettingsInput = {
  branchId: 'branch-a',
  expectedVersion: 1,
  settings: {
    talentMinScore: 35,
    projectMinScore: 30,
    maximumCandidates: 100,
    externalProviderEnabled: false,
  },
}
const recalculateInput = { opportunityId: 'opportunity-a', idempotencyKey: 'matching-a' }

function mutationCases(): Array<[string, (opportunities: MipOpportunityAdmin) => Promise<unknown>]> {
  return [
    ['save', opportunities => opportunities.save(saveInput)],
    ['publish', opportunities => opportunities.publish(publishInput)],
    ['end', opportunities => opportunities.end(endInput)],
    ['unpublish', opportunities => opportunities.unpublish(unpublishInput)],
    ['archive', opportunities => opportunities.archive(archiveInput)],
    ['saveCommentSettings', opportunities => opportunities.saveCommentSettings(saveCommentSettingsInput)],
    ['moderateComment', opportunities => opportunities.moderateComment(moderateCommentInput)],
    ['closeCommentReport', opportunities => opportunities.closeCommentReport(closeCommentReportInput)],
    ['saveMatchingSettings', opportunities => opportunities.saveMatchingSettings(saveMatchingSettingsInput)],
    ['recalculateMatching', opportunities => opportunities.recalculateMatching(recalculateInput)],
  ]
}

async function warmOpportunityQueries(opportunities: MipOpportunityAdmin) {
  await Promise.all([
    opportunities.list({ filters: { status: 'PUBLISHED' } }),
    opportunities.get('opportunity-a'),
    opportunities.getCommentState('opportunity-a'),
    opportunities.getMatchingState('branch-a'),
  ])
}

describe('MIP admin opportunity facade', () => {
  it('keeps query inputs and results behind the typed facade', async () => {
    const { module, spies } = createHarness()
    const listInput = { filters: { status: 'PUBLISHED' }, cursor: 'cursor-a' }

    await expect(module.opportunities.list(listInput)).resolves.toEqual({ items: [], nextCursor: null })
    await expect(module.opportunities.get('opportunity-a')).resolves.toMatchObject({ id: 'opportunity-a' })
    await expect(module.opportunities.getEditorOptions()).resolves.toEqual({
      owners: [],
      branches: [],
      cities: [],
      tags: [],
      roles: [],
    })
    await expect(module.opportunities.getCommentState('opportunity-a')).resolves.toMatchObject({
      settings: commentSettings,
    })
    await expect(module.opportunities.getMatchingState('branch-a')).resolves.toMatchObject({
      settings: matchingSettings,
    })

    expect(spies.listOpportunities).toHaveBeenCalledWith(listInput)
    expect(spies.getOpportunity).toHaveBeenCalledWith('opportunity-a')
    expect(spies.getOpportunityEditorOptions).toHaveBeenCalledWith()
    expect(spies.getOpportunityCommentAdminState).toHaveBeenCalledWith('opportunity-a')
    expect(spies.getMatchingAdminState).toHaveBeenCalledWith('branch-a')
  })

  it('passes every mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.opportunities.save(saveInput)
    await module.opportunities.publish(publishInput)
    await module.opportunities.end(endInput)
    await module.opportunities.unpublish(unpublishInput)
    await module.opportunities.archive(archiveInput)
    await module.opportunities.saveCommentSettings(saveCommentSettingsInput)
    await module.opportunities.moderateComment(moderateCommentInput)
    await module.opportunities.closeCommentReport(closeCommentReportInput)
    await module.opportunities.saveMatchingSettings(saveMatchingSettingsInput)
    await module.opportunities.recalculateMatching(recalculateInput)

    expect(spies.saveOpportunity).toHaveBeenCalledWith(saveInput)
    expect(spies.publishOpportunity).toHaveBeenCalledWith(publishInput)
    expect(spies.endOpportunity).toHaveBeenCalledWith(endInput)
    expect(spies.unpublishOpportunity).toHaveBeenCalledWith(unpublishInput)
    expect(spies.archiveOpportunity).toHaveBeenCalledWith(archiveInput)
    expect(spies.saveOpportunityCommentSettings).toHaveBeenCalledWith(saveCommentSettingsInput)
    expect(spies.moderateOpportunityComment).toHaveBeenCalledWith(moderateCommentInput)
    expect(spies.closeOpportunityCommentReport).toHaveBeenCalledWith(closeCommentReportInput)
    expect(spies.saveMatchingSettings).toHaveBeenCalledWith(saveMatchingSettingsInput)
    expect(spies.recalculateOpportunityMatching).toHaveBeenCalledWith(recalculateInput)
  })

  for (const [name, execute] of mutationCases()) {
    it(`invalidates list, detail, comments, and matching caches after ${name}`, async () => {
      const { module, spies } = createHarness()
      await warmOpportunityQueries(module.opportunities)
      await warmOpportunityQueries(module.opportunities)

      await execute(module.opportunities)
      await warmOpportunityQueries(module.opportunities)

      expect(spies.listOpportunities).toHaveBeenCalledTimes(2)
      expect(spies.getOpportunity).toHaveBeenCalledTimes(2)
      expect(spies.getOpportunityCommentAdminState).toHaveBeenCalledTimes(2)
      expect(spies.getMatchingAdminState).toHaveBeenCalledTimes(2)
    })
  }

  it('preserves failed mutations and keeps successful cached reads intact', async () => {
    const { module, spies } = createHarness()
    const conflict = new MipAdminError('CONFLICT', '机会已被其他管理员更新')
    spies.publishOpportunity.mockRejectedValueOnce(conflict)
    await warmOpportunityQueries(module.opportunities)

    await expect(module.opportunities.publish(publishInput)).rejects.toBe(conflict)
    await warmOpportunityQueries(module.opportunities)

    expect(spies.listOpportunities).toHaveBeenCalledTimes(1)
    expect(spies.getOpportunity).toHaveBeenCalledTimes(1)
    expect(spies.getOpportunityCommentAdminState).toHaveBeenCalledTimes(1)
    expect(spies.getMatchingAdminState).toHaveBeenCalledTimes(1)
    expect(opportunityActionFailure(conflict, '机会发布失败')).toEqual({
      message: '机会已被其他管理员更新',
    })
  })

  it('passes permission failures through to page state without replacement', async () => {
    const { module, spies } = createHarness()
    const forbidden = new MipAdminError('FORBIDDEN', '当前账号不能归档机会')
    spies.archiveOpportunity.mockRejectedValueOnce(forbidden)

    const error = await module.opportunities.archive(archiveInput).catch(caught => caught)
    expect(error).toBe(forbidden)
    expect(opportunityActionFailure(error, '机会归档失败')).toEqual({
      message: '当前账号不能归档机会',
    })
  })

  it('keeps all four opportunity pages behind the module facade', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const pages = [
      'src/packages/admin/opportunities/index.ts',
      'src/packages/admin/opportunity-editor/index.ts',
      'src/packages/admin/opportunity-detail/index.ts',
      'src/packages/admin/opportunity-matching/index.ts',
    ]
    const sources: string[] = []
    for (const page of pages) {
      const source = fs.readFileSync(path.join(root, page), 'utf8')
      sources.push(source)
      expect(source).toContain('mipAdminModule.opportunities.')
      expect(source).not.toContain('mipAdminModule.gateway')
      expect(source).not.toContain('mipAdminModule.mutate')
    }
    const mutationCalls = [...sources.join('\n').matchAll(
      /mipAdminModule\.opportunities\.(save|publish|end|unpublish|archive|saveCommentSettings|moderateComment|closeCommentReport|saveMatchingSettings|recalculateMatching)\(/g,
    )].map(match => match[1])
    expect(mutationCalls.sort()).toEqual([
      'archive',
      'archive',
      'closeCommentReport',
      'end',
      'moderateComment',
      'publish',
      'recalculateMatching',
      'save',
      'saveCommentSettings',
      'saveMatchingSettings',
      'unpublish',
      'unpublish',
    ].sort())
    const listTemplate = fs.readFileSync(
      path.join(root, 'src/packages/admin/opportunities/index.wxml'),
      'utf8',
    )
    expect(listTemplate).toContain('item.status === \'DRAFT\' || item.status === \'PUBLISHED\'')
    expect(listTemplate).toContain('item.status === \'PUBLISHED\'')
    expect(listTemplate).not.toContain('item.status === \'PUBLISHED\' || item.status === \'ENDED\'')
  })
})
