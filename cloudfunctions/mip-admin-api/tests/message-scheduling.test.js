'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')

const { CAPABILITIES } = require('../domain/capabilities')
const {
  createMessageCampaignRepository,
  roundedWakeAt,
  scheduleRequestHash,
  scheduledPublicationHash,
} = require('../domain/message-campaigns')
const { operationByAction } = require('../domain/operation-registry')
const {
  normalizeOptionalDispatchVersion,
  normalizeScheduledFor,
} = require('../domain/message-campaign-validation')
const {
  signMessageDispatchRequest,
  verifyMessageDispatchRequest,
} = require('../lib/message-dispatch-auth')
const { createMessageDispatchRoute } = require('../lib/message-dispatch-route')

const root = path.resolve(__dirname, '../../..')
const APP_ID = 'wx-message-schedule'
const CAMPAIGN_ID = '20000000-0000-4000-8000-000000000001'
const DISPATCH_ID = '30000000-0000-4000-8000-000000000001'
const ACTOR_ID = '40000000-0000-4000-8000-000000000001'
const RECIPIENT_ID = '50000000-0000-4000-8000-000000000001'
const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const CURRENT_TIME = new Date('2030-08-25T10:00:00.000Z')

describe('message campaign scheduling safety', () => {
  it('authenticates the complete internal body and keeps runDue outside the public registry', () => {
    const secret = 'message-dispatch-test-secret-at-least-32-bytes'
    const request = {
      action: 'runDueMessageCampaigns',
      appId: APP_ID,
      limit: 5,
      drain: false,
      maxBatches: 1,
      timestamp: CURRENT_TIME.getTime(),
    }
    const signed = { ...request, signature: signMessageDispatchRequest(request, secret) }
    assert.deepEqual(verifyMessageDispatchRequest(signed, {
      secret,
      allowedAppIds: new Set([APP_ID]),
      now: () => CURRENT_TIME.getTime(),
    }), request)
    assert.throws(
      () => verifyMessageDispatchRequest({ ...signed, limit: 6 }, {
        secret, allowedAppIds: new Set([APP_ID]), now: () => CURRENT_TIME.getTime(),
      }),
      /FORBIDDEN/,
    )
    assert.throws(
      () => verifyMessageDispatchRequest({ ...signed, extra: true }, {
        secret, allowedAppIds: new Set([APP_ID]), now: () => CURRENT_TIME.getTime(),
      }),
      /FORBIDDEN/,
    )
    assert.throws(
      () => verifyMessageDispatchRequest({ ...signed, timestamp: CURRENT_TIME.getTime() - 300_001 }, {
        secret, allowedAppIds: new Set([APP_ID]), now: () => CURRENT_TIME.getTime(),
      }),
      /FORBIDDEN/,
    )
    assert.equal(operationByAction.runDueMessageCampaigns, undefined)

    const planRequest = {
      action: 'getMessageCampaignWakePlan',
      appId: APP_ID,
      timestamp: CURRENT_TIME.getTime(),
    }
    const signedPlan = {
      ...planRequest,
      signature: signMessageDispatchRequest(planRequest, secret),
    }
    assert.deepEqual(verifyMessageDispatchRequest(signedPlan, {
      secret,
      allowedAppIds: new Set([APP_ID]),
      now: () => CURRENT_TIME.getTime(),
    }), planRequest)
    assert.equal(operationByAction.getMessageCampaignWakePlan, undefined)
  })

  it('routes signed internal requests before user identity and returns bounded public error states', async () => {
    const secret = 'message-dispatch-route-secret-at-least-32-bytes'
    const repositoryCalls = []
    const planCalls = []
    const wakeupCalls = []
    const repository = {
      async runDueMessageCampaigns(input) {
        repositoryCalls.push(input)
        return {
          batches: 1,
          leased: 0,
          reconciled: 0,
          completed: 0,
          retryable: 0,
          terminal: 0,
          manualReview: 0,
          pendingReconciliation: 0,
        }
      },
      async getMessageCampaignWakePlan(input) {
        planCalls.push(input)
        return { nextWakeAt: '2030-08-25T10:05:00.000Z' }
      },
    }
    const route = createMessageDispatchRoute({
      allowedAppIds: new Set([APP_ID]),
      logger: { error() {} },
      now: () => CURRENT_TIME.getTime(),
      outboxWakeup: {
        async afterSuccessfulMutation(input) {
          wakeupCalls.push(input)
          return { status: 'FAILED' }
        },
      },
      repository,
      secret,
    })
    const request = {
      action: 'runDueMessageCampaigns',
      appId: APP_ID,
      limit: 5,
      drain: false,
      maxBatches: 1,
      timestamp: CURRENT_TIME.getTime(),
    }
    const signed = { ...request, signature: signMessageDispatchRequest(request, secret) }
    const success = await route(signed)
    assert.equal(success.ok, true)
    assert.equal(success.data.outboxWakeup, 'FAILED')
    assert.deepEqual(repositoryCalls, [{ appId: APP_ID, limit: 5, drain: false, maxBatches: 1 }])
    assert.deepEqual(planCalls, [{ appId: APP_ID }])
    assert.equal(success.data.nextWakeAt, '2030-08-25T10:05:00.000Z')
    assert.equal(wakeupCalls.length, 1)
    assert.equal(wakeupCalls[0].appId, APP_ID)
    assert.equal(wakeupCalls[0].mutationActions.has('runDueMessageCampaigns'), true)

    const forbidden = await route({ ...signed, limit: 6 })
    assert.deepEqual(forbidden, {
      ok: false,
      error: { code: 'FORBIDDEN', message: '内部调度请求未授权', retryable: false },
    })
    const invalidBody = { ...request, limit: 0 }
    const invalid = await route({
      ...invalidBody,
      signature: signMessageDispatchRequest(invalidBody, secret),
    })
    assert.deepEqual(invalid, {
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: '内部调度请求无效', retryable: false },
    })
    assert.equal(repositoryCalls.length, 1)
    assert.equal(wakeupCalls.length, 1)

    repository.runDueMessageCampaigns = async () => { throw new Error('MYSQL_UNAVAILABLE') }
    const unavailable = await route(signed)
    assert.deepEqual(unavailable, {
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '定时发布服务暂时不可用', retryable: true },
    })
    assert.equal(wakeupCalls.length, 1)

    repository.runDueMessageCampaigns = async () => ({ batches: 0 })
    const planBody = {
      action: 'getMessageCampaignWakePlan',
      appId: APP_ID,
      timestamp: CURRENT_TIME.getTime(),
    }
    const plan = await route({
      ...planBody,
      signature: signMessageDispatchRequest(planBody, secret),
    })
    assert.deepEqual(plan, { ok: true, data: { nextWakeAt: '2030-08-25T10:05:00.000Z' } })
    assert.equal(wakeupCalls.length, 1)

    const indexSource = fs.readFileSync(path.join(root, 'cloudfunctions/mip-admin-api/index.js'), 'utf8')
    const internalDispatchIndex = indexSource.indexOf('MESSAGE_DISPATCH_ACTIONS.has(event?.action)')
    assert.notEqual(internalDispatchIndex, -1)
    assert.ok(internalDispatchIndex < indexSource.indexOf('handler(event)'))
  })

  it('strictly parses a UTC instant while leaving the moving lead window to repository replay logic', () => {
    assert.equal(
      normalizeScheduledFor('2030-08-25T10:05:00.000Z', CURRENT_TIME).toISOString(),
      '2030-08-25T10:05:00.000Z',
    )
    assert.equal(
      normalizeScheduledFor('2030-08-25T10:04:59.999Z').toISOString(),
      '2030-08-25T10:04:59.999Z',
    )
    assert.throws(
      () => normalizeScheduledFor('2030-08-25T18:05:00+08:00', CURRENT_TIME),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.throws(
      () => normalizeScheduledFor('2100-01-01T00:00:00.000Z'),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.equal(roundedWakeAt('2030-08-25T10:05:00.001Z'), '2030-08-25T10:05:01.000Z')
    assert.equal(normalizeOptionalDispatchVersion(undefined), null)
    assert.equal(normalizeOptionalDispatchVersion(2), 2)
    assert.throws(
      () => normalizeOptionalDispatchVersion(0),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })

  it('plans the earliest scheduled, retryable, or expired-lease wake and rounds milliseconds up', async () => {
    const calls = []
    const repository = createMessageCampaignRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return { next_wake_at: new Date('2030-08-25T10:05:00.001Z') }
      },
    }, {
      assertMutationScope() {},
      lockMutationAuthorization() {},
    })
    assert.deepEqual(await repository.getMessageCampaignWakePlan({ appId: APP_ID }), {
      nextWakeAt: '2030-08-25T10:05:01.000Z',
    })
    assert.match(calls[0].sql, /GREATEST\(scheduled_for, available_at\)/)
    assert.match(calls[0].sql, /status IN \('SCHEDULED', 'FAILED'\)/)
    assert.match(calls[0].sql, /status = 'PROCESSING'/)
    assert.match(calls[0].sql, /lease_expires_at IS NOT NULL/)
    assert.deepEqual(calls[0].params, [APP_ID, 5, APP_ID])
  })

  it('creates a new schedule and campaign pointer atomically', async () => {
    const fixture = schedulerFixture({
      campaign: { activeDispatchId: null },
      dispatch: { status: 'CANCELLED', retryDisposition: 'TERMINAL' },
    })
    const result = await fixture.repository.scheduleCampaign(scheduleInput({
      expectedDispatchVersion: null,
    }))

    assert.equal(result.status, 'READY')
    assert.equal(result.version, 4)
    assert.equal(result.activeDispatch.status, 'SCHEDULED')
    assert.equal(result.activeDispatch.scheduledFor, '2030-08-25T10:05:00.000Z')
    assert.equal(fixture.state.campaign.activeDispatchId, fixture.state.dispatch.id)
    assert.equal(fixture.state.dispatch.status, 'SCHEDULED')
    assert.equal(fixture.state.dispatch.schedulerId, ACTOR_ID)
    assert.equal(fixture.state.dispatch.lastOutcome, 'NOT_ATTEMPTED')
    assert.equal(fixture.state.dispatch.retryDisposition, 'RETRIABLE')
    assert.equal(fixture.state.idempotency.get(
      'admin.messageCampaigns.schedule:schedule-campaign-001',
    ).status, 'COMPLETED')
  })

  it('replays completed schedule requests after the lead window for string and object JSON values', async () => {
    for (const responseJson of [JSON.stringify({ campaignId: CAMPAIGN_ID }), { campaignId: CAMPAIGN_ID }]) {
      const fixture = schedulerFixture()
      const input = scheduleInput({
        scheduledFor: new Date('2030-08-25T10:01:00.000Z'),
        idempotencyKey: 'schedule-replay-001',
      })
      fixture.state.idempotency.set('admin.messageCampaigns.schedule:schedule-replay-001', {
        request_hash: scheduleRequestHash(input),
        status: 'COMPLETED',
        response_json: responseJson,
      })
      const replay = await fixture.repository.scheduleCampaign(input)
      assert.equal(replay.id, CAMPAIGN_ID)
      assert.equal(fixture.state.dispatch.version, 1)

      await assert.rejects(
        () => fixture.repository.scheduleCampaign(scheduleInput({
          scheduledFor: new Date('2030-08-25T10:01:00.000Z'),
          idempotencyKey: 'schedule-new-too-soon',
        })),
        error => error?.code === 'VALIDATION_FAILED',
      )
      assert.equal(fixture.state.idempotency.has(
        'admin.messageCampaigns.schedule:schedule-new-too-soon',
      ), false)
    }
  })

  it('rejects public publish, cancel, and replacement when an active lease or manual review owns the campaign', async () => {
    const active = schedulerFixture()
    await assert.rejects(
      () => active.repository.publishCampaign(publishInput()),
      error => error?.code === 'MESSAGE_SCHEDULE_ACTIVE',
    )
    assert.equal(active.state.facts.length, 0)

    active.state.dispatch.status = 'PROCESSING'
    active.state.dispatch.leaseToken = 'active-lease'
    active.state.dispatch.leaseExpiresAt = new Date('2030-08-25T10:02:00.000Z')
    active.state.dispatch.lastOutcome = 'UNKNOWN'
    active.state.dispatch.retryDisposition = 'MANUAL_REVIEW'
    await assert.rejects(
      () => active.repository.cancelScheduledCampaign(cancelInput()),
      error => error?.code === 'MESSAGE_SCHEDULE_BUSY',
    )

    const manual = schedulerFixture({
      dispatch: {
        status: 'FAILED',
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        lastErrorCode: 'MESSAGE_SCHEDULE_OUTCOME_UNKNOWN',
      },
    })
    await assert.rejects(
      () => manual.repository.scheduleCampaign(scheduleInput({ expectedDispatchVersion: 1 })),
      error => error?.code === 'MESSAGE_SCHEDULE_MANUAL_REVIEW_REQUIRED',
    )
    await assert.rejects(
      () => manual.repository.cancelScheduledCampaign(cancelInput()),
      error => error?.code === 'MESSAGE_SCHEDULE_MANUAL_REVIEW_REQUIRED',
    )
  })

  it('preserves known-failure evidence when cancelling or replacing a terminal plan', async () => {
    for (const replace of [false, true]) {
      const fixture = schedulerFixture({
        dispatch: {
          status: 'FAILED',
          lastOutcome: 'KNOWN_FAILED',
          retryDisposition: 'TERMINAL',
          lastErrorCode: 'PROVIDER_REJECTED',
        },
      })
      if (replace) {
        await fixture.repository.scheduleCampaign(scheduleInput({ expectedDispatchVersion: 1 }))
      }
      else {
        await fixture.repository.cancelScheduledCampaign(cancelInput())
      }
      const evidence = replace ? fixture.state.lastCancelled : fixture.state.dispatch
      assert.equal(evidence.status, 'CANCELLED')
      assert.equal(evidence.lastOutcome, 'KNOWN_FAILED')
      assert.equal(evidence.lastErrorCode, 'PROVIDER_REJECTED')
      assert.equal(evidence.retryDisposition, 'TERMINAL')
    }
  })

  it('allows two runners to materialize a due campaign only once', async () => {
    const fixture = schedulerFixture()
    const [left, right] = await Promise.all([
      fixture.repository.runDueMessageCampaigns(runInput()),
      fixture.repository.runDueMessageCampaigns(runInput()),
    ])

    assert.equal(left.completed + right.completed, 1)
    assert.equal(left.leased + right.leased, 1)
    assert.equal(fixture.state.facts.length, 1)
    assert.equal(fixture.state.campaign.status, 'PUBLISHED')
    assert.equal(fixture.state.campaign.activeDispatchId, null)
    assert.equal(fixture.state.dispatch.status, 'COMPLETED')
    assert.equal(fixture.state.dispatch.attempts, 1)
    assert.equal(fixture.state.dispatch.lastOutcome, 'SUCCEEDED')
    assert.equal(fixture.state.dispatch.retryDisposition, 'TERMINAL')
  })

  it('converges cancel-versus-due races to one terminal outcome', async () => {
    for (const cancelFirst of [false, true]) {
      const fixture = schedulerFixture()
      const cancel = () => fixture.repository.cancelScheduledCampaign(cancelInput())
      const due = () => fixture.repository.runDueMessageCampaigns(runInput())
      const results = await Promise.allSettled(cancelFirst ? [cancel(), due()] : [due(), cancel()])
      const finalStatus = fixture.state.dispatch.status
      assert.equal(['CANCELLED', 'COMPLETED'].includes(finalStatus), true)
      assert.equal(fixture.state.facts.length, finalStatus === 'COMPLETED' ? 1 : 0)
      assert.equal(fixture.state.campaign.status, finalStatus === 'COMPLETED' ? 'PUBLISHED' : 'READY')
      assert.equal(fixture.state.campaign.activeDispatchId, null)
      assert.equal(results.some(result => result.status === 'fulfilled'), true)
      assert.equal(results.filter(result => result.status === 'rejected').length <= 1, true)
    }
  })

  it('reconciles an exact withdrawn publication as completed', async () => {
    const fixture = schedulerFixture({
      campaign: {
        status: 'WITHDRAWN',
        activeDispatchId: null,
        publishedAt: new Date('2030-08-25T09:30:00.000Z'),
        publishIdempotencyKey: `dispatch:${DISPATCH_ID}`,
        publishRequestHash: scheduledPublicationHash(DISPATCH_ID, CAMPAIGN_ID),
        version: 5,
      },
      dispatch: {
        status: 'PROCESSING',
        attempts: 1,
        leaseToken: 'expired-lease',
        leaseExpiresAt: new Date('2030-08-25T09:59:00.000Z'),
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        version: 2,
      },
      facts: [RECIPIENT_ID],
    })

    const result = await fixture.repository.runDueMessageCampaigns(runInput())
    assert.equal(result.completed, 1)
    assert.equal(result.manualReview, 0)
    assert.equal(fixture.state.dispatch.status, 'COMPLETED')
    assert.equal(fixture.state.dispatch.lastOutcome, 'SUCCEEDED')
  })

  it('terminalizes a deterministic invalid snapshot without waiting for lease expiry', async () => {
    const fixture = schedulerFixture({ recipients: [] })
    const result = await fixture.repository.runDueMessageCampaigns(runInput())

    assert.equal(result.terminal, 1)
    assert.equal(result.pendingReconciliation, 0)
    assert.equal(fixture.state.dispatch.status, 'FAILED')
    assert.equal(fixture.state.dispatch.lastOutcome, 'NOT_ATTEMPTED')
    assert.equal(fixture.state.dispatch.retryDisposition, 'TERMINAL')
    assert.equal(fixture.state.dispatch.lastErrorCode, 'MESSAGE_RECIPIENT_SNAPSHOT_INVALID')
    assert.equal(fixture.state.facts.length, 0)
    assert.equal(fixture.state.campaign.status, 'READY')
  })

  it('safely retries an expired no-fact lease, exhausts attempts, and quarantines partial facts', async () => {
    const retry = schedulerFixture({
      dispatch: {
        status: 'PROCESSING',
        attempts: 1,
        leaseToken: 'expired-lease',
        leaseExpiresAt: new Date('2030-08-25T09:59:00.000Z'),
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        version: 2,
      },
    })
    const retried = await retry.repository.runDueMessageCampaigns(runInput())
    assert.equal(retried.retryable, 1)
    assert.equal(retried.completed, 1)
    assert.equal(retry.state.dispatch.attempts, 2)

    const exhausted = schedulerFixture({
      dispatch: {
        status: 'PROCESSING',
        attempts: 5,
        leaseToken: 'expired-lease',
        leaseExpiresAt: new Date('2030-08-25T09:59:00.000Z'),
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        version: 6,
      },
    })
    const terminal = await exhausted.repository.runDueMessageCampaigns(runInput())
    assert.equal(terminal.terminal, 1)
    assert.equal(exhausted.state.dispatch.status, 'FAILED')
    assert.equal(exhausted.state.dispatch.lastOutcome, 'NOT_ATTEMPTED')
    assert.equal(exhausted.state.dispatch.retryDisposition, 'TERMINAL')
    assert.equal(exhausted.state.dispatch.lastErrorCode, 'MESSAGE_SCHEDULE_ATTEMPTS_EXHAUSTED')

    const partial = schedulerFixture({
      campaign: { recipientCount: 2 },
      dispatch: {
        status: 'PROCESSING',
        attempts: 1,
        leaseToken: 'expired-lease',
        leaseExpiresAt: new Date('2030-08-25T09:59:00.000Z'),
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        version: 2,
      },
      facts: [RECIPIENT_ID],
    })
    const quarantined = await partial.repository.runDueMessageCampaigns(runInput())
    assert.equal(quarantined.manualReview, 1)
    assert.equal(partial.state.dispatch.lastOutcome, 'UNKNOWN')
    assert.equal(partial.state.dispatch.retryDisposition, 'MANUAL_REVIEW')

    const missingOutbox = schedulerFixture({
      campaign: {
        status: 'PUBLISHED',
        activeDispatchId: null,
        publishedAt: new Date('2030-08-25T09:30:00.000Z'),
        publishIdempotencyKey: `dispatch:${DISPATCH_ID}`,
        publishRequestHash: scheduledPublicationHash(DISPATCH_ID, CAMPAIGN_ID),
        version: 4,
      },
      dispatch: {
        status: 'PROCESSING',
        attempts: 1,
        leaseToken: 'expired-lease',
        leaseExpiresAt: new Date('2030-08-25T09:59:00.000Z'),
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
        version: 2,
      },
      facts: [RECIPIENT_ID],
      outboxFacts: [],
    })
    const incomplete = await missingOutbox.repository.runDueMessageCampaigns(runInput())
    assert.equal(incomplete.manualReview, 1)
    assert.equal(missingOutbox.state.dispatch.status, 'FAILED')
    assert.equal(missingOutbox.state.dispatch.lastOutcome, 'UNKNOWN')
  })

  it('rolls publication facts back when dispatch completion CAS fails', async () => {
    const fixture = schedulerFixture({ failCompletion: true })
    const result = await fixture.repository.runDueMessageCampaigns(runInput())
    assert.equal(result.pendingReconciliation, 1)
    assert.equal(fixture.state.facts.length, 0)
    assert.equal(fixture.state.campaign.status, 'READY')
    assert.equal(fixture.state.campaign.activeDispatchId, DISPATCH_ID)
    assert.equal(fixture.state.dispatch.status, 'PROCESSING')
  })

  it('counts manual review returned during execution and terminalizes revoked scheduling authority', async () => {
    const inconsistent = schedulerFixture({ invalidateAfterClaim: true })
    const manual = await inconsistent.repository.runDueMessageCampaigns(runInput())
    assert.equal(manual.manualReview, 1)
    assert.equal(inconsistent.state.dispatch.retryDisposition, 'MANUAL_REVIEW')

    const revoked = schedulerFixture({ roleActive: false })
    const terminal = await revoked.repository.runDueMessageCampaigns(runInput())
    assert.equal(terminal.terminal, 1)
    assert.equal(revoked.state.dispatch.status, 'FAILED')
    assert.equal(revoked.state.dispatch.lastOutcome, 'NOT_ATTEMPTED')
    assert.equal(revoked.state.dispatch.retryDisposition, 'TERMINAL')
    assert.equal(revoked.state.dispatch.lastErrorCode, 'MESSAGE_SCHEDULE_AUTH_REVOKED')
  })

  it('keeps mutation and execution lock order aligned with bounded skip-locked claims and DB retries', () => {
    const source = fs.readFileSync(path.join(root, 'cloudfunctions/mip-admin-api/domain/message-campaigns.js'), 'utf8')
    const mysql = fs.readFileSync(path.join(root, 'cloudfunctions/mip-admin-api/lib/mysql.js'), 'utf8')
    const mutationLock = functionBody(source, 'async function lockCampaignMutationState')
    assert.ok(mutationLock.indexOf('lockDispatch(') < mutationLock.indexOf('lockPublicationCampaign('))
    const execution = functionBody(source, 'async function executeClaimedDispatch')
    assert.ok(execution.indexOf('lockClaimedDispatch(') < execution.indexOf('lockPublicationCampaign('))
    assert.ok(execution.indexOf('lockPublicationCampaign(') < execution.indexOf('lockScheduledAuthorization('))
    assert.ok(execution.indexOf('lockScheduledAuthorization(') < execution.indexOf('materializeCampaignPublication('))
    assert.match(source, /FOR UPDATE SKIP LOCKED/)
    assert.match(source, /active_dispatch_id = NULL/)
    assert.match(source, /last_outcome = 'SUCCEEDED', retry_disposition = 'TERMINAL'/)
    const audienceSource = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-admin-api/domain/message-campaign-audience.js'),
      'utf8',
    )
    const snapshotSelection = functionBody(audienceSource, 'async function selectSnapshotRecipients')
    const explicitSelection = snapshotSelection.slice(0, snapshotSelection.indexOf("if (campaign.scopeType === 'BRANCH')"))
    assert.equal((explicitSelection.match(/WHERE user\.app_id = \?/g) || []).length, 1)
    assert.match(mysql, /async function transaction\(work, attempts = 3\)/)
    assert.match(mysql, /ER_LOCK_DEADLOCK/)
    assert.match(mysql, /ER_LOCK_WAIT_TIMEOUT/)
    const route = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-admin-api/lib/message-dispatch-route.js'),
      'utf8',
    )
    const cli = fs.readFileSync(path.join(root, 'scripts/run-message-campaigns.mjs'), 'utf8')
    const internalRun = functionBody(route, 'return async function runDueMessageCampaigns')
    assert.doesNotMatch(internalRun, /data\.completed > 0/)
    assert.match(internalRun, /outboxWakeup\.afterSuccessfulMutation/)
    assert.match(cli, /output\.outboxWakeup === 'FAILED'/)
  })
})

