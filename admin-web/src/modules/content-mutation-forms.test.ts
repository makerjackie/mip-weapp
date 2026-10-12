import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTENT_MUTATION_ACTIONS,
  getContentMutationForm,
  validateContentMutation,
} from './content-mutation-forms.ts'
import { label } from './admin-read-formatters.ts'

const uuid = '11111111-1111-4111-8111-111111111111'
const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`

describe('content mutation form manifest', () => {
  it('covers the reviewed P0 actions with an explicit capability and input key list', () => {
    const forms = CONTENT_MUTATION_ACTIONS.map(action => getContentMutationForm(action))
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
      assert.ok(form.fields.every(field => !/json/i.test(field.kind)), '表单不能要求原始 JSON 输入')
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
})


it('keeps optional case fields explicit through JSON transport so a minimal draft passes the server shape', () => {
  const result = validateContentMutation('mip.admin.userContent.save', { kind: 'SUPER_CASE', ownerUserId: 'user-1', draft: { kind: 'SUPER_CASE', projectName: '项目', summary: '摘要', responsibility: '职责', description: '第一行\n第二行', status: 'DRAFT' } })
  assert.equal(result.ok, true)
  if (!result.ok) return
  const transported = JSON.parse(JSON.stringify(result.input))
  for (const key of ['startedOn', 'endedOn', 'caseType', 'cityTagId', 'industryTagId', 'coverAssetId']) assert.equal(transported.draft[key], null)
  assert.deepEqual(transported.draft.mediaAssetIds, [])
})

describe('R1 novice walkthrough fixes', () => {
  it('shows the recipient picker only for explicit audiences and marks it required there', () => {
    const fields = getContentMutationForm('mip.admin.messageCampaigns.save').fields
    const recipientRefs = fields.find(field => field.key === 'recipientRefs')
    assert.deepEqual(recipientRefs?.visibleWhen, { path: 'audienceType', value: 'EXPLICIT' })
    assert.equal(recipientRefs?.required, true)
    // ALL keeps working without recipients: nothing silently blocks the save.
    assert.equal(validateContentMutation('mip.admin.messageCampaigns.save', {
      scopeType: 'PLATFORM', audienceType: 'ALL', recipientRefs: [], name: '开学提醒', title: '标题', body: '正文',
    }).ok, true)
  })

  it('labels the announcement target type and knowledge moderation in plain Chinese', () => {
    // String options are localized by the shared renderer via label(); assert both layers.
    const targetField = getContentMutationForm('mip.admin.announcements.save').fields.find(field => field.key === 'targetType')
    assert.deepEqual(targetField?.options, ['EVENT', 'OPPORTUNITY'])
    assert.deepEqual((targetField?.options || []).map(option => label(option)), ['活动', '机会'])
    const moderation = getContentMutationForm('mip.admin.knowledge.contents.save').fields.find(field => field.key === 'moderationMode')
    assert.deepEqual((moderation?.options || []).map(option => typeof option === 'string' ? option : option.label), ['自动审核', '人工审核'])
  })

  it('guides empty knowledge catalogs to their maintenance pages', () => {
    const content = getContentMutationForm('mip.admin.knowledge.contents.save')
    const categoryId = content.fields.find(field => field.key === 'categoryId')
    assert.ok(categoryId?.optionsAction === 'mip.admin.knowledge.list' && (categoryId as { emptyHint?: string }).emptyHint?.includes('新建分类'))
    const schedule = getContentMutationForm('mip.admin.knowledge.schedules.save')
    const sourceId = schedule.fields.find(field => field.key === 'sourceId')
    assert.ok(sourceId?.optionsAction === 'mip.admin.knowledge.list' && (sourceId as { emptyHint?: string }).emptyHint?.includes('新建信息源'))
  })

  it('marks opportunity title and value summary as required like the server does', () => {
    const draft = getContentMutationForm('mip.admin.opportunities.save').fields.find(field => field.key === 'draft')
    const nested = draft?.fields || []
    assert.equal(nested.find(field => field.key === 'title')?.required, true)
    assert.equal(nested.find(field => field.key === 'valueSummary')?.required, true)
  })

  it('bounds ability score inputs to the 0-5 server range', () => {
    const draft = getContentMutationForm('mip.admin.userContent.save').fields.find(field => field.key === 'draft')
    const scores = (draft?.fields || []).find(field => field.key === 'abilityScores')
    for (const score of (scores?.fields || [])) {
      assert.equal(score.min, 0)
      assert.equal(score.max, 5)
    }
  })

  it('guides badge selection when the badge catalog is empty', () => {
    const badgeId = getContentMutationForm('mip.admin.badges.grant').fields.find(field => field.key === 'badgeId')
    assert.ok((badgeId as { emptyHint?: string }).emptyHint?.includes('成长与勋章'))
  })
})

describe('R2 novice walkthrough fixes', () => {
  it('keeps scope linkage safe: stale branch ids never block a platform save', () => {
    const platform = validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'PLATFORM', branchId: 'branch-stale', title: '公告', summary: '摘要', body: '正文', visibleFrom: '2030-01-01T00:00:00Z',
    })
    assert.equal(platform.ok, true)
    if (platform.ok) assert.equal('branchId' in platform.input, false)

    const missingBranch = validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'BRANCH', branchId: '', title: '公告', summary: '摘要', body: '正文', visibleFrom: '2030-01-01T00:00:00Z',
    })
    assert.equal(missingBranch.ok === false && missingBranch.errors.form, '请选择服务器')
  })

  it('marks the scope branch field as linked and conditionally required across content forms', () => {
    for (const action of ['mip.admin.announcements.save', 'mip.admin.messageCampaigns.save', 'mip.admin.messageTemplates.save', 'mip.admin.opportunities.save'] as const) {
      const form = getContentMutationForm(action)
      const flat = [...form.fields, ...(form.fields.find(field => field.key === 'draft')?.fields || [])]
      const branchId = flat.find(field => field.key === 'branchId')
      assert.deepEqual(branchId?.visibleWhen, { path: 'scopeType', value: 'BRANCH' }, action)
      assert.deepEqual(branchId?.requiredWhen, { path: 'scopeType', values: ['BRANCH'] }, action)
    }
  })

  it('clearing the announcement association never dead-ends the save', () => {
    // Type cleared but a stale target id lingers: the association is simply dropped.
    const cleared = validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'PLATFORM', title: '公告', summary: '摘要', body: '正文', visibleFrom: '2030-01-01T00:00:00Z',
      targetType: '', targetId: 'event-stale',
    })
    assert.equal(cleared.ok, true)
    if (cleared.ok) {
      assert.equal('targetType' in cleared.input, false)
      assert.equal('targetId' in cleared.input, false)
    }
    // Type chosen but no content picked: a plain-language pointer.
    const unmatched = validateContentMutation('mip.admin.announcements.save', {
      scopeType: 'PLATFORM', title: '公告', summary: '摘要', body: '正文', visibleFrom: '2030-01-01T00:00:00Z',
      targetType: 'EVENT', targetId: '',
    })
    assert.equal(unmatched.ok === false && unmatched.errors.form, '选择了关联类型后，请选择关联内容，或清空关联类型')
  })

  it('names the video-account format errors after the field', () => {
    const result = validateContentMutation('mip.admin.knowledge.contents.save', {
      categoryId: uuid, contentType: 'PRIVATE_CHANNEL', title: '标题', summary: '摘要',
      channelFinderUserName: 'https://finder.qq.com/xxx', channelFeedId: 'feed-1',
      accessType: 'FREE', commentsEnabled: true, moderationMode: 'AUTO',
    })
    assert.equal(result.ok === false && result.errors.form.includes('视频号用户名'), true)
  })

  it('turns the knowledge product content field into a guided catalog pick', () => {
    const contentId = getContentMutationForm('mip.admin.knowledge.products.save').fields.find(field => field.key === 'contentId') as { optionsAction?: string, emptyHint?: string }
    assert.equal(contentId.optionsAction, 'mip.admin.knowledge.list')
    assert.ok(contentId.emptyHint?.includes('新建内容'))
  })
})
