import assert from 'node:assert/strict'
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
  albumEnabled: true, albumSubmissionPolicy: 'REVIEW', startsAt: '2030-03-14T10:00:00+08:00',
  endsAt: '2030-03-14T12:00:00+08:00', venueName: '福田会场', address: '福华三路', cityName: '深圳',
  capacity: '30', waitlistEnabled: false, priceCents: '0', contentMedia: [], registrationSchema: [],
}

describe('event mutation form contracts', () => {
  it('declares every requested action with a capability and typed fields', () => {
    assert.equal(EVENT_MUTATION_ACTIONS.length, 10)
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
        contentMedia: [], notices: '', coverAssetId: null, eventTypeKey: 'workshop', eventMode: 'OFFLINE',
        accessType: 'FREE', registrationPolicy: 'AUTO', albumEnabled: true, albumSubmissionPolicy: 'REVIEW',
        startsAt: '2030-03-14T10:00:00+08:00', endsAt: '2030-03-14T12:00:00+08:00', registrationDeadline: null,
        cancellationDeadline: null, venueName: '福田会场', address: '福华三路', cityName: '深圳', latitude: null,
        longitude: null, onlineUrl: null, capacity: 30, waitlistEnabled: false, priceCents: 0, registrationSchema: [],
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

  it('builds review, check-in, undo, policy, tags, and catalog inputs exactly', () => {
    assert.deepEqual(buildEventMutationInput('mip.admin.events.registrations.review', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', decision: 'APPROVE' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2, decision: 'APPROVE' })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.checkIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2 })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.undoCheckIn', { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: '2', reason: '误操作' }), { eventId: 'event-1', registrationId: 'reg-1', expectedVersion: 2, reason: '误操作' })
    assert.deepEqual(buildEventMutationInput('mip.admin.events.album.review', { eventId: 'event-1', photoId: 'photo-1', expectedVersion: '2', decision: 'REJECT', reason: '内容不符合活动要求' }), { eventId: 'event-1', photoId: 'photo-1', expectedVersion: 2, decision: 'REJECT', reason: '内容不符合活动要求' })
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
