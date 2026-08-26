'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createUserInfluenceRepository } = require('../domain/repositories/user-influence')

function createFixture(rows, one = async () => null) {
  const calls = []
  const repository = createUserInfluenceRepository({
    async one(sql, params) {
      calls.push({ sql, params })
      return one(sql, params)
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return rows
    },
  }, {
    iso(value) {
      const date = value instanceof Date ? value : new Date(value)
      return date.toISOString()
    },
    json(value, fallback = {}) {
      if (value === null || value === undefined) return fallback
      if (typeof value === 'object') return value
      try { return JSON.parse(value) }
      catch { return fallback }
    },
  })
  return { calls, repository }
}

function filters(kind, overrides = {}) {
  return {
    kind,
    direction: 'ALL',
    occurredFrom: '',
    occurredTo: '',
    cursor: null,
    cursorContext: {
      subject: 'if1.subject-reference',
      kind,
      direction: 'ALL',
      from: '-',
      to: '-',
    },
    ...overrides,
  }
}

function counterpart(overrides = {}) {
  return {
    counterpart_id: 'user-b',
    counterpart_status: 'ACTIVE',
    counterpart_profile_user_id: 'user-b',
    counterpart_nickname: '林然',
    counterpart_visibility_json: '{}',
    counterpart_is_player: 1,
    ...overrides,
  }
}