function runInput() {
  return { appId: APP_ID, limit: 10, drain: false, maxBatches: 1 }
}

function scheduleInput(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    campaignId: CAMPAIGN_ID,
    expectedVersion: 3,
    expectedDispatchVersion: null,
    scheduledFor: new Date('2030-08-25T10:05:00.000Z'),
    idempotencyKey: 'schedule-campaign-001',
    authorization: {
      capability: CAPABILITIES.MESSAGES_MANAGE,
      effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    },
    authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
    audit: (resourceId, action, metadata) => ({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      effectiveRole: 'PLATFORM_OPERATIONS',
      resourceId,
      action,
      metadata,
    }),
    ...overrides,
  }
}

function publishInput() {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    campaignId: CAMPAIGN_ID,
    expectedVersion: 3,
    idempotencyKey: 'publish-campaign-001',
    authorization: {
      capability: CAPABILITIES.MESSAGES_MANAGE,
      effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    },
    authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
    audit: (resourceId, action, metadata) => ({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      effectiveRole: 'PLATFORM_OPERATIONS',
      resourceId,
      action,
      metadata,
    }),
  }
}

function cancelInput() {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    campaignId: CAMPAIGN_ID,
    expectedVersion: 3,
    expectedDispatchVersion: 1,
    reason: '调整发布时间',
    idempotencyKey: 'cancel-schedule-race-001',
    authorization: {
      capability: CAPABILITIES.MESSAGES_MANAGE,
      effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    },
    authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
    audit: (resourceId, action, metadata) => ({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      effectiveRole: 'PLATFORM_OPERATIONS',
      resourceId,
      action,
      metadata,
    }),
  }
}

