'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  listNotifications,
  normalizeResults,
  parseTemplateIds,
} = require('../domain/notifications')

describe('member notification subscriptions', () => {
  it('takes trusted template IDs from server configuration only', () => {
    const config = parseTemplateIds(JSON.stringify({
      registration: { templateId: 'server-template', fields: { title: 'thing1' } },
    }))
    assert.deepEqual(config, { registration: 'server-template' })
  })

  it('accepts at most five unique logical results', () => {
    assert.deepEqual(normalizeResults([
      { templateKey: 'registration', status: 'ACCEPTED' },
      { templateKey: 'event_update', status: 'REJECTED' },
    ]), [
      { templateKey: 'registration', status: 'ACCEPTED' },
      { templateKey: 'event_update', status: 'REJECTED' },
    ])
    assert.throws(() => normalizeResults([
      { templateKey: 'registration', status: 'ACCEPTED' },
      { templateKey: 'registration', status: 'ACCEPTED' },
    ]), /SUBSCRIPTION_RESULTS_INVALID/)
  })

  it('uses a bounded literal limit for CloudBase MySQL compatibility', async () => {
    let observedSql = ''
    let observedParams = []
    const rows = await listNotifications({
      async query(sql, params) {
        observedSql = sql
        observedParams = params
        return []
      },
    }, {
      appId: 'wx-app',
      userId: 'member-1',
      limit: 999,
    })

    assert.deepEqual(rows, [])
    assert.match(observedSql, /LIMIT 50$/)
    assert.doesNotMatch(observedSql, /LIMIT \?/)
    assert.deepEqual(observedParams, ['wx-app', 'member-1'])
  })
})
