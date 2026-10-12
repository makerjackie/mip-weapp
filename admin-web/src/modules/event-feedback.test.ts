import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { feedbackFields } from './event-feedback.ts'
import { loadAdminDetail } from './admin-details.ts'
const require = createRequire(import.meta.url)
const { createAdminEventRuntimeRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/event-runtime.js')

it('renders the actual non-empty repository feedback serialization including private consent and multiline resources', async () => {
  const answers = { recommendation: 'NOT_RECOMMEND', roleKeys: ['connector', 'delivery_lead'], joinIntent: 'LEARN_MORE', explorationMethods: ['ATTEND_EVENT', 'COMMUNITY_CHAT'], rosterConsent: 'PRIVATE' }
  const repository = createAdminEventRuntimeRepository({ query: async () => [{ id: 'feedback-a', nickname: '林', rating: 4, body: '客户资源\n引荐要求', answers_json: JSON.stringify(answers), version: 2, submitted_at: '2030-01-01T01:00:00Z', updated_at: '2030-01-01T02:00:00Z' }] }, { repositorySupport: { json: JSON.parse, iso: (value: string) => new Date(value).toISOString() } })
  const page = JSON.parse(JSON.stringify(await repository.listEventFeedbacks('wx-app', 'event-a', { limit: 20 })))
  const detail = await loadAdminDetail('events', 'event-a', async action => {
    if (action === 'mip.admin.events.get') return { id: 'event-a', title: '交流活动', status: 'ENDED' } as never
    if (action === 'mip.admin.events.feedbacks.list') return page
    throw new Error('OPTIONAL_READ_FAILED')
  }, { includeEventFeedback: true })
  const row = detail.sections.find(section => section.title === '活动反馈明细')!.rows![0]
  assert.equal(row.wouldRecommend, '不愿意')
  assert.equal(row.capabilityRoles, '皮条客、老保姆')
  assert.equal(row.resources, '客户资源\n引荐要求')
  assert.equal(row.discoverySource, '参与活动、社群交流')
  assert.equal(row.rosterConsent, '仅私密保存')
  assert.equal(detail.title, '交流活动')
  assert.match(detail.sections.find(section => section.title === '报名与参与人')!.error!, /加载失败/)
})
it('does not invent feedback answers for legacy rows', () => {
  assert.deepEqual(feedbackFields({ body: '历史全文' }), { wouldRecommend: '—', capabilityRoles: '—', resources: '历史全文', joinMipIntent: '—', discoverySource: '—', rosterConsent: '—' })
})
it('rejects a non-empty feedback response missing the server display contract', () => {
  assert.throws(() => feedbackFields({ answers: { recommendation: 'RECOMMEND' } }), /合同不完整/)
})
