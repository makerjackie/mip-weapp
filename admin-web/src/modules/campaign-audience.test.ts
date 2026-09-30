import assert from 'node:assert/strict'
import { it } from 'node:test'
import { campaignAudienceLabel } from './admin-read-formatters.ts'

it('distinguishes selected recipients from a not-yet-created delivery snapshot', () => {
  assert.equal(campaignAudienceLabel({ audienceType: 'EXPLICIT', recipientRefs: ['opaque-ref'], recipientCount: 0, status: 'DRAFT' }), '指定 1 人')
  assert.equal(campaignAudienceLabel({ audienceType: 'EXPLICIT', recipientCount: 24, status: 'READY' }), '指定 24 人')
  assert.equal(campaignAudienceLabel({ audienceType: 'EXPLICIT', recipientCount: 0 }), '指定用户')
  assert.equal(campaignAudienceLabel({ audienceType: 'ALL', recipientCount: 0 }), '全部用户')
})
