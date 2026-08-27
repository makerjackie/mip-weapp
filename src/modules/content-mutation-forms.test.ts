import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTENT_MUTATION_ACTIONS,
  createContentMutationIntent,
  getContentMutationForm,
  listContentMutationForms,
  validateContentMutation,
} from './content-mutation-forms.ts'

const uuid = '11111111-1111-4111-8111-111111111111'
const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`

describe('content mutation form manifest', () => {
  it('covers the reviewed P0 actions with an explicit capability and input key list', () => {
    const forms = listContentMutationForms()
    assert.equal(forms.length, CONTENT_MUTATION_ACTIONS.length)
    assert.deepEqual(new Set(forms.map(form => form.action)).size, forms.length)
    assert.deepEqual(getContentMutationForm('mip.admin.announcements.pin'), {
      action: 'mip.admin.announcements.pin',
      capability: 'announcements.manage',
      resource: '公告',
      inputKeys: ['announcementId', 'expectedVersion', 'pinned'],
      idempotencyRequired: false,
      fields: [
        { key: 'announcementId', label: '公告', kind: 'id', required: true },
        { key: 'expectedVersion', label: '记录版本', kind: 'integer', required: true },
        { key: 'pinned', label: '置顶', kind: 'checkbox', required: true },
      ],
    })
    for (const form of forms) {
      assert.ok(form.capability)
      assert.ok(form.inputKeys.length > 0)
      const fieldKinds = JSON.stringify(form.fields)
      assert.doesNotMatch(fieldKinds, /json/i)
    }
  })
})

describe('content mutation validators', () => {
  it('normalizes an announcement and enforces its target pair and dates', () => {
    const valid = validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'PLATFORM',
      title: ' 公告 ',
      summary: '摘要',
      body: '正文',
      targetType: 'EVENT',
      targetId: 'event-1',
      visibleFrom: '2030-01-01T00:00:00.000Z',
      visibleUntil: '2030-01-02T00:00:00.000Z',
    })
    assert.equal(valid.ok, true)
    if (valid.ok) assert.deepEqual(valid.input, {
      scopeType: 'PLATFORM', title: '公告', summary: '摘要', body: '正文', targetType: 'EVENT', targetId: 'event-1',
      visibleFrom: '2030-01-01T00:00:00.000Z', visibleUntil: '2030-01-02T00:00:00.000Z',
    })
    assert.equal(validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'PLATFORM', title: '公告', summary: '摘要', body: '正文', targetType: 'EVENT', visibleFrom: '2030-01-01T00:00:00Z',
    }).ok, false)
  })

  it('requires explicit, signed recipient refs and UTC scheduling', () => {
    const campaign = validateContentMutation('mip.admin.messageCampaigns.save', {
      scopeType: 'BRANCH', branchId: 'branch-1', audienceType: 'EXPLICIT', recipientRefs: [profileRef],
      name: '活动', title: '标题', body: '正文',
    })
    assert.equal(campaign.ok, true)
    const schedule = validateContentMutation('mip.admin.messageCampaigns.schedule', {
      campaignId: 'campaign-1', expectedVersion: 2, scheduledFor: '2030-01-01T01:02:03.000Z', idempotencyKey: 'schedule-key-20300101',
    })
    assert.equal(schedule.ok, true)
    assert.equal(validateContentMutation('mip.admin.messageCampaigns.schedule', {
      campaignId: 'campaign-1', expectedVersion: 2, scheduledFor: '2030-01-01T01:02:03+08:00', idempotencyKey: 'schedule-key-20300101',
    }).ok, false)
  })

  it('keeps structured user content and opportunity fields typed', () => {
    const card = validateContentMutation('mip.admin.userContent.save', {
      kind: 'COOPERATION_CARD', ownerUserId: 'user-1', draft: {
        kind: 'COOPERATION_CARD', roleKey: 'connector', positioning: '定位', targetSummary: '目标',
        roleFields: { circles: ['社群'], resources: '资源', target: '引荐' },
        abilityScores: { business_development: 1, resource_integration: 2, capital_operation: 3, strategy_planning: 4, visual_design: 5, delivery_management: 0 },
        status: 'DRAFT',
      },
    })
    assert.equal(card.ok, true)
    const opportunity = validateContentMutation('mip.admin.opportunities.save', {
      draft: {
        ownerUserId: 'user-1', scopeType: 'PLATFORM', title: '机会', valueSummary: '价值', targetSummary: '目标', roleKeys: ['connector'], tagIds: [],
        commercialTerms: { minAmountCents: 100, maxAmountCents: 200, locations: [{ type: 'REMOTE' }] },
      },
    })
    assert.equal(opportunity.ok, true)
  })

  it('mirrors knowledge, badge, and growth server constraints', () => {
    assert.equal(validateContentMutation('mip.admin.knowledge.contents.save', {
      categoryId: uuid, contentType: 'ARTICLE', title: '文章', summary: '摘要', bodyText: '正文', accessType: 'FREE', commentsEnabled: true, moderationMode: 'AUTO',
    }).ok, true)
    assert.equal(validateContentMutation('mip.admin.knowledge.contents.review', {
      contentId: uuid, expectedVersion: 1, decision: 'REJECT',
    }).ok, false)
    assert.equal(validateContentMutation('mip.admin.growth.adjust', {
      userId: 'user-1', metric: 'COIN', deltaValue: -3, reason: '冲正', idempotencyKey: 'growth-key-20300101',
    }).ok, true)
    assert.equal(validateContentMutation('mip.admin.badges.revoke', {
      awardId: 'award-1', expectedVersion: 0, reason: '撤销',
    }).ok, false)
  })

  it('creates a transport-ready idempotent intent without accepting arbitrary JSON', () => {
    const intent = createContentMutationIntent('mip.admin.growth.adjust', {
      userId: 'user-1', metric: 'EXPERIENCE', deltaValue: 5, reason: '补录',
    }, 'growth-key-20300101')
    assert.equal(intent.action, 'mip.admin.growth.adjust')
    assert.equal(intent.idempotencyKey, 'growth-key-20300101')
    assert.equal(intent.input.idempotencyKey, 'growth-key-20300101')
    assert.throws(() => createContentMutationIntent('mip.admin.growth.adjust', {
      userId: 'user-1', metric: 'EXPERIENCE', deltaValue: 5, reason: '补录',
    }, 'bad key'), /幂等标识/)
    const report = createContentMutationIntent('mip.admin.communityReports.claim', {
      reportId: 'report-1', expectedVersion: 2, reason: '已核实',
    })
    assert.equal(report.idempotencyKey, undefined)
    assert.deepEqual(report.input, { reportId: 'report-1', expectedVersion: 2, reason: '已核实' })
  })
})
