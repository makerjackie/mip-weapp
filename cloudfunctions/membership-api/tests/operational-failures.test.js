'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { recordOperationalFailure } = require('../domain/operational-failures')

describe('operational media failures', () => {
  it('persists only bounded failure facts without image bytes or provider payloads', async () => {
    const calls = []
    await recordOperationalFailure({
      async query(sql, params) {
        calls.push({ sql, params })
      },
    }, {
      appId: 'wx-app',
      userId: 'openid',
      category: 'MEDIA_REVIEW',
      resourceType: 'event-photo',
      resourceId: 'event-id',
      errorCode: 'PHOTO_CONTENT_REJECTED',
    })
    assert.equal(calls.length, 1)
    assert.match(calls[0].sql, /member_operational_failures/)
    assert.equal(calls[0].params.includes('PHOTO_CONTENT_REJECTED'), true)
    assert.equal(calls[0].params.some(value => Buffer.isBuffer(value)), false)
  })

  it('rejects arbitrary provider errors', async () => {
    await assert.rejects(() => recordOperationalFailure({ query() {} }, {
      appId: 'wx-app',
      userId: 'openid',
      category: 'MEDIA_REVIEW',
      resourceType: 'event-photo',
      errorCode: 'RAW_PROVIDER_PAYLOAD',
    }), /OPERATIONAL_FAILURE_INVALID/)
  })
})