describe('admin user influence repository', () => {
  it('summarizes the four current influence facts without bypassing privacy or blocks', async () => {
    const counts = [3, 5, 7, 11]
    let index = 0
    const { calls, repository } = createFixture([], async () => ({ count: counts[index++] }))

    assert.deepEqual(await repository.getUserInfluenceSummary('wx-app', 'user-a'), {
      guestCount: 3,
      interactionCount: 5,
      interestCount: 7,
      visitorCount: 11,
    })
    assert.equal(calls.length, 4)
    assert.match(calls[0].sql, /COUNT\(DISTINCT attribution\.guest_user_id\)/)
    assert.match(calls[0].sql, /attribution\.source_type = 'USER'/)
    assert.match(calls[0].sql, /registration\.share_profile = 1/)
    assert.match(calls[0].sql, /NOT EXISTS \([\s\S]*mip_membership_entitlements/)
    assert.match(calls[1].sql, /FROM mip_event_hearts heart/)
    assert.match(calls[1].sql, /heart\.status = 'ACTIVE'/)
    assert.match(calls[2].sql, /FROM mip_profile_interests interest/)
    assert.match(calls[2].sql, /interest\.status = 'ACTIVE'/)
    assert.match(calls[3].sql, /COUNT\(DISTINCT visit\.visitor_user_id\)/)
    for (const call of calls) {
      assert.match(call.sql, /FROM mip_user_blocks user_block/)
      assert.match(call.sql, /user_block\.status = 'ACTIVE'/)
      assert.match(call.sql, /user_block\.blocker_user_id/)
      assert.match(call.sql, /user_block\.blocked_user_id/)
      assert.doesNotMatch(call.sql, /user_block\.(actor|target)_user_id/)
      assert.deepEqual(call.params, ['wx-app', 'user-a', 'user-a', 'user-a'])
      assert.doesNotMatch(call.sql, /openid|phone/i)
    }
  })

  it('pages raw invitation attribution facts with event and privacy-safe counterpart state', async () => {
    const { calls, repository } = createFixture([
      {
        fact_id: 'registration-c',
        source_type: 'USER',
        occurred_at: new Date('2026-08-25T10:00:00.000Z'),
        status: 'ATTENDED',
        event_title: '城市聚会',
        direction: 'OUTGOING',
        ...counterpart(),
      },
      {
        fact_id: 'registration-b',
        source_type: 'PLATFORM',
        occurred_at: new Date('2026-08-24T10:00:00.000Z'),
        status: 'REGISTERED',
        event_title: '行业交流',
        direction: 'INCOMING',
        ...counterpart({
          counterpart_id: null,
          counterpart_status: null,
          counterpart_profile_user_id: null,
          counterpart_nickname: null,
          counterpart_visibility_json: null,
          counterpart_is_player: 0,
        }),
      },
      {
        fact_id: 'registration-a',
        source_type: 'USER',
        occurred_at: new Date('2026-08-23T10:00:00.000Z'),
        status: 'REGISTERED',
        event_title: '产品交流',
        direction: 'OUTGOING',
        ...counterpart(),
      },
    ])

    const page = await repository.listUserInfluence(
      'wx-app', 'user-a', filters('INVITATION'), 2,
    )

    assert.equal(calls.length, 1)
    assert.match(calls[0].sql, /FROM mip_event_invitation_attributions attribution/)
    assert.match(calls[0].sql, /INNER JOIN mip_event_registrations registration/)
    assert.match(calls[0].sql, /INNER JOIN mip_events event/)
    assert.match(calls[0].sql, /attribution\.app_id = \?/)
    assert.match(calls[0].sql, /attribution\.guest_user_id = subject\.id OR attribution\.inviter_user_id = subject\.id/)
    assert.match(calls[0].sql, /ORDER BY attribution\.captured_at DESC, attribution\.registration_id DESC/)
    assert.doesNotMatch(calls[0].sql, /COUNT\(|GROUP BY|ROW_NUMBER\(|openid|phone/i)
    assert.deepEqual(calls[0].params, ['user-a', 'wx-app', 3])
    assert.equal(page.items.length, 2)
    assert.deepEqual(page.items[0], {
      id: 'registration-c',
      cursorOccurredAt: '2026-08-25 10:00:00.000',
      kind: 'INVITATION',
      direction: 'OUTGOING',
      status: 'ATTENDED',
      occurredAt: '2026-08-25T10:00:00.000Z',
      eventTitle: '城市聚会',
      counterpartNickname: '林然',
      counterpartKind: 'PLAYER',
      counterpartState: 'AVAILABLE',
      sourceType: 'USER',
    })
    assert.deepEqual(page.items[1], {
      id: 'registration-b',
      cursorOccurredAt: '2026-08-24 10:00:00.000',
      kind: 'INVITATION',
      direction: 'INCOMING',
      status: 'REGISTERED',
      occurredAt: '2026-08-24T10:00:00.000Z',
      eventTitle: '行业交流',
      counterpartNickname: null,
      counterpartKind: null,
      counterpartState: 'NOT_APPLICABLE',
      sourceType: 'PLATFORM',
    })
    const cursor = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8'))
    assert.deepEqual(cursor, {
      v: 1,
      subject: 'if1.subject-reference',
      kind: 'INVITATION',
      direction: 'ALL',
      from: '-',
      to: '-',
      occurredAt: '2026-08-24 10:00:00.000',
      id: 'registration-b',
    })
  })

  it('preserves active and cancelled outgoing heart facts without inventing a lost target', async () => {
    const cursor = {
      occurredAt: '2026-08-20 12:00:00.000',
      id: 'heart-cursor',
    }
    const valueFilters = filters('HEART', {
      occurredFrom: '2026-08-01 00:00:00.000',
      cursor,
    })
    const { calls, repository } = createFixture([
      {
        fact_id: 'heart-b',
        status: 'ACTIVE',
        occurred_at: new Date('2026-08-19T10:00:00.000Z'),
        event_title: '城市聚会',
        direction: 'INCOMING',
        ...counterpart({
          counterpart_nickname: '不公开用户',
          counterpart_visibility_json: '{"nickname":false}',
          counterpart_is_player: 0,
        }),
      },
      {
        fact_id: 'heart-a',
        status: 'CANCELLED',
        occurred_at: new Date('2026-08-18T10:00:00.000Z'),
        event_title: '行业交流',
        direction: 'OUTGOING',
        ...counterpart({
          counterpart_id: null,
          counterpart_status: null,
          counterpart_profile_user_id: null,
          counterpart_nickname: null,
          counterpart_visibility_json: null,
          counterpart_is_player: 0,
        }),
      },
    ])

    const page = await repository.listUserInfluence('wx-app', 'user-a', valueFilters, 2)

    assert.match(calls[0].sql, /FROM mip_event_hearts heart/)
    assert.match(calls[0].sql, /heart\.app_id = \?/)
    assert.match(calls[0].sql, /heart\.updated_at >= \?/)
    assert.match(calls[0].sql, /heart\.updated_at < \? OR \(heart\.updated_at = \? AND heart\.id < \?\)/)
    assert.match(calls[0].sql, /ORDER BY heart\.updated_at DESC, heart\.id DESC/)
    assert.doesNotMatch(calls[0].sql, /COUNT\(|GROUP BY|ROW_NUMBER\(|openid|phone/i)
    assert.deepEqual(calls[0].params, [
      'user-a',
      'wx-app',
      '2026-08-01 00:00:00.000',
      cursor.occurredAt,
      cursor.occurredAt,
      cursor.id,
      3,
    ])
    assert.deepEqual(page.items.map(item => ({
      status: item.status,
      direction: item.direction,
      counterpartNickname: item.counterpartNickname,
      counterpartKind: item.counterpartKind,
      counterpartState: item.counterpartState,
    })), [
      {
        status: 'ACTIVE',
        direction: 'INCOMING',
        counterpartNickname: 'MIP 用户',
        counterpartKind: 'GUEST',
        counterpartState: 'REDACTED',
      },
      {
        status: 'CANCELLED',
        direction: 'OUTGOING',
        counterpartNickname: null,
        counterpartKind: null,
        counterpartState: 'NOT_RETAINED',
      },
    ])
  })

  it('returns each visit fact with exact direction and read status', async () => {
    const { calls, repository } = createFixture([
      {
        fact_id: 'visit-b',
        occurred_at: new Date('2026-08-25T08:00:00.000Z'),
        read_at: null,
        direction: 'INCOMING',
        ...counterpart({ counterpart_is_player: 0 }),
      },
      {
        fact_id: 'visit-a',
        occurred_at: new Date('2026-08-24T08:00:00.000Z'),
        read_at: new Date('2026-08-24T09:00:00.000Z'),
        direction: 'INCOMING',
        ...counterpart(),
      },
    ])
    const valueFilters = filters('VISIT', {
      direction: 'INCOMING',
      cursorContext: {
        subject: 'if1.subject-reference',
        kind: 'VISIT',
        direction: 'INCOMING',
        from: '-',
        to: '-',
      },
    })

    const page = await repository.listUserInfluence('wx-app', 'user-a', valueFilters, 20)

    assert.match(calls[0].sql, /FROM mip_profile_visits visit/)
    assert.match(calls[0].sql, /visit\.profile_user_id = subject\.id/)
    assert.match(calls[0].sql, /ORDER BY visit\.visited_at DESC, visit\.id DESC/)
    assert.doesNotMatch(calls[0].sql, /COUNT\(|GROUP BY|ROW_NUMBER\(|openid|phone/i)
    assert.deepEqual(calls[0].params, ['user-a', 'wx-app', 21])
    assert.deepEqual(page.items.map(item => ({
      kind: item.kind,
      direction: item.direction,
      status: item.status,
      eventTitle: item.eventTitle,
      sourceType: item.sourceType,
      counterpartKind: item.counterpartKind,
    })), [
      {
        kind: 'VISIT', direction: 'INCOMING', status: 'UNREAD',
        eventTitle: null, sourceType: null, counterpartKind: 'GUEST',
      },
      {
        kind: 'VISIT', direction: 'INCOMING', status: 'READ',
        eventTitle: null, sourceType: null, counterpartKind: 'PLAYER',
      },
    ])
    assert.equal(page.nextCursor, null)
  })
})
