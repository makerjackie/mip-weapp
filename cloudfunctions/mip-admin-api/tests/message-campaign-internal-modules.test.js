'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createMessageCampaignAudience,
} = require('../domain/message-campaign-audience')
const {
  createMessageCampaignRepository,
} = require('../domain/message-campaigns')
const {
  createMessageCampaignReadRepository,
} = require('../domain/repositories/message-campaigns')

const APP_ID = 'wx-message-module-test'
const CAMPAIGN_ID = '20000000-0000-4000-8000-000000000001'

describe('message campaign internal modules', () => {
  it('preserves the composed campaign repository interface', () => {
    const repository = createMessageCampaignRepository({}, {
      assertMutationScope() {},
      async lockMutationAuthorization() {},
    })

    assert.deepEqual(Object.keys(repository).sort(), [
      'cancelScheduledCampaign',
      'getCampaign',
      'getCampaignScope',
      'getMessageCampaignWakePlan',
      'listCampaigns',
      'listScopes',
      'publishCampaign',
      'runDueMessageCampaigns',
      'saveCampaign',
      'scheduleCampaign',
      'searchRecipients',
      'snapshotCampaign',
      'withdrawCampaign',
    ])
  })

  it('keeps the read seam limited to the existing campaign query methods', () => {
    const repository = createMessageCampaignReadRepository({})

    assert.deepEqual(Object.keys(repository).sort(), [
      'getCampaign',
      'getCampaignScope',
      'listCampaigns',
      'listScopes',
      'searchRecipients',
    ])
  })

  it('preserves scoped campaign and recipient query parameters', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }
    const repository = createMessageCampaignReadRepository(database)

    await repository.listCampaigns(
      APP_ID,
      { platform: false, branchIds: ['branch-a', 'branch-b'] },
      { status: 'READY', query: '活动_%' },
      20,
    )
    await repository.searchRecipients(
      APP_ID,
      { scopeType: 'BRANCH', scopeId: 'branch-a' },
      '成员_%',
      15,
    )

    assert.match(calls[0].sql, /campaign\.branch_id IN \(\?, \?\)/)
    assert.match(calls[0].sql, /INNER JOIN mip_inbox_messages ready_inbox/)
    assert.match(calls[0].sql, /INNER JOIN mip_delivery_tasks external_task/)
    assert.deepEqual(calls[0].params, [
      APP_ID,
      'branch-a',
      'branch-b',
      'READY',
      '%活动\\_\\%%',
      '%活动\\_\\%%',
      20,
    ])
    assert.match(calls[1].sql, /membership\.branch_id = \? AND membership\.status = 'ACTIVE'/)
    assert.deepEqual(calls[1].params, [
      'branch-a',
      APP_ID,
      '%成员\\_\\%%',
      '%成员\\_\\%%',
      15,
    ])
  })

  it('keeps transaction-local campaign locks on the campaign alias only', async () => {
    let captured
    const transaction = {
      async one(sql, params) {
        captured = { sql, params }
        return null
      },
    }
    const repository = createMessageCampaignReadRepository({})

    await repository.getCampaign(APP_ID, CAMPAIGN_ID, transaction, true)

    assert.match(captured.sql, /FOR UPDATE OF campaign$/)
    assert.deepEqual(captured.params, [APP_ID, CAMPAIGN_ID])
  })

  it('keeps audience validation and snapshot limits behind a two-method seam', async () => {
    const audience = createMessageCampaignAudience(2)
    assert.deepEqual(Object.keys(audience).sort(), [
      'assertDraftRecipients',
      'snapshotRecipients',
    ])

    const calls = []
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        return [
          { id: 'user-a' },
          { id: 'user-b' },
          { id: 'user-c' },
        ]
      },
    }
    await assert.rejects(
      audience.snapshotRecipients(tx, APP_ID, {
        scopeType: 'PLATFORM',
        audienceType: 'ALL',
      }),
      error => error.code === 'MESSAGE_RECIPIENT_LIMIT_EXCEEDED' && error.retryable === false,
    )
    assert.match(calls[0].sql, /mip_membership_entitlements/)
    assert.match(calls[0].sql, /ORDER BY user\.id LIMIT \? FOR UPDATE/)
    assert.deepEqual(calls[0].params, [APP_ID, 3])
  })

  it('validates explicit branch recipients under the same transaction locks', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return { id: 'branch-a' }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return [{ id: 'user-a' }, { id: 'user-b' }]
      },
    }
    const audience = createMessageCampaignAudience(10)

    await audience.assertDraftRecipients(tx, APP_ID, {
      scopeType: 'BRANCH',
      branchId: 'branch-a',
      audienceType: 'EXPLICIT',
      audienceUserIds: ['user-a', 'user-b'],
    })

    assert.match(calls[0].sql, /mip_city_branches/)
    assert.match(calls[0].sql, /FOR UPDATE$/)
    assert.deepEqual(calls[0].params, [APP_ID, 'branch-a'])
    assert.match(calls[1].sql, /mip_branch_memberships/)
    assert.match(calls[1].sql, /user\.id IN \(\?, \?\) FOR UPDATE/)
    assert.deepEqual(calls[1].params, [
      'branch-a',
      APP_ID,
      'user-a',
      'user-b',
    ])
  })
})
