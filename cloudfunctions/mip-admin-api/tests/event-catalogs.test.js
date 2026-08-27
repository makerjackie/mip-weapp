'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const {
  createEventCatalogAdmin,
  normalizeCatalogSave,
  normalizeRecapSave,
  normalizeTagAssignmentsReplace,
} = require('../domain/event-catalogs')

const APP_ID = 'wx-event-catalog-test'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const CATALOG_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const RECAP_ID = '44444444-4444-4444-8444-444444444444'

function caller() {
  return { appId: APP_ID, userId: USER_ID }
}

function access(calls = []) {
  return {
    async session(value) {
      calls.push('session')
      return {
        caller: value,
        bindings: [{
          roleKey: 'PLATFORM_OPERATIONS',
          scopeType: 'PLATFORM',
          scopeId: null,
        }],
      }
    },
    mutationAuthorization(grant, capability) {
      calls.push('authorize-mutation')
      return { capability, effectiveGrant: grant }
    },
    audit(context, grant, input) {
      return {
        appId: context.caller.appId,
        actorUserId: context.caller.userId,
        effectiveRole: grant.roleKey,
        ...input,
      }
    },
  }
}

function repository(overrides = {}) {
  return {
    async archiveEventCatalog() { throw new Error('unexpected repository call') },
    async archiveEventVideoRecap() { throw new Error('unexpected repository call') },
    async changeEventCatalogStatus() { throw new Error('unexpected repository call') },
    async changeEventVideoRecapStatus() { throw new Error('unexpected repository call') },
    async getEventTagAssignments() { throw new Error('unexpected repository call') },
    async getEventVideoRecap() { throw new Error('unexpected repository call') },
    async listEventCatalogs() { throw new Error('unexpected repository call') },
    async listEventVideoRecaps() { throw new Error('unexpected repository call') },
    async saveEventCatalog() { throw new Error('unexpected repository call') },
    async saveEventVideoRecap() { throw new Error('unexpected repository call') },
    async replaceEventTagAssignments() { throw new Error('unexpected repository call') },
    ...overrides,
  }
}