function schedulerFixture(overrides = {}) {
  const state = {
    campaign: {
      id: CAMPAIGN_ID,
      status: 'READY',
      activeDispatchId: DISPATCH_ID,
      recipientCount: 1,
      publishedAt: null,
      publishIdempotencyKey: null,
      publishRequestHash: null,
      version: 3,
      ...overrides.campaign,
    },
    dispatch: {
      id: DISPATCH_ID,
      campaignId: CAMPAIGN_ID,
      schedulerId: ACTOR_ID,
      status: 'SCHEDULED',
      scheduledFor: new Date('2030-08-25T09:00:00.000Z'),
      availableAt: new Date('2030-08-25T09:00:00.000Z'),
      attempts: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      lastOutcome: 'NOT_ATTEMPTED',
      retryDisposition: 'RETRIABLE',
      lastErrorCode: null,
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      version: 1,
      updatedAt: new Date('2030-08-25T09:00:00.000Z'),
      ...overrides.dispatch,
    },
    facts: [...(overrides.facts || [])],
    outboxFacts: [...(overrides.outboxFacts ?? overrides.facts ?? [])],
    recipients: [...(overrides.recipients ?? [RECIPIENT_ID])],
    idempotency: new Map(),
    roleActive: overrides.roleActive !== false,
    invalidateAfterClaim: overrides.invalidateAfterClaim === true,
    failCompletion: overrides.failCompletion === true,
    lastCancelled: null,
    nextId: 0,
  }
  const database = memoryDatabase(state)
  const repository = createMessageCampaignRepository(database, {
    createId: () => `90000000-0000-4000-8000-${String(++state.nextId).padStart(12, '0')}`,
    now: () => new Date(CURRENT_TIME),
    clock: () => CURRENT_TIME.getTime(),
    lockMutationAuthorization: async (_tx, input) => input.authorization,
    assertMutationScope(authorization, scope) {
      if (authorization?.capability !== CAPABILITIES.MESSAGES_MANAGE
        || scope.scopeType !== 'PLATFORM') {
        throw new Error('FORBIDDEN')
      }
    },
  })
  return { state, repository }
}

