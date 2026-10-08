'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listEventRecaps } = require('../domain/event-service')

const APP_ID = 'wx-app-a'

function videoRow(overrides = {}) {
  return {
    video_id: 12,
    title: 'MIP 反人性早会第 328 场',
    finder_user_name: 'sphMIP2026',
    feed_id: null,
    cover_url: 'cloud://cover-1.jpg',
    ...overrides,
  }
}

function database(rows, calls = []) {
  return {
    async query(sql, params) {
      calls.push({ sql, params })
      return rows
    },
  }
}

describe('MIP public past-event recap contract', () => {
  it('projects published configured videos as recap cards with a channels destination', async () => {
    const calls = []
    const db = database([
      videoRow(),
      videoRow({ video_id: 11, feed_id: 'feed-token-1', cover_url: null }),
    ], calls)
    const result = await listEventRecaps(db, { appId: APP_ID })
    assert.deepEqual(result, {
      items: [
        {
          id: '12',
          title: 'MIP 反人性早会第 328 场',
          coverUrl: 'cloud://cover-1.jpg',
          destination: { provider: 'WECHAT_CHANNELS', type: 'PROFILE', finderUserName: 'sphMIP2026', feedId: null },
        },
        {
          id: '11',
          title: 'MIP 反人性早会第 328 场',
          coverUrl: '',
          destination: { provider: 'WECHAT_CHANNELS', type: 'ACTIVITY', finderUserName: 'sphMIP2026', feedId: 'feed-token-1' },
        },
      ],
    })
    assert.match(calls[0].sql, /video\.status = 'PUBLISHED'/)
    assert.match(calls[0].sql, /video\.title <> ''/)
    assert.match(calls[0].sql, /video\.finder_user_name REGEXP '\^sph\[A-Za-z0-9\]\+\$'/)
    assert.match(calls[0].sql, /video\.feed_id IS NULL OR video\.feed_id REGEXP '\^\[A-Za-z0-9_\=\+\/\.\-\]\+\$'/)
    assert.match(calls[0].sql, /ORDER BY video\.sort_order ASC, video\.video_id DESC/)
    assert.match(calls[0].sql, /LIMIT 100/)
    assert.deepEqual(calls[0].params, [APP_ID])
  })

  it('defensively skips malformed rows even if the database filter regresses', async () => {
    const db = database([
      videoRow({ video_id: 20, finder_user_name: 'invalid-finder' }),
      videoRow({ video_id: 21, feed_id: 'feed id with spaces' }),
      videoRow({ video_id: 22, title: '' }),
      videoRow({ video_id: 23 }),
    ])
    const result = await listEventRecaps(db, { appId: APP_ID })
    assert.deepEqual(result, {
      items: [
        {
          id: '23',
          title: 'MIP 反人性早会第 328 场',
          coverUrl: 'cloud://cover-1.jpg',
          destination: { provider: 'WECHAT_CHANNELS', type: 'PROFILE', finderUserName: 'sphMIP2026', feedId: null },
        },
      ],
    })
  })
})
