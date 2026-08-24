'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { getEvent } = require('../domain/event-service')

function eventRow(overrides = {}) {
  return {
    id: 'event-1',
    app_id: 'wx-app',
    scope_type: 'PLATFORM',
    branch_id: null,
    organizer_user_id: '10000000-0000-4000-8000-000000000001',
    organizer_nickname: '公开主办方',
    organizer_headline: '活动组织者',
    organizer_avatar_file_id: 'cloud://organizer-avatar',
    organizer_visibility_json: '{"headline":false}',
    title: '活动',
    summary: '摘要',
    description: '介绍',
    notices: '须知',
    event_type_key: 'community',
    event_mode: 'ONLINE',
    access_type: 'FREE',
    registration_policy: 'AUTO',
    status: 'PUBLISHED',
    public_status: 'PUBLISHED',
    starts_at: '2026-08-25T00:00:00.000Z',
    ends_at: '2026-08-25T02:00:00.000Z',
    registration_deadline: '2026-08-24T23:00:00.000Z',
    cancellation_deadline: null,
    online_url: 'https://private.example.test/meeting',
    price_cents: 0,
    currency: 'CNY',
    form_version: 1,
    registration_schema_json: '[]',
    capacity: 10,
    registration_count: 0,
    registration_status: null,
    ...overrides,
  }
}

function eventDatabase(row, contentMedia = []) {
  return {
    async one() {
      return row
    },
    async query(sql) {
      if (sql.includes('mip_event_content_media')) return contentMedia
      assert.match(sql, /mip_event_changes/)
      return []
    },
  }
}

describe('MIP public event detail', () => {
  it('does not return the online link, organizer id, answers, phone, or ticket hash', async () => {
    const result = await getEvent(eventDatabase(eventRow({
      ticket_hash: 'secret',
      phone_ciphertext: Buffer.from('secret'),
      answers_json: '{"phone":"secret"}',
    }), [{
      media_asset_id: 'must-not-leak',
      cloud_file_id: 'cloud://event-content/image.png',
      caption: '现场照片',
    }]), {
      appId: 'wx-app',
      userId: null,
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.equal(result.onlineAccessAvailable, false)
    assert.equal('onlineUrl' in result, false)
    assert.equal('organizerUserId' in result, false)
    assert.equal('answers' in result, false)
    assert.equal('phoneNumber' in result, false)
    assert.equal('ticketHash' in result, false)
    assert.equal(result.organizer.nickname, '公开主办方')
    assert.equal(result.organizer.avatarUrl, 'cloud://organizer-avatar')
    assert.equal('headline' in result.organizer, false)
    assert.match(result.organizer.profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes('10000000-0000-4000-8000-000000000001'), false)
    assert.deepEqual(result.contentMedia, [{
      imageUrl: 'cloud://event-content/image.png',
      caption: '现场照片',
    }])
    assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
  })

  it('returns an HTTPS online link only to a confirmed participant', async () => {
    for (const registrationStatus of ['REGISTERED', 'ATTENDED']) {
      const result = await getEvent(eventDatabase(eventRow({ registration_status: registrationStatus })), {
        appId: 'wx-app',
        userId: 'participant-1',
        eventId: 'event-1',
        now: new Date('2026-08-24T00:00:00.000Z'),
        tokenSecret: '',
        profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
      })
      assert.equal(result.onlineAccessAvailable, true)
      assert.equal(result.onlineUrl, 'https://private.example.test/meeting')
    }
  })

  it('projects a server-authorized refund retry without exposing manual-review refunds', async () => {
    const base = {
      registration_status: 'CANCELLATION_PENDING',
      order_status: 'REFUND_PENDING',
      refund_status: 'PROCESSING',
    }
    const retryable = await getEvent(eventDatabase(eventRow(base)), {
      appId: 'wx-app',
      userId: 'participant-1',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.equal(retryable.canRetryRefund, true)

    const manual = await getEvent(eventDatabase(eventRow({
      ...base,
      refund_last_error_code: 'MANUAL_REVIEW_CHANGE',
    })), {
      appId: 'wx-app',
      userId: 'participant-1',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.equal(manual.canRetryRefund, false)
  })

  it('shows the locked invitation source without returning inviter identities', async () => {
    const userSource = await getEvent(eventDatabase(eventRow({
      registration_status: 'REGISTERED',
      invitation_source_type: 'USER',
      inviter_nickname: '邀请人',
      inviter_visibility_json: '{"nickname":true,"avatar":true}',
      inviter_avatar_file_id: 'cloud://inviter-avatar',
      inviter_user_id: '20000000-0000-4000-8000-000000000002',
    })), {
      appId: 'wx-app',
      userId: 'participant-1',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.deepEqual(userSource.invitationAttribution, {
      sourceType: 'USER',
      displayName: '邀请人',
      avatarUrl: 'cloud://inviter-avatar',
    })
    assert.equal(JSON.stringify(userSource).includes('20000000-0000-4000-8000-000000000002'), false)

    const platformSource = await getEvent(eventDatabase(eventRow({
      registration_status: 'REGISTERED',
      invitation_source_type: 'PLATFORM',
    })), {
      appId: 'wx-app',
      userId: 'participant-1',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.deepEqual(platformSource.invitationAttribution, {
      sourceType: 'PLATFORM',
      displayName: 'MIP 平台',
    })
  })

  it('withholds online links from pending participants and rejects non-HTTPS stored values', async () => {
    for (const registrationStatus of [null, 'PAYMENT_PENDING', 'PENDING_REVIEW']) {
      const result = await getEvent(eventDatabase(eventRow({ registration_status: registrationStatus })), {
        appId: 'wx-app',
        userId: registrationStatus ? 'participant-1' : null,
        eventId: 'event-1',
        now: new Date('2026-08-24T00:00:00.000Z'),
        tokenSecret: '',
        profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
      })
      assert.equal(result.onlineAccessAvailable, false)
      assert.equal('onlineUrl' in result, false)
    }
    const unsafe = await getEvent(eventDatabase(eventRow({
      registration_status: 'REGISTERED',
      online_url: 'http://private.example.test/meeting',
    })), {
      appId: 'wx-app',
      userId: 'participant-1',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })
    assert.equal(unsafe.onlineAccessAvailable, false)
    assert.equal('onlineUrl' in unsafe, false)
  })

  it('keeps an event visible while hiding a blocked organizer projection', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return eventRow({
          organizer_nickname: null,
          organizer_headline: null,
          organizer_avatar_file_id: null,
        })
      },
      async query(sql) {
        if (sql.includes('mip_event_content_media')) return []
        assert.match(sql, /mip_event_changes/)
        return []
      },
    }

    const result = await getEvent(database, {
      appId: 'wx-app',
      userId: 'viewer-user',
      eventId: 'event-1',
      now: new Date('2026-08-24T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
    })

    assert.equal(result.id, 'event-1')
    assert.equal(result.organizer, undefined)
    assert.match(calls[0].sql, /LEFT JOIN mip_profiles organizer_profile/)
    assert.match(calls[0].sql, /visibility_block\.app_id = e\.app_id/)
    assert.match(calls[0].sql, /blocked_user_id = e\.organizer_user_id/)
    assert.deepEqual(calls[0].params.slice(1), [
      'viewer-user',
      'viewer-user',
      'viewer-user',
      'viewer-user',
      'viewer-user',
      'wx-app',
      'event-1',
    ])
  })
})