describe('admin event catalogs and video recaps', () => {
  it('exposes exactly the eleven neutral operations owned by this deep module', () => {
    const service = createEventCatalogAdmin({ access: access(), repository: repository() })
    assert.deepEqual(Object.keys(service).sort(), [
      'archiveEventCatalog',
      'archiveEventVideoRecap',
      'changeEventCatalogStatus',
      'changeEventVideoRecapStatus',
      'getEventTagAssignments',
      'getEventVideoRecap',
      'listEventCatalogs',
      'listEventVideoRecaps',
      'replaceEventTagAssignments',
      'saveEventCatalog',
      'saveEventVideoRecap',
    ])
  })

  it('establishes the session before parsing even malformed input', async () => {
    const sessionError = Object.assign(new Error('SESSION_REQUIRED'), { code: 'SESSION_REQUIRED' })
    const calls = []
    const service = createEventCatalogAdmin({
      access: {
        async session() {
          calls.push('session')
          throw sessionError
        },
      },
      repository: repository(),
    })

    await assert.rejects(
      () => service.listEventCatalogs(caller(), { kind: 'TYPE', unexpected: true }),
      error => error === sessionError,
    )
    assert.deepEqual(calls, ['session'])
  })

  it('passes only the caller AppID and normalized filters into reads', async () => {
    const captured = []
    const service = createEventCatalogAdmin({
      access: access(),
      repository: repository({
        async listEventCatalogs(...args) {
          captured.push(['catalogs', ...args])
          return { items: [], nextCursor: null }
        },
        async listEventVideoRecaps(...args) {
          captured.push(['recaps', ...args])
          return { items: [], nextCursor: null }
        },
        async getEventVideoRecap(...args) {
          captured.push(['recap', ...args])
          return { id: RECAP_ID }
        },
        async getEventTagAssignments(...args) {
          captured.push(['tags', ...args])
          return { eventId: EVENT_ID, eventVersion: 4, tags: [] }
        },
      }),
    })

    await service.listEventCatalogs(caller(), { kind: 'TAG', status: 'ACTIVE', limit: 25 })
    await service.listEventVideoRecaps(caller(), { eventId: EVENT_ID, status: 'INACTIVE' })
    await service.getEventVideoRecap(caller(), { recapId: RECAP_ID })
    await service.getEventTagAssignments(caller(), { eventId: EVENT_ID })

    assert.equal(captured[0][1], APP_ID)
    assert.equal(captured[0][2], 'TAG')
    assert.deepEqual(captured[0][3], {
      kind: 'TAG',
      status: 'ACTIVE',
      query: '',
      cursor: null,
      cursorContext: { kind: 'TAG', status: 'ACTIVE', query: '-' },
      limit: 25,
    })
    assert.equal(captured[1][1], APP_ID)
    assert.equal(captured[1][2].eventId, EVENT_ID)
    assert.equal(captured[2][1], APP_ID)
    assert.equal(captured[2][2], RECAP_ID)
    assert.deepEqual(captured[3], ['tags', APP_ID, EVENT_ID])
  })

  it('authorizes tag replacement with the platform catalog capability and audits stable keys', async () => {
    let captured
    const calls = []
    const service = createEventCatalogAdmin({
      access: access(calls),
      repository: repository({
        async replaceEventTagAssignments(input) {
          captured = input
          return { eventId: EVENT_ID, eventVersion: 5, tags: [], idempotent: false }
        },
      }),
    })

    await service.replaceEventTagAssignments(caller(), {
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [CATALOG_ID],
    })

    assert.deepEqual(calls, ['session', 'authorize-mutation'])
    assert.equal(captured.appId, APP_ID)
    assert.equal(captured.actorUserId, USER_ID)
    assert.equal(captured.authorization.capability, CAPABILITIES.EVENTS_CATALOG_MANAGE)
    assert.deepEqual(captured.audit(EVENT_ID, {
      addedTagKeys: ['roundtable'],
      removedTagKeys: ['legacy'],
    }).metadata, {
      addedCount: 1,
      removedCount: 1,
      addedTagKeys: ['roundtable'],
      removedTagKeys: ['legacy'],
    })
  })

  it('uses platform capabilities and excludes raw video destination identifiers from audits', async () => {
    let captured
    const calls = []
    const service = createEventCatalogAdmin({
      access: access(calls),
      repository: repository({
        async saveEventVideoRecap(input) {
          captured = input
          return { id: RECAP_ID }
        },
      }),
    })

    await service.saveEventVideoRecap(caller(), {
      eventId: EVENT_ID,
      title: '活动视频回顾',
      summary: '活动内容摘要',
      destination: {
        provider: 'WECHAT_CHANNELS',
        type: 'ACTIVITY',
        finderUserName: 'sph6Rngt56a0grn',
        feedId: 'feed-private-token',
      },
      sortOrder: 10,
    })

    assert.deepEqual(calls, ['session', 'authorize-mutation'])
    assert.equal(captured.appId, APP_ID)
    assert.equal(captured.actorUserId, USER_ID)
    assert.equal(captured.authorization.capability, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const audit = captured.audit(RECAP_ID)
    assert.deepEqual(audit.metadata, {
      created: true,
      eventId: EVENT_ID,
      destinationProvider: 'WECHAT_CHANNELS',
      destinationType: 'ACTIVITY',
    })
    assert.doesNotMatch(JSON.stringify(audit.metadata), /sph6Rngt56a0grn|feed-private-token/)
  })

  it('rejects unknown DTO keys, terminal status writes, and invalid destination pairs', () => {
    assert.throws(
      () => normalizeCatalogSave({
        kind: 'TYPE', key: 'workshop', name: '工作坊', description: '', sortOrder: 1,
        status: 'ACTIVE',
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.doesNotThrow(() => normalizeCatalogSave({
      kind: 'TAG', key: 'morning', name: 'MIP早会', description: '', sortOrder: 1,
    }))
    assert.throws(
      () => normalizeCatalogSave({
        kind: 'TAG', key: 'too_long', name: '超过五个字标签', description: '', sortOrder: 1,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.throws(
      () => normalizeRecapSave({
        eventId: EVENT_ID,
        title: '活动视频回顾',
        summary: '',
        destination: {
          provider: 'WECHAT_CHANNELS',
          type: 'PROFILE',
          finderUserName: 'sph6Rngt56a0grn',
          feedId: 'profile-cannot-have-feed',
        },
        sortOrder: 0,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.throws(
      () => normalizeRecapSave({
        eventId: EVENT_ID,
        title: '活动视频回顾',
        summary: '',
        destination: {
          provider: 'WECHAT_CHANNELS',
          type: 'ACTIVITY',
          finderUserName: 'sph6Rngt56a0grn',
          feedId: null,
        },
        sortOrder: 0,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })

  it('accepts only a non-empty sph-prefixed video account id', () => {
    const destination = {
      provider: 'WECHAT_CHANNELS',
      type: 'PROFILE',
      finderUserName: 'sph6Rngt56a0grn',
      feedId: null,
    }
    assert.doesNotThrow(() => normalizeRecapSave({
      eventId: EVENT_ID,
      title: '活动视频回顾',
      summary: '',
      destination,
      sortOrder: 0,
    }))
    assert.doesNotThrow(() => normalizeRecapSave({
      eventId: EVENT_ID,
      title: '活动视频回顾',
      summary: '',
      destination: { ...destination, finderUserName: `sph${'a'.repeat(125)}` },
      sortOrder: 0,
    }))

    for (const finderUserName of [
      'sph',
      'finder6Rngt56a0grn',
      'https://channels.weixin.qq.com/sph6Rngt56a0grn',
      `sph${'a'.repeat(126)}`,
    ]) {
      assert.throws(
        () => normalizeRecapSave({
          eventId: EVENT_ID,
          title: '活动视频回顾',
          summary: '',
          destination: { ...destination, finderUserName },
          sortOrder: 0,
        }),
        error => error?.code === 'VALIDATION_FAILED',
      )
    }
  })

  it('normalizes unique tag ids and rejects unknown keys or duplicate assignments', () => {
    assert.deepEqual(normalizeTagAssignmentsReplace({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [CATALOG_ID],
    }), {
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [CATALOG_ID],
    })
    assert.throws(
      () => normalizeTagAssignmentsReplace({
        eventId: EVENT_ID,
        expectedVersion: 4,
        tagIds: [CATALOG_ID, CATALOG_ID],
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.throws(
      () => normalizeTagAssignmentsReplace({
        eventId: EVENT_ID,
        expectedVersion: 4,
        tagIds: [],
        appId: APP_ID,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })
})
