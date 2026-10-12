import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import {
  EVENT_MUTATION_ACTIONS,
  EVENT_MUTATION_CONFIGS,
  buildAdminEventMutationInput,
  buildEventMutationInput,
  createAdminEventMutationDefinition,
  validateEventMutationInput,
} from './admin-event-mutation-forms.ts'

const baseEvent = {
  scopeType: 'PLATFORM', title: '活动名称', summary: '活动摘要', description: '这是活动介绍',
  eventTypeKey: 'workshop', eventMode: 'OFFLINE', accessType: 'FREE', registrationPolicy: 'AUTO',
  startsAt: '2030-03-14T10:00:00+08:00',
  endsAt: '2030-03-14T12:00:00+08:00', venueName: '福田会场', address: '福华三路', cityName: '深圳',
  capacity: '30', waitlistEnabled: false, priceCents: '0', contentMedia: [], registrationSchema: [],
}

describe('event mutation form contracts', () => {
  it('produces registration schemas accepted unchanged by the actual server validator', () => {
    const require = createRequire(import.meta.url)
    const { normalizeRegistrationSchema } = require('../../../cloudfunctions/mip-admin-api/domain/registration-schema.js')
    const schema = [
      { key: 'field_0123456789abcdef', label: '姓名', type: 'TEXT', required: true },
      { key: 'intro', label: '介绍', type: 'TEXTAREA', required: false, maxLength: 1000 },
      { key: 'role', label: '身份', type: 'SELECT', required: true, options: ['成员', '嘉宾'] },
      { key: 'consent', label: '参与交流', type: 'BOOLEAN', required: false },
    ]
    const result = buildEventMutationInput('mip.admin.events.save', { ...baseEvent, registrationSchema: schema })
    assert.ok(result && 'draft' in result)
    const draft = result.draft as { registrationSchema: unknown }
    assert.deepEqual(normalizeRegistrationSchema(draft.registrationSchema), draft.registrationSchema)
    for (const invalid of [
      [{ ...schema[0], key: 'field-1' }],
      [schema[0], schema[0]],
      [{ ...schema[0], maxLength: 201 }],
      [{ ...schema[1], maxLength: 1001 }],
      [{ ...schema[0], label: '字'.repeat(61) }],
      [{ ...schema[2], options: Array.from({ length: 21 }, (_, i) => String(i)) }],
      Array.from({ length: 13 }, (_, i) => ({ ...schema[0], key: `field_${i}` })),
    ]) {
      assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, registrationSchema: invalid }), null)
    }
  })
  it('declares every requested action with a capability and typed fields', () => {
    assert.equal(EVENT_MUTATION_ACTIONS.length, 12)
    for (const action of EVENT_MUTATION_ACTIONS) {
      const config = EVENT_MUTATION_CONFIGS[action]
      assert.equal(config.action, action)
      assert.ok(config.capability)
      assert.ok(config.fields.length > 0)
    }
  })

  it('builds create and update event inputs with optional asset ids', () => {
    assert.deepEqual(buildEventMutationInput('mip.admin.events.save', baseEvent), {
      draft: {
        scopeType: 'PLATFORM', branchId: null, title: '活动名称', summary: '活动摘要', description: '这是活动介绍',
        contentMedia: [], organizerIntroduction: '', notices: '', coverAssetId: null, eventTypeKey: 'workshop', eventMode: 'OFFLINE',
        accessType: 'FREE', registrationPolicy: 'AUTO',
        startsAt: '2030-03-14T10:00:00+08:00', endsAt: '2030-03-14T12:00:00+08:00', registrationDeadline: null,
        cancellationDeadline: null, venueName: '福田会场', address: '福华三路', cityName: '深圳', latitude: null,
        longitude: null, onlineUrl: null, guideUrl: null, capacity: 30, waitlistEnabled: false, priceCents: 0, registrationSchema: [],
      },
    })
    const updated = buildEventMutationInput('mip.admin.events.save', {
      ...baseEvent, eventId: 'event-1', expectedVersion: '4', coverAssetId: '550e8400-e29b-41d4-a716-446655440000',
      contentMedia: [{ assetId: '550e8400-e29b-41d4-a716-446655440001', caption: '现场照片' }],
    }) as Record<string, unknown>
    assert.equal(updated.eventId, 'event-1')
    assert.equal(updated.expectedVersion, 4)
    assert.equal((updated.draft as Record<string, unknown>).coverAssetId, '550e8400-e29b-41d4-a716-446655440000')
  })

  it('carries the admin-configured organizer introduction into the save draft (C1)', () => {
    // 小程序需求 C1：主办方介绍为可选长文本（上限与活动介绍一致），空值归一为空串。
    const withIntro = buildEventMutationInput('mip.admin.events.save', {
      ...baseEvent, organizerIntroduction: '  主办方介绍正文  ',
    }) as { draft: Record<string, unknown> }
    assert.equal(withIntro.draft.organizerIntroduction, '主办方介绍正文')

    const withoutIntro = buildEventMutationInput('mip.admin.events.save', baseEvent) as { draft: Record<string, unknown> }
    assert.equal(withoutIntro.draft.organizerIntroduction, '')

    assert.equal(buildEventMutationInput('mip.admin.events.save', {
      ...baseEvent, organizerIntroduction: '长'.repeat(20_001),
    }), null)
    assert.ok(buildEventMutationInput('mip.admin.events.save', {
      ...baseEvent, organizerIntroduction: '长'.repeat(20_000),
    }))
  })

  it('keeps the optional route-guide link only when it is a valid https url', () => {
    // MIW-21: 指引按钮由后台配置的路线指引链接驱动；未配置时不提交该字段。
    const guideDraft = (values: Record<string, unknown>) =>
      (buildEventMutationInput('mip.admin.events.save', { ...baseEvent, ...values }) as { draft: Record<string, unknown> } | null)?.draft
    assert.equal(guideDraft({ guideUrl: 'https://mp.weixin.qq.com/s/abc123' })?.guideUrl, 'https://mp.weixin.qq.com/s/abc123')
    assert.equal(guideDraft({ guideUrl: '   ' })?.guideUrl, null)
    assert.equal(guideDraft({})?.guideUrl, null)
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, guideUrl: 'http://mp.weixin.qq.com/s/abc123' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, guideUrl: 'https://example.com/a link' }), null)
  })

  it('builds review, check-in, undo, policy, tags, and catalog inputs exactly', () => {
    assert.deepEqual(buildEventMutationInput('mip.admin.events.registrations.review', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', decision: 'APPROVE' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2, decision: 'APPROVE' })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.checkIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2 })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.undoCheckIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', reason: '误操作' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2, reason: '误操作' })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.policy.save', { expectedVersion: '0', cancellationHoursBeforeStart: '24' }), { expectedVersion: 0, cancellationHoursBeforeStart: 24 })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.tags.replace', { eventId: 'event-1', expectedVersion: '3', tagIds: ['tag-2', 'tag-1'] }), { eventId: 'event-1', expectedVersion: 3, tagIds: ['tag-1', 'tag-2'] })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.catalog.save', { kind: 'TAG', key: 'growth', name: '增长', description: '', sortOrder: '1' }), { kind: 'TAG', key: 'growth', name: '增长', description: '', sortOrder: 1 })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.catalog.save', { kind: 'TYPE', catalogId: 'type-1', expectedVersion: '2', name: '工作坊', description: '', sortOrder: '0' }), { kind: 'TYPE', catalogId: 'type-1', expectedVersion: 2, name: '工作坊', description: '', sortOrder: 0 })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.catalog.changeStatus', { kind: 'TYPE', catalogId: 'type-1', expectedVersion: '2', status: 'INACTIVE' }), { kind: 'TYPE', catalogId: 'type-1', expectedVersion: 2, status: 'INACTIVE' })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.catalog.archive', { kind: 'TAG', catalogId: 'tag-1', expectedVersion: '2', reason: '目录不再使用' }), { kind: 'TAG', catalogId: 'tag-1', expectedVersion: 2, reason: '目录不再使用' })
  })

  it('rejects unsupported fields and server-invalid cross-field combinations', () => {
    assert.equal(buildEventMutationInput('mip.admin.events.checkIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', unexpected: 'x' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.undoCheckIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', reason: '' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, endsAt: '2030-03-14T09:00:00+08:00' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, eventMode: 'ONLINE', venueName: '', onlineUrl: 'http://example.com' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, accessType: 'PAID', priceCents: '100', registrationPolicy: 'APPROVAL' }), null)
    assert.equal(buildEventMutationInput('mip.admin.events.catalog.save', { kind: 'TAG', key: 'growth', name: '目录名称过长', description: '', sortOrder: '1' }), null)
    const result = validateEventMutationInput('mip.admin.events.tags.replace', { eventId: 'event-1', expectedVersion: '1', tagIds: ['tag-1', 'tag-1'] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.errors[0]?.field, 'tagIds')
    assert.equal(buildEventMutationInput('mip.admin.events.save', { ...baseEvent, registrationSchema: [{ key: 'role', label: '身份', type: 'SELECT', required: true }] }), null)
    assert.deepEqual((buildEventMutationInput('mip.admin.events.save', { ...baseEvent, registrationSchema: [{ key: 'role', label: '身份', type: 'SELECT', required: true, options: ['成员', '嘉宾'] }] }) as { draft: { registrationSchema: unknown } }).draft.registrationSchema, [{ key: 'role', label: '身份', type: 'SELECT', required: true, options: ['成员', '嘉宾'] }])
  })

  it('supports the shared definition adapter without trusting submitted ids or versions', () => {
    const definition = createAdminEventMutationDefinition(
      'mip.admin.events.checkIn', 'event-1',
      () => '7',
    )
    assert.equal(definition.fields.find(field => field.name === 'registrationId')?.label, '报名标识')
    assert.deepEqual(buildAdminEventMutationInput(definition, {
      registrationId: 'registration-1', expectedVersion: 99,
    }), { eventId: 'event-1', registrationId: 'registration-1', expectedVersion: 99 })
    const catalog = createAdminEventMutationDefinition('mip.admin.events.catalog.save', 'catalog-1')
    assert.deepEqual(buildAdminEventMutationInput(catalog, {
      kind: 'TYPE', expectedVersion: 2, name: '工作坊', description: '', sortOrder: 0, key: 'read-only-key',
    }), { kind: 'TYPE', catalogId: 'catalog-1', expectedVersion: 2, name: '工作坊', description: '', sortOrder: 0 })
  })
})

describe('novice-friendly event form contracts', () => {
  it('derives the summary from the description when the operator leaves it empty', () => {
    const result = buildEventMutationInput('mip.admin.events.save', { ...baseEvent, summary: '' })
    assert.ok(result && 'draft' in result)
    const draft = result.draft as { summary: string, description: string }
    assert.equal(draft.summary, baseEvent.description)
    assert.ok(draft.summary.length <= 300)
  })

  it('marks latitude/longitude as advanced optional fields with guidance', () => {
    const fields = EVENT_MUTATION_CONFIGS['mip.admin.events.save'].fields
    const latitude = fields.find(field => field.key === 'latitude')
    const longitude = fields.find(field => field.key === 'longitude')
    assert.ok(latitude && latitude.advanced && !latitude.required && (latitude.extra || '').includes('导航'))
    assert.ok(longitude && longitude.advanced && !longitude.required)
  })

  it('keeps price in yuan behind the paid gate', () => {
    const fields = EVENT_MUTATION_CONFIGS['mip.admin.events.save'].fields
    const price = fields.find(field => field.key === 'priceCents')
    assert.ok(price)
    assert.equal(price.kind, 'money')
    assert.equal(price.label, '金额（元）')
    assert.deepEqual(price.visibleWhen, { path: 'accessType', value: 'PAID' })
  })

  it('hides the catalog stable key and auto-generates it on create', () => {
    const creating = createAdminEventMutationDefinition('mip.admin.events.catalog.save', '')
    const keyField = creating.fields.find(field => field.key === 'key')
    assert.ok(keyField?.hidden)
    assert.match(String(creating.values.key), /^web-[a-z0-9]+$/)
    const editing = createAdminEventMutationDefinition('mip.admin.events.catalog.save', 'cat-123')
    assert.ok(editing.fields.find(field => field.key === 'key')?.hidden)
    const input = buildAdminEventMutationInput(editing, {
      kind: 'TAG', catalogId: 'cat-123', expectedVersion: 3, name: '标签', description: '', sortOrder: 1,
    })
    assert.ok(input)
    assert.equal('key' in input, false)
  })
})

describe('R1 novice walkthrough fixes', () => {
  it('zeroes a stale paid price once accessType leaves PAID instead of failing on a hidden field', () => {
    // Switching a 199-yuan draft to FREE hides the price control; its old value
    // must not block the save with an error the operator cannot see or clear.
    const result = buildEventMutationInput('mip.admin.events.save', { ...baseEvent, accessType: 'FREE', priceCents: '19900' })
    assert.ok(result && 'draft' in result)
    assert.equal((result.draft as { priceCents: number }).priceCents, 0)
  })

  it('explains each paid-event precondition instead of one opaque message', () => {
    const approval = validateEventMutationInput('mip.admin.events.save', { ...baseEvent, accessType: 'PAID', registrationPolicy: 'APPROVAL', priceCents: '19900' })
    assert.equal(approval.ok, false)
    assert.equal(approval.ok === false && approval.errors[0]?.message, '付费活动仅支持「自动确认」报名方式，请先调整报名方式')

    const waitlist = validateEventMutationInput('mip.admin.events.save', { ...baseEvent, accessType: 'PAID', waitlistEnabled: true, priceCents: '19900' })
    assert.equal(waitlist.ok === false && waitlist.errors[0]?.message, '付费活动不支持候补报名，请关闭候补报名')

    const freePrice = validateEventMutationInput('mip.admin.events.save', { ...baseEvent, accessType: 'PAID', priceCents: '0' })
    assert.equal(freePrice.ok === false && freePrice.errors[0]?.message, '付费活动必须填写大于 0 的金额（元）')
  })

  it('marks the paid price required so the form flags it before submit', () => {
    const price = EVENT_MUTATION_CONFIGS['mip.admin.events.save'].fields.find(field => field.key === 'priceCents')
    assert.equal(price?.required, true)
  })

  it('points a missing branch selection at the branchId field with plain wording', () => {
    const result = validateEventMutationInput('mip.admin.events.save', { ...baseEvent, scopeType: 'BRANCH', branchId: '' })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.errors[0]?.field, 'branchId')
    assert.equal(result.ok === false && result.errors[0]?.message, '请选择服务器')
    const branchField = EVENT_MUTATION_CONFIGS['mip.admin.events.save'].fields.find(field => field.key === 'branchId')
    assert.deepEqual(branchField?.requiredWhen, { path: 'scopeType', values: ['BRANCH'] })
  })

  it('hides catalogId and expectedVersion on the catalog save form for both create and edit', () => {
    const creating = createAdminEventMutationDefinition('mip.admin.events.catalog.save', '')
    assert.ok(creating.fields.find(field => field.key === 'catalogId')?.hidden)
    assert.ok(creating.fields.find(field => field.key === 'expectedVersion')?.hidden)
    const editing = createAdminEventMutationDefinition('mip.admin.events.catalog.save', 'cat-123')
    assert.ok(editing.fields.find(field => field.key === 'catalogId')?.hidden)
    assert.ok(editing.fields.find(field => field.key === 'expectedVersion')?.hidden)
  })

  it('names the 5-character tag limit instead of a generic format error', () => {
    const result = validateEventMutationInput('mip.admin.events.catalog.save', { kind: 'TAG', key: 'web-abc', name: '周末城市漫步', description: '', sortOrder: 0 })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.errors[0]?.message, '标签名称不能超过 5 个字')
    const nameField = EVENT_MUTATION_CONFIGS['mip.admin.events.catalog.save'].fields.find(field => field.key === 'name')
    assert.ok((nameField?.extra || '').includes('5 个字'))
  })

  it('guides the tags.replace dialog to the catalog page when tags are empty', () => {
    const tagIds = EVENT_MUTATION_CONFIGS['mip.admin.events.tags.replace'].fields.find(field => field.key === 'tagIds')
    assert.ok(tagIds?.emptyHint && tagIds.emptyHint.includes('新建活动目录'))
  })
})

describe('R2 novice walkthrough fixes', () => {
  it('keeps the event type empty on create so no ghost selection appears', () => {
    const creating = createAdminEventMutationDefinition('mip.admin.events.save', '')
    assert.equal(creating.values.eventTypeKey, '')
    // submitting without a type still lands on the platform default
    const result = buildEventMutationInput('mip.admin.events.save', { ...baseEvent, eventTypeKey: '' })
    assert.ok(result && 'draft' in result)
    assert.equal((result.draft as { eventTypeKey: string }).eventTypeKey, 'general')
  })

  it('marks the offline venue as conditionally required', () => {
    const venueName = EVENT_MUTATION_CONFIGS['mip.admin.events.save'].fields.find(field => field.key === 'venueName')
    assert.deepEqual(venueName?.requiredWhen, { path: 'eventMode', values: ['OFFLINE', 'HYBRID'] })
  })
})
