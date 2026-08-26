'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createKnowledgeSchedulingService,
  normalizedWorkerItems,
} = require('../domain/knowledge-scheduling-service')

const APP_ID = 'wx0123456789abcdef'
const claim = Object.freeze({
  appId: APP_ID,
  categoryId: '20000000-0000-4000-8000-000000000001',
  endpointUrl: 'https://example.com/feed.json',
  fetchConfig: {},
  scheduleId: '30000000-0000-4000-8000-000000000001',
  sourceId: '10000000-0000-4000-8000-000000000001',
  sourceType: 'JSON_FEED',
})

describe('knowledge scheduling service', () => {
  it('forces worker items into the review-only free hotspot projection', () => {
    const items = normalizedWorkerItems([
      {
        accessType: 'MEMBER',
        bodyText: '',
        contentType: 'VIDEO',
        externalId: 'source-1',
        status: 'PUBLISHED',
        summary: '摘要',
        title: '热点',
      },
      { externalId: 'source-1', summary: '重复', title: '重复' },
    ], new Set(['example.com']))
    assert.equal(items.length, 1)
    assert.deepEqual({
      accessType: items[0].accessType,
      bodyText: items[0].bodyText,
      contentSafetyStatus: items[0].contentSafetyStatus,
      contentType: items[0].contentType,
      status: items[0].status,
    }, {
      accessType: 'FREE',
      bodyText: '摘要',
      contentSafetyStatus: 'PENDING',
      contentType: 'HOT_NEWS',
      status: 'PENDING_REVIEW',
    })
  })

  it('claims at most three sources and completes a validated feed', async () => {
    const calls = []
    const repository = {
      async claimDue(input) {
        calls.push(['claim', input])
        return { claims: [claim], reconciled: 1 }
      },
      async completeFailure() { throw new Error('NOT_EXPECTED') },
      async completeSuccess(actualClaim, items) {
        calls.push(['success', actualClaim, items])
        return { status: 'COMPLETED' }
      },
      async getWakePlan() { return { nextWakeAt: null } },
      async validateClaim() { return { status: 'RUNNABLE' } },
    }
    const service = createKnowledgeSchedulingService({
      fetchSource: async () => [{ externalId: 'item-1', summary: '摘要', title: '热点' }],
      repository,
      webviewAllowedHosts: new Set(['example.com']),
    })
    const result = await service.runDue({ appId: APP_ID, limit: 3 })
    assert.deepEqual(calls[0], ['claim', { appId: APP_ID, limit: 3 }])
    assert.equal(calls[1][2][0].contentType, 'HOT_NEWS')
    assert.deepEqual(result, {
      claimed: 1,
      completed: 1,
      failed: 0,
      leaseLost: 0,
      reconciled: 1,
      outcomes: [{ errorCode: null, nextRunAt: null, retryDisposition: null, status: 'COMPLETED' }],
    })
    await assert.rejects(() => service.runDue({ appId: APP_ID, limit: 4 }), /VALIDATION_FAILED/)
  })

  it('does not fetch after authorization revocation and persists a bounded failure', async () => {
    let fetched = 0
    const failures = []
    const service = createKnowledgeSchedulingService({
      async fetchSource() { fetched += 1; return [] },
      repository: {
        async claimDue() { return { claims: [claim], reconciled: 0 } },
        async completeFailure(actualClaim, code) {
          failures.push({ actualClaim, code })
          return { errorCode: code, retryDisposition: 'RETRY', status: 'FAILED' }
        },
        async completeSuccess() { throw new Error('NOT_EXPECTED') },
        async getWakePlan() { return { nextWakeAt: null } },
        async validateClaim() { return { status: 'BLOCKED' } },
      },
    })
    const result = await service.runDue({ appId: APP_ID, limit: 1 })
    assert.equal(fetched, 0)
    assert.equal(failures[0].code, 'KNOWLEDGE_SCHEDULE_AUTH_REVOKED')
    assert.equal(result.failed, 1)
  })
})
