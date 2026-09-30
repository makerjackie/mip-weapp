import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadAdminReadPage, type AdminRequest } from './admin-read-pages.ts'
import { knowledgeEditorValues } from './knowledge-editor.ts'
import { createGameMutationDefinition, loadGameMemberSelection } from './admin-game-management.ts'

const require = createRequire(import.meta.url)
const { createKnowledgeAdminService } = require('../../../cloudfunctions/mip-admin-api/domain/knowledge.js')
const user = { id: 'user', status: 'ACTIVE', primary_branch_id: 'branch', nickname: '运营', phone_verified_at: new Date(), agreement_0_accepted: 1, agreement_1_accepted: 1 }

it('retains the serialized knowledge detail category, source, multiline content and false comment setting', async () => {
  const contentId = '10000000-0000-4000-8000-000000000001'
  const service = createKnowledgeAdminService({
    one: async (sql: string) => sql.includes('FROM mip_knowledge_contents') ? { id: contentId, category_id: 'category', category_name: '运营', source_id: 'source', source_name: '手工整理', version: 8, title: '运营手册', summary: '介绍', content_type: 'ARTICLE', body_text: '第一行\n第二行', comments_enabled: 0, moderation_mode: 'MANUAL', access_type: 'FREE', status: 'DRAFT' } : user,
    query: async () => [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }],
  })
  const detail = JSON.parse(JSON.stringify(await service.getKnowledgeAdminContent({ appId: 'app', identityKey: 'identity' }, { contentId })))
  const values = knowledgeEditorValues(detail)
  assert.equal(values.categoryId, 'category')
  assert.equal(values.sourceId, 'source')
  assert.equal(values.commentsEnabled, false)
  assert.equal(values.bodyText, '第一行\n第二行')
  assert.equal(values.expectedVersion, 8)
  assert.equal(knowledgeEditorValues({ ...detail, status: 'PUBLISHED' })._canSave, false)
  assert.throws(() => knowledgeEditorValues({ ...detail, category: null }))
})

it('preserves nonempty activity rows when optional catalog and policy requests fail', async () => {
  const request: AdminRequest = async <T>(action: string) => {
    if (action !== 'mip.admin.events.list') throw new Error('附加目录暂不可用')
    return { items: [{ id: 'event', title: '活动正文', tags: [{ name: '早会' }], priceCents: 0, accessType: 'FREE', startsAt: '2030-01-01T01:00:00Z' }], nextCursor: 'next-events' } as T
  }
  const page = await loadAdminReadPage('events', { query: '', status: '', cursor: null, limit: 20 }, request, { hasCapability: () => true })
  assert.equal(page.sections[0].rows[0].title, '活动正文')
  assert.equal(page.sections[0].rows[0].tags, '早会')
  assert.equal(page.nextCursor, 'next-events')
  assert.equal(page.sections[1].rows.length, 0)
  assert.equal(page.sections[1].error, '附加目录暂不可用')
})

it('uses the user-content cursor independently and trusts the server filtering of owner names', async () => {
  const calls: unknown[] = []
  const request: AdminRequest = async <T>(action: string, input = {}) => {
    assert.equal(action, 'mip.admin.userContent.list'); calls.push(input)
    return { items: [{ id: 'case', version: 3, title: '项目展示', kind: 'SUPER_CASE', owner: { nickname: '匹配发布人' }, status: 'PUBLISHED' }], nextCursor: 'content-next' } as T
  }
  const page = await loadAdminReadPage('opportunities', { query: '匹配发布人', status: '', cursor: 'content-page-2', limit: 20, filters: { section: 'content' } }, request)
  assert.deepEqual(calls, [{ query: '匹配发布人', status: 'ALL', limit: 20, cursor: 'content-page-2' }])
  assert.equal(page.sections.length, 1)
  assert.equal(page.sections[0].rows[0].detailId, 'SUPER_CASE:case')
  assert.equal(page.nextCursor, 'content-next')
})

it('loads all member pages and preselects the full existing roster and captain by name', async () => {
  const teamId = '10000000-0000-4000-8000-000000000001', seasonId = '20000000-0000-4000-8000-000000000001'
  const calls: unknown[] = []
  const request: AdminRequest = async <T>(_action: string, input = {}) => {
    calls.push(input)
    return (calls.length === 1 ? { items: [{ memberRef: 'member-a', nickname: '甲', teamId, role: 'CAPTAIN' }], hasMore: true, nextCursor: 'page2' } : { items: [{ memberRef: 'member-b', nickname: '乙', teamId, role: 'MEMBER' }], hasMore: false }) as T
  }
  const source = await loadGameMemberSelection({ team: { id: teamId, seasonId, status: 'ACTIVE', version: 4, memberCount: 2 } }, request)
  const form = createGameMutationDefinition('mip.admin.game.teams.members.replace', teamId, source)
  assert.deepEqual(form?.values.memberRefs, ['member-a', 'member-b'])
  assert.equal(form?.values.captainRef, 'member-a')
  assert.deepEqual(form?.fields[0].options, [{ value: 'member-a', label: '甲' }, { value: 'member-b', label: '乙' }])
  assert.deepEqual(calls[1], { seasonId, teamId, limit: 100, cursor: 'page2' })
})

it('refuses a partial current roster rather than silently removing missing members', async () => {
  const request: AdminRequest = async <T>() => ({ items: [], hasMore: false }) as T
  await assert.rejects(loadGameMemberSelection({ team: { id: '10000000-0000-4000-8000-000000000001', seasonId: '20000000-0000-4000-8000-000000000001', status: 'ACTIVE', memberCount: 1 } }, request), /本次不会替换名单/)
})
