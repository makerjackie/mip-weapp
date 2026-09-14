'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { normalizeMessageCampaignDraft } = require('../domain/message-campaign-validation')

const draft = {
  scopeType: 'PLATFORM',
  audienceType: 'ALL',
  recipientRefs: [],
  name: '八月会员提醒',
  title: '会员权益提醒',
  body: '你的会员权益即将到期。',
}

describe('message campaign draft validation', () => {
  it('keeps the documented defaults when scope and audience are omitted', () => {
    const normalized = normalizeMessageCampaignDraft({
      name: draft.name, title: draft.title, body: draft.body,
    })
    assert.equal(normalized.scopeType, 'PLATFORM')
    assert.equal(normalized.audienceType, 'ALL')
    assert.deepEqual(normalized.recipientRefs, [])
  })

  it('normalizes a lower-case but documented audience', () => {
    const recipientRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const normalized = normalizeMessageCampaignDraft({ ...draft, audienceType: 'explicit', recipientRefs: [recipientRef] })
    assert.equal(normalized.audienceType, 'EXPLICIT')
    assert.deepEqual(normalized.recipientRefs, [recipientRef])
  })

  it('rejects an unknown audience instead of widening it to every user', () => {
    assert.throws(
      () => normalizeMessageCampaignDraft({ ...draft, audienceType: 'EVERYONE' }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })

  it('rejects an unknown scope instead of widening it to the platform', () => {
    assert.throws(
      () => normalizeMessageCampaignDraft({ ...draft, scopeType: 'GLOBAL' }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })
})