function memoryDatabase(state) {
  let tail = Promise.resolve()
  return {
    one: (sql, params) => one(sql, params),
    query: (sql, params) => query(sql, params),
    async transaction(work) {
      let release
      const next = new Promise(resolve => { release = resolve })
      const previous = tail
      tail = next
      await previous
      const snapshot = structuredClone(state)
      try {
        return await work({ one, query })
      }
      catch (error) {
        restore(state, snapshot)
        throw error
      }
      finally {
        release()
      }
    },
  }

  async function one(sql, params = []) {
    if (sql.includes('FROM mip_idempotency_keys')) {
      return state.idempotency.get(`${params[2]}:${params[3]}`) || null
    }
    if (sql.includes('SELECT active_dispatch_id FROM mip_message_campaigns')) {
      return state.campaign ? { active_dispatch_id: state.campaign.activeDispatchId } : null
    }
    if (sql.includes('FROM mip_message_campaign_dispatches')) return dispatchRow(state.dispatch)
    if (sql.includes('FROM mip_message_campaigns campaign')) return campaignRow(state)
    if (sql.includes('FROM mip_message_campaigns')) return publicationCampaignRow(state.campaign)
    if (sql.includes('AS submitted_count')) {
      return {
        submitted_count: state.facts.length,
        outbox_covered_count: new Set(
          state.outboxFacts.filter(userId => state.facts.includes(userId)),
        ).size,
        outbox_count: state.outboxFacts.length,
      }
    }
    if (sql.includes('FROM mip_users')) {
      return state.roleActive ? { id: ACTOR_ID, status: 'ACTIVE' } : { id: ACTOR_ID, status: 'SUSPENDED' }
    }
    throw new Error(`UNHANDLED_ONE:${compact(sql)}`)
  }

  async function query(sql, params = []) {
    if (sql.includes("status = 'PROCESSING' AND lease_expires_at <= ?")) {
      const due = state.dispatch.status === 'PROCESSING'
        && state.dispatch.leaseExpiresAt <= params[1]
      return due ? [dispatchRow(state.dispatch)] : []
    }
    if (sql.includes("AND status IN ('SCHEDULED', 'FAILED')")
      && sql.includes('FOR UPDATE SKIP LOCKED')) {
      const due = ['SCHEDULED', 'FAILED'].includes(state.dispatch.status)
        && state.dispatch.retryDisposition === 'RETRIABLE'
        && state.dispatch.attempts < 5
        && state.dispatch.scheduledFor <= params[2]
        && state.dispatch.availableAt <= params[3]
      return due ? [{
        id: state.dispatch.id,
        campaign_id: state.dispatch.campaignId,
        version: state.dispatch.version,
      }] : []
    }
    if (sql.includes('FROM mip_admin_role_bindings')) {
      return state.roleActive ? [{
        scope_type: 'PLATFORM',
        scope_id: PLATFORM_SCOPE_ID,
        role_key: 'PLATFORM_OPERATIONS',
        status: 'ACTIVE',
        policy_capabilities_json: null,
      }] : []
    }
    if (sql.includes('FROM mip_message_campaign_recipients')) {
      return state.recipients.map(recipient_user_id => ({ recipient_user_id }))
    }
    if (sql.includes('INSERT INTO mip_idempotency_keys')) {
      const key = `${params[3]}:${params[4]}`
      if (state.idempotency.has(key)) {
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      state.idempotency.set(key, {
        request_hash: params[5],
        status: 'RUNNING',
        response_json: null,
      })
      return { affectedRows: 1 }
    }
    if (sql.includes("UPDATE mip_idempotency_keys SET status = 'COMPLETED'")) {
      const key = `${params[3]}:${params[4]}`
      const stored = state.idempotency.get(key)
      if (!stored || stored.request_hash !== params[5] || stored.status !== 'RUNNING') {
        return { affectedRows: 0 }
      }
      stored.status = 'COMPLETED'
      stored.response_json = params[0]
      return { affectedRows: 1 }
    }
    if (sql.includes("SET retry_disposition = 'TERMINAL'")
      && sql.includes('attempts >= ?')) return { affectedRows: 0 }
    if (sql.includes("SET status = 'PROCESSING'")) {
      if (!['SCHEDULED', 'FAILED'].includes(state.dispatch.status)
        || state.dispatch.retryDisposition !== 'RETRIABLE') return { affectedRows: 0 }
      state.dispatch.status = 'PROCESSING'
      state.dispatch.attempts += 1
      state.dispatch.leaseToken = params[0]
      state.dispatch.leaseExpiresAt = params[1]
      state.dispatch.lastErrorCode = null
      state.dispatch.lastOutcome = 'UNKNOWN'
      state.dispatch.retryDisposition = 'MANUAL_REVIEW'
      state.dispatch.version += 1
      if (state.invalidateAfterClaim) state.campaign.activeDispatchId = 'other-dispatch'
      return { affectedRows: 1 }
    }
    if (sql.includes("SET status = 'COMPLETED'")) {
      if (state.dispatch.status !== 'PROCESSING' || state.failCompletion) return { affectedRows: 0 }
      state.dispatch.status = 'COMPLETED'
      state.dispatch.completedAt = params[0]
      state.dispatch.leaseToken = null
      state.dispatch.leaseExpiresAt = null
      state.dispatch.lastErrorCode = null
      state.dispatch.lastOutcome = 'SUCCEEDED'
      state.dispatch.retryDisposition = 'TERMINAL'
      state.dispatch.version += 1
      return { affectedRows: 1 }
    }
    if (sql.includes("SET status = 'CANCELLED'")) {
      if (!['SCHEDULED', 'FAILED'].includes(state.dispatch.status)
        || state.dispatch.retryDisposition === 'MANUAL_REVIEW') return { affectedRows: 0 }
      const priorOutcome = state.dispatch.lastOutcome
      const priorErrorCode = state.dispatch.lastErrorCode
      state.dispatch.status = 'CANCELLED'
      state.dispatch.cancelledAt = params[1]
      state.dispatch.cancellationReason = sql.includes('REPLACED_BY_NEW_SCHEDULE')
        ? 'REPLACED_BY_NEW_SCHEDULE'
        : params[2]
      state.dispatch.lastOutcome = priorOutcome === 'KNOWN_FAILED' ? 'KNOWN_FAILED' : 'NOT_ATTEMPTED'
      state.dispatch.lastErrorCode = priorOutcome === 'KNOWN_FAILED' ? priorErrorCode : null
      state.dispatch.retryDisposition = 'TERMINAL'
      state.dispatch.leaseToken = null
      state.dispatch.leaseExpiresAt = null
      state.dispatch.version += 1
      state.lastCancelled = structuredClone(state.dispatch)
      return { affectedRows: 1 }
    }
    if (sql.includes("SET status = 'FAILED'")) {
      if (state.dispatch.status !== 'PROCESSING') return { affectedRows: 0 }
      state.dispatch.status = 'FAILED'
      state.dispatch.leaseToken = null
      state.dispatch.leaseExpiresAt = null
      state.dispatch.lastErrorCode = sql.includes('available_at = ?') ? params[1] : params[0]
      state.dispatch.lastOutcome = sql.includes("last_outcome = 'KNOWN_FAILED'")
        ? 'KNOWN_FAILED'
        : sql.includes("last_outcome = 'UNKNOWN'") ? 'UNKNOWN' : 'NOT_ATTEMPTED'
      state.dispatch.retryDisposition = sql.includes("retry_disposition = 'MANUAL_REVIEW'")
        ? 'MANUAL_REVIEW'
        : sql.includes('retry_disposition = ?') ? params[2] : 'TERMINAL'
      state.dispatch.version += 1
      return { affectedRows: 1 }
    }
    if (sql.includes("SET status = 'PUBLISHED'")) {
      if (state.campaign.status !== 'READY') return { affectedRows: 0 }
      state.campaign.status = 'PUBLISHED'
      state.campaign.publishedAt = params[0]
      state.campaign.publishIdempotencyKey = params[2]
      state.campaign.publishRequestHash = params[3]
      state.campaign.activeDispatchId = null
      state.campaign.version += 1
      return { affectedRows: 1 }
    }
    if (sql.includes('INSERT INTO mip_message_campaign_dispatches')) {
      state.dispatch = {
        id: params[0],
        campaignId: params[2],
        schedulerId: params[5],
        status: 'SCHEDULED',
        scheduledFor: params[3],
        availableAt: params[4],
        attempts: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        lastOutcome: 'NOT_ATTEMPTED',
        retryDisposition: 'RETRIABLE',
        lastErrorCode: null,
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        version: 1,
        updatedAt: CURRENT_TIME,
      }
      return { affectedRows: 1 }
    }
    if (sql.includes('SET active_dispatch_id = ?')) {
      if (state.campaign.status !== 'READY') return { affectedRows: 0 }
      state.campaign.activeDispatchId = params[0]
      state.campaign.version += 1
      return { affectedRows: 1 }
    }
    if (sql.includes('SET active_dispatch_id = NULL')) {
      if (state.campaign.status !== 'READY') return { affectedRows: 0 }
      state.campaign.activeDispatchId = null
      state.campaign.version += 1
      return { affectedRows: 1 }
    }
    if (sql.includes('INSERT INTO mip_operations_messages')) {
      state.facts.push(...state.recipients)
      return { affectedRows: state.recipients.length }
    }
    if (sql.includes('INSERT INTO mip_outbox_events')) {
      state.outboxFacts.push(...state.recipients)
      return { affectedRows: state.recipients.length }
    }
    if (sql.includes('INSERT INTO mip_audit_logs')) return { affectedRows: 1 }
    throw new Error(`UNHANDLED_QUERY:${compact(sql)}`)
  }
}

function campaignRow(state) {
  const dispatch = state.campaign.activeDispatchId === state.dispatch.id ? state.dispatch : null
  return {
    id: state.campaign.id,
    scope_type: 'PLATFORM',
    branch_id: null,
    branch_name: '',
    audience_type: 'ALL',
    audience_user_ids_json: '[]',
    name: '定时发布测试',
    title: '活动安排已更新',
    body: '请查看最新安排。',
    status: state.campaign.status,
    content_safety_status: 'PASSED',
    recipient_count: state.campaign.recipientCount,
    submitted_count: state.facts.length,
    inbox_ready_count: 0,
    failed_count: 0,
    outbox_pending_count: state.facts.length,
    outbox_processing_count: 0,
    outbox_retrying_count: 0,
    outbox_delivered_count: 0,
    outbox_terminal_count: 0,
    external_task_pending_count: 0,
    external_task_processing_count: 0,
    external_task_retrying_count: 0,
    external_task_delivered_count: 0,
    external_task_terminal_count: 0,
    snapshot_at: new Date('2030-08-25T08:00:00.000Z'),
    published_at: state.campaign.publishedAt,
    withdrawn_at: state.campaign.status === 'WITHDRAWN' ? CURRENT_TIME : null,
    withdrawal_reason: null,
    publish_idempotency_key: state.campaign.publishIdempotencyKey,
    publish_request_hash: state.campaign.publishRequestHash,
    active_dispatch_id: state.campaign.activeDispatchId,
    active_dispatch_status: dispatch?.status || null,
    active_dispatch_scheduled_for: dispatch?.scheduledFor || null,
    active_dispatch_attempts: dispatch?.attempts || 0,
    active_dispatch_last_outcome: dispatch?.lastOutcome || null,
    active_dispatch_retry_disposition: dispatch?.retryDisposition || null,
    active_dispatch_last_error_code: dispatch?.lastErrorCode || null,
    active_dispatch_version: dispatch?.version || null,
    active_dispatch_updated_at: dispatch?.updatedAt || null,
    version: state.campaign.version,
    updated_at: CURRENT_TIME,
  }
}

function publicationCampaignRow(campaign) {
  return {
    id: campaign.id,
    scope_type: 'PLATFORM',
    branch_id: null,
    title: '活动安排已更新',
    body: '请查看最新安排。',
    status: campaign.status,
    recipient_count: campaign.recipientCount,
    publish_idempotency_key: campaign.publishIdempotencyKey,
    publish_request_hash: campaign.publishRequestHash,
    active_dispatch_id: campaign.activeDispatchId,
    published_at: campaign.publishedAt,
    version: campaign.version,
  }
}

function dispatchRow(dispatch) {
  return {
    id: dispatch.id,
    campaign_id: dispatch.campaignId,
    scheduled_by_user_id: dispatch.schedulerId,
    status: dispatch.status,
    scheduled_for: dispatch.scheduledFor,
    available_at: dispatch.availableAt,
    attempts: dispatch.attempts,
    lease_token: dispatch.leaseToken,
    lease_expires_at: dispatch.leaseExpiresAt,
    last_outcome: dispatch.lastOutcome,
    retry_disposition: dispatch.retryDisposition,
    last_error_code: dispatch.lastErrorCode,
    version: dispatch.version,
    updated_at: dispatch.updatedAt,
  }
}

function restore(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, snapshot)
}

function compact(sql) {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 140)
}

function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1)
  const next = source.indexOf('\n  async function ', start + signature.length)
  return source.slice(start, next === -1 ? source.length : next)
}
