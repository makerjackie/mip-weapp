'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { CAPABILITIES, capabilitiesForBinding, coversScope } = require('./capabilities')

const MAX_EXPLICIT_RECIPIENTS = 100
const MAX_SNAPSHOT_RECIPIENTS = 1000
const MAX_DISPATCH_ATTEMPTS = 5
const MIN_SCHEDULE_DELAY_MS = 5 * 60 * 1000
const DISPATCH_LEASE_MS = 2 * 60 * 1000
const DISPATCH_RUN_DEADLINE_MS = 45 * 1000
const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const SCHEDULE_OPERATION = 'admin.messageCampaigns.schedule'
const CANCEL_SCHEDULE_OPERATION = 'admin.messageCampaigns.cancelSchedule'
const TERMINAL_DISPATCH_ERRORS = new Set([
  'MESSAGE_RECIPIENT_SNAPSHOT_INVALID',
])

function createMessageCampaignRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  const clock = options.clock || Date.now
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  const maximumRecipients = boundedMaximum(options.maximumRecipients)
  if (typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Message campaign mutation authorization is invalid')
  }

  async function listScopes(appId, visibility) {
    const rows = visibility.platform
      ? await database.query(
          `SELECT id, name FROM mip_city_branches
           WHERE app_id = ? AND status = 'ACTIVE' ORDER BY city_name, name, id`,
          [appId],
        )
      : visibility.branchIds.length
        ? await database.query(
            `SELECT id, name FROM mip_city_branches
             WHERE app_id = ? AND status = 'ACTIVE'
               AND id IN (${placeholders(visibility.branchIds)})
             ORDER BY city_name, name, id`,
            [appId, ...visibility.branchIds],
          )
        : []
    return {
      platform: visibility.platform,
      branches: rows.map(row => ({ id: String(row.id), name: String(row.name) })),
    }
  }

  async function listCampaigns(appId, visibility, filters, pageLimit) {
    const visible = visibleWhere(visibility)
    const clauses = ['campaign.app_id = ?', visible.sql]
    const params = [appId, ...visible.params]
    if (filters.status) {
      clauses.push('campaign.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query)}%`
      clauses.push('(campaign.name LIKE ? OR campaign.title LIKE ?)')
      params.push(pattern, pattern)
    }
    const rows = await database.query(
      `${campaignSelect(false)}
       WHERE ${clauses.join(' AND ')}
       ORDER BY campaign.updated_at DESC, campaign.id DESC LIMIT ?`,
      [...params, pageLimit],
    )
    return rows.map(campaignDto)
  }

  async function getCampaign(appId, campaignId, adapter = database, lock = false) {
    const row = await adapter.one(
      `${campaignSelect(true)}
       WHERE campaign.app_id = ? AND campaign.id = ?${lock ? ' FOR UPDATE' : ''}`,
      [appId, campaignId],
    )
    return row ? campaignDto(row) : null
  }

  async function getCampaignScope(appId, campaignId) {
    const row = await database.one(
      `SELECT scope_type, branch_id, status
       FROM mip_message_campaigns WHERE app_id = ? AND id = ?`,
      [appId, campaignId],
    )
    return row
      ? { scopeType: row.scope_type, scopeId: row.scope_type === 'BRANCH' ? row.branch_id : null, status: row.status }
      : null
  }

  async function searchRecipients(appId, scope, query, pageLimit) {
    const params = []
    const clauses = ["user.app_id = ?", "user.status = 'ACTIVE'", "NULLIF(TRIM(profile.nickname), '') IS NOT NULL"]
    let branchJoin = ''
    if (scope.scopeType === 'BRANCH') {
      branchJoin = `INNER JOIN mip_branch_memberships membership
        ON membership.app_id = user.app_id AND membership.user_id = user.id
       AND membership.branch_id = ? AND membership.status = 'ACTIVE'`
      params.push(scope.scopeId)
    }
    params.push(appId)
    if (query) {
      const pattern = `%${escapeLike(query)}%`
      clauses.push('(profile.nickname LIKE ? OR profile.headline LIKE ?)')
      params.push(pattern, pattern)
    }
    return database.query(
      `SELECT user.id, profile.nickname, COALESCE(profile.headline, '') AS headline,
        branch.name AS branch_name
       FROM mip_users user
       INNER JOIN mip_profiles profile ON profile.app_id = user.app_id AND profile.user_id = user.id
       ${branchJoin}
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = user.app_id AND branch.id = user.primary_branch_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY profile.nickname, user.id LIMIT ?`,
      [...params, pageLimit],
    )
  }

  async function saveCampaign(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const requestedScope = campaignScope(input.draft)
      assertScope(authorization, requestedScope)
      await assertDraftRecipients(tx, input.appId, input.draft)

      if (!input.campaignId) {
        const campaignId = createId()
        await tx.query(
          `INSERT INTO mip_message_campaigns (
            id, app_id, created_by_user_id, updated_by_user_id,
            scope_type, branch_id, audience_type, audience_user_ids_json,
            name, title, body, content_safety_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [campaignId, input.appId, input.actorUserId, input.actorUserId,
            input.draft.scopeType, input.draft.branchId, input.draft.audienceType,
            JSON.stringify(input.draft.audienceUserIds), input.draft.name,
            input.draft.title, input.draft.body, input.contentSafetyStatus],
        )
        await writeAudit(tx, input.audit(campaignId, 'admin.message_campaigns.create', {
          audienceType: input.draft.audienceType,
          selectedRecipientCount: input.draft.audienceUserIds.length,
          contentSafetyStatus: input.contentSafetyStatus,
        }))
        return getCampaign(input.appId, campaignId, tx)
      }

      const current = await getCampaign(input.appId, input.campaignId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      assertScope(authorization, campaignScope(current))
      if (!sameScope(campaignScope(current), input.authorizedExistingScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'DRAFT') throw codeError('MESSAGE_CAMPAIGN_IMMUTABLE')
      const update = await tx.query(
        `UPDATE mip_message_campaigns
         SET scope_type = ?, branch_id = ?, audience_type = ?, audience_user_ids_json = ?,
           name = ?, title = ?, body = ?, content_safety_status = ?,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'DRAFT'`,
        [input.draft.scopeType, input.draft.branchId, input.draft.audienceType,
          JSON.stringify(input.draft.audienceUserIds), input.draft.name, input.draft.title,
          input.draft.body, input.contentSafetyStatus, input.actorUserId,
          input.appId, input.campaignId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.update', {
        expectedVersion: input.expectedVersion,
        audienceType: input.draft.audienceType,
        selectedRecipientCount: input.draft.audienceUserIds.length,
        contentSafetyStatus: input.contentSafetyStatus,
      }))
      return getCampaign(input.appId, input.campaignId, tx)
    })
  }

  async function snapshotCampaign(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await getCampaign(input.appId, input.campaignId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const scope = campaignScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'DRAFT') throw codeError('MESSAGE_CAMPAIGN_IMMUTABLE')
      if (current.contentSafetyStatus !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')

      const recipients = await selectSnapshotRecipients(tx, input.appId, current, maximumRecipients + 1)
      if (recipients.length > maximumRecipients) throw codeError('MESSAGE_RECIPIENT_LIMIT_EXCEEDED')
      if (!recipients.length) throw codeError('MESSAGE_RECIPIENTS_EMPTY')
      const snapshotAt = now()
      const values = recipients.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
      const params = recipients.flatMap(recipient => [
        input.appId,
        input.campaignId,
        recipient.id,
        recipient.kind,
        recipient.primary_branch_id || null,
        snapshotAt,
      ])
      await tx.query(
        `INSERT INTO mip_message_campaign_recipients (
          app_id, campaign_id, recipient_user_id, recipient_kind, branch_id, snapshot_at
        ) VALUES ${values}`,
        params,
      )
      const update = await tx.query(
        `UPDATE mip_message_campaigns
         SET status = 'READY', recipient_count = ?, snapshot_at = ?,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'DRAFT'`,
        [recipients.length, snapshotAt, input.actorUserId, input.appId,
          input.campaignId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.snapshot', {
        expectedVersion: input.expectedVersion,
        recipientCount: recipients.length,
      }))
      return getCampaign(input.appId, input.campaignId, tx)
    })
  }

  async function publishCampaign(input) {
    return database.transaction(async (tx) => {
      const locked = await lockCampaignMutationState(tx, input.appId, input.campaignId)
      const current = locked?.campaign
      if (!current) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      const scope = campaignScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      const requestHash = publishRequestHash(input)
      if (['PUBLISHED', 'WITHDRAWN'].includes(current.status)
        && current.publishIdempotencyKey === input.idempotencyKey
        && current.publishRequestHash === requestHash) {
        return publishResponse(current, true)
      }
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'READY') throw codeError('INVALID_STATE')
      if (current.activeDispatchId) throw codeError('MESSAGE_SCHEDULE_ACTIVE')
      const result = await materializeCampaignPublication(tx, {
        ...input,
        campaign: current,
        createId,
        now,
        publicationIdempotencyKey: input.idempotencyKey,
        publicationRequestHash: requestHash,
        requiredDispatchId: null,
      })
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.publish', {
        expectedVersion: input.expectedVersion,
        recipientCount: result.recipientCount,
        delivery: 'OUTBOX_QUEUED',
      }))
      return result
    })
  }

  async function scheduleCampaign(input) {
    return database.transaction(async (tx) => {
      const locked = await lockCampaignMutationState(tx, input.appId, input.campaignId)
      const current = locked?.campaign
      if (!current) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      const scope = campaignScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      assertScheduledDate(input.scheduledFor)

      const requestHash = scheduleRequestHash(input)
      const claim = await claimOperationRequest(tx, {
        ...input,
        createId,
        operation: SCHEDULE_OPERATION,
        requestHash,
      })
      if (claim.replay) return getCampaign(input.appId, input.campaignId, tx)
      assertScheduleLeadTime(input.scheduledFor, now())
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'READY') throw codeError('INVALID_STATE')

      let replaced = false
      if (current.activeDispatchId) {
        const previous = locked.dispatch
        if (!previous || previous.campaign_id !== input.campaignId) throw codeError('CONFLICT')
        if (previous.status === 'PROCESSING') throw codeError('MESSAGE_SCHEDULE_BUSY')
        if (previous.retry_disposition === 'MANUAL_REVIEW') {
          throw codeError('MESSAGE_SCHEDULE_MANUAL_REVIEW_REQUIRED')
        }
        if (input.expectedDispatchVersion === null
          || Number(previous.version) !== input.expectedDispatchVersion) {
          throw codeError('CONFLICT')
        }
        const cancelled = await tx.query(
          `UPDATE mip_message_campaign_dispatches
           SET status = 'CANCELLED', cancelled_by_user_id = ?, cancelled_at = ?,
             cancellation_reason = 'REPLACED_BY_NEW_SCHEDULE',
             last_error_code = CASE WHEN last_outcome = 'KNOWN_FAILED'
               THEN last_error_code ELSE NULL END,
             last_outcome = CASE WHEN last_outcome = 'KNOWN_FAILED'
               THEN 'KNOWN_FAILED' ELSE 'NOT_ATTEMPTED' END,
             retry_disposition = 'TERMINAL',
             lease_token = NULL, lease_expires_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND campaign_id = ? AND version = ?
             AND status IN ('SCHEDULED', 'FAILED')
             AND retry_disposition <> 'MANUAL_REVIEW'`,
          [input.actorUserId, now(), input.appId, previous.id, input.campaignId,
            input.expectedDispatchVersion],
        )
        if (Number(cancelled.affectedRows) !== 1) throw codeError('CONFLICT')
        replaced = true
      }
      else if (input.expectedDispatchVersion !== null) {
        throw codeError('CONFLICT')
      }

      const dispatchId = createId()
      await tx.query(
        `INSERT INTO mip_message_campaign_dispatches (
          id, app_id, campaign_id, status, scheduled_for, available_at,
          scheduled_by_user_id, idempotency_key, request_hash,
          last_outcome, retry_disposition
        ) VALUES (?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?, 'NOT_ATTEMPTED', 'RETRIABLE')`,
        [dispatchId, input.appId, input.campaignId, input.scheduledFor,
          input.scheduledFor, input.actorUserId, input.idempotencyKey, requestHash],
      )
      const updated = await tx.query(
        `UPDATE mip_message_campaigns
         SET active_dispatch_id = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'READY'
           ${current.activeDispatchId ? 'AND active_dispatch_id = ?' : 'AND active_dispatch_id IS NULL'}`,
        [dispatchId, input.actorUserId, input.appId, input.campaignId,
          input.expectedVersion, ...(current.activeDispatchId ? [current.activeDispatchId] : [])],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.schedule', {
        expectedVersion: input.expectedVersion,
        scheduledFor: input.scheduledFor.toISOString(),
        replaced,
      }))
      await completeOperationRequest(tx, {
        ...input,
        operation: SCHEDULE_OPERATION,
        requestHash,
        response: { campaignId: input.campaignId },
      })
      return getCampaign(input.appId, input.campaignId, tx)
    })
  }

  async function cancelScheduledCampaign(input) {
    return database.transaction(async (tx) => {
      const locked = await lockCampaignMutationState(tx, input.appId, input.campaignId)
      const current = locked?.campaign
      if (!current) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      const scope = campaignScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')

      const requestHash = cancelScheduleRequestHash(input)
      const claim = await claimOperationRequest(tx, {
        ...input,
        createId,
        operation: CANCEL_SCHEDULE_OPERATION,
        requestHash,
      })
      if (claim.replay) return getCampaign(input.appId, input.campaignId, tx)
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'READY' || !current.activeDispatchId) throw codeError('INVALID_STATE')

      const dispatch = locked.dispatch
      if (!dispatch || dispatch.campaign_id !== input.campaignId) throw codeError('CONFLICT')
      if (Number(dispatch.version) !== input.expectedDispatchVersion) throw codeError('CONFLICT')
      if (dispatch.status === 'PROCESSING') throw codeError('MESSAGE_SCHEDULE_BUSY')
      if (dispatch.retry_disposition === 'MANUAL_REVIEW') {
        throw codeError('MESSAGE_SCHEDULE_MANUAL_REVIEW_REQUIRED')
      }
      const cancelled = await tx.query(
        `UPDATE mip_message_campaign_dispatches
         SET status = 'CANCELLED', cancelled_by_user_id = ?, cancelled_at = ?,
           cancellation_reason = ?,
           last_error_code = CASE WHEN last_outcome = 'KNOWN_FAILED'
             THEN last_error_code ELSE NULL END,
           last_outcome = CASE WHEN last_outcome = 'KNOWN_FAILED'
             THEN 'KNOWN_FAILED' ELSE 'NOT_ATTEMPTED' END,
           retry_disposition = 'TERMINAL',
           lease_token = NULL, lease_expires_at = NULL, version = version + 1
         WHERE app_id = ? AND id = ? AND campaign_id = ? AND version = ?
           AND status IN ('SCHEDULED', 'FAILED')
           AND retry_disposition <> 'MANUAL_REVIEW'`,
        [input.actorUserId, now(), input.reason, input.appId, dispatch.id,
          input.campaignId, input.expectedDispatchVersion],
      )
      if (Number(cancelled.affectedRows) !== 1) throw codeError('CONFLICT')
      const updated = await tx.query(
        `UPDATE mip_message_campaigns
         SET active_dispatch_id = NULL, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'READY'
           AND active_dispatch_id = ?`,
        [input.actorUserId, input.appId, input.campaignId, input.expectedVersion, dispatch.id],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.cancel_schedule', {
        expectedVersion: input.expectedVersion,
        expectedDispatchVersion: input.expectedDispatchVersion,
        reason: input.reason,
      }))
      await completeOperationRequest(tx, {
        ...input,
        operation: CANCEL_SCHEDULE_OPERATION,
        requestHash,
        response: { campaignId: input.campaignId },
      })
      return getCampaign(input.appId, input.campaignId, tx)
    })
  }

  async function runDueMessageCampaigns(input) {
    const batches = []
    const deadline = Number(clock()) + DISPATCH_RUN_DEADLINE_MS
    for (let batchNumber = 0;
      batchNumber < input.maxBatches && Number(clock()) < deadline;
      batchNumber += 1) {
      const claimed = await claimDispatchBatch(input.appId, input.limit)
      const results = []
      for (const dispatch of claimed.dispatches) {
        try {
          results.push(await executeClaimedDispatch(input.appId, dispatch))
        }
        catch (error) {
          results.push({ status: 'PENDING_RECONCILIATION', errorCode: safeDispatchError(error) })
        }
      }
      batches.push({ ...claimed, results })
      if (!input.drain || claimed.dispatches.length < input.limit) break
    }
    const executionResults = batches.flatMap(batch => batch.results)
    const reconciliationResults = batches.flatMap(batch => batch.reconciled)
    return {
      batches: batches.length,
      leased: batches.reduce((total, batch) => total + batch.dispatches.length, 0),
      reconciled: reconciliationResults.length,
      completed: executionResults.filter(item => item.status === 'COMPLETED').length
        + reconciliationResults.filter(item => item.status === 'COMPLETED').length,
      retryable: reconciliationResults.filter(item => item.retryDisposition === 'RETRIABLE').length,
      terminal: executionResults.filter(item => item.status === 'FAILED'
        && item.retryDisposition === 'TERMINAL').length
        + reconciliationResults.filter(item => item.status === 'FAILED'
          && item.retryDisposition === 'TERMINAL').length,
      manualReview: executionResults.filter(item => item.retryDisposition === 'MANUAL_REVIEW').length
        + reconciliationResults.filter(item => item.retryDisposition === 'MANUAL_REVIEW').length,
      pendingReconciliation: executionResults.filter(item => item.status === 'PENDING_RECONCILIATION').length,
    }
  }

  async function claimDispatchBatch(appId, limit) {
    return database.transaction(async (tx) => {
      const currentTime = now()
      const reconciled = await reconcileExpiredDispatches(tx, appId, currentTime, limit)
      await tx.query(
        `UPDATE mip_message_campaign_dispatches
         SET retry_disposition = 'TERMINAL', last_error_code = 'MESSAGE_SCHEDULE_ATTEMPTS_EXHAUSTED',
           version = version + 1
         WHERE app_id = ? AND status = 'FAILED' AND last_outcome = 'NOT_ATTEMPTED'
           AND retry_disposition = 'RETRIABLE' AND attempts >= ?`,
        [appId, MAX_DISPATCH_ATTEMPTS],
      )
      const candidates = await tx.query(
        `SELECT id, campaign_id, version
         FROM mip_message_campaign_dispatches
         WHERE app_id = ?
           AND status IN ('SCHEDULED', 'FAILED')
           AND retry_disposition = 'RETRIABLE'
           AND attempts < ? AND scheduled_for <= ? AND available_at <= ?
         ORDER BY available_at, scheduled_for, id
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, MAX_DISPATCH_ATTEMPTS, currentTime, currentTime, limit],
      )
      const leaseExpiresAt = new Date(currentTime.getTime() + DISPATCH_LEASE_MS)
      const dispatches = []
      for (const candidate of candidates) {
        const leaseToken = createId()
        const updated = await tx.query(
          `UPDATE mip_message_campaign_dispatches
           SET status = 'PROCESSING', attempts = attempts + 1,
             lease_token = ?, lease_expires_at = ?, last_error_code = NULL,
             last_outcome = 'UNKNOWN', retry_disposition = 'MANUAL_REVIEW',
             version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?
             AND status IN ('SCHEDULED', 'FAILED') AND retry_disposition = 'RETRIABLE'
             AND attempts < ?`,
          [leaseToken, leaseExpiresAt, appId, candidate.id, Number(candidate.version),
            MAX_DISPATCH_ATTEMPTS],
        )
        if (Number(updated.affectedRows) === 1) {
          dispatches.push({
            id: candidate.id,
            campaignId: candidate.campaign_id,
            leaseToken,
            version: Number(candidate.version) + 1,
          })
        }
      }
      return { dispatches, reconciled }
    })
  }

  async function executeClaimedDispatch(appId, claimed) {
    try {
      return await database.transaction(async (tx) => {
        const dispatch = await lockClaimedDispatch(tx, appId, claimed, now())
        if (!dispatch) return { status: 'LEASE_LOST' }
        const campaign = await lockPublicationCampaign(tx, appId, dispatch.campaign_id)
        if (!campaign
          || campaign.status !== 'READY'
          || campaign.activeDispatchId !== dispatch.id) {
          await markDispatchManualReview(tx, appId, dispatch, 'MESSAGE_SCHEDULE_CAMPAIGN_STATE_UNKNOWN')
          return { status: 'FAILED', retryDisposition: 'MANUAL_REVIEW' }
        }

        const grant = await lockScheduledAuthorization(
          tx,
          appId,
          dispatch.scheduled_by_user_id,
          campaignScope(campaign),
        )
        if (!grant) {
          await markDispatchTerminal(tx, appId, dispatch, 'MESSAGE_SCHEDULE_AUTH_REVOKED')
          await writeSystemDispatchAudit(tx, {
            appId,
            actorUserId: dispatch.scheduled_by_user_id,
            campaign,
            action: 'system.message_campaigns.schedule_authorization_revoked',
            metadata: { attempts: Number(dispatch.attempts) },
          })
          return { status: 'FAILED', retryDisposition: 'TERMINAL' }
        }

        const publicationIdempotencyKey = scheduledPublicationKey(dispatch.id)
        const publicationRequestHash = scheduledPublicationHash(dispatch.id, campaign.id)
        const result = await materializeCampaignPublication(tx, {
          appId,
          actorUserId: dispatch.scheduled_by_user_id,
          campaignId: campaign.id,
          campaign,
          createId,
          now,
          publicationIdempotencyKey,
          publicationRequestHash,
          requiredDispatchId: dispatch.id,
        })
        const completed = await tx.query(
          `UPDATE mip_message_campaign_dispatches
           SET status = 'COMPLETED', completed_at = ?, lease_token = NULL,
             lease_expires_at = NULL, last_error_code = NULL,
             last_outcome = 'SUCCEEDED', retry_disposition = 'TERMINAL',
             version = version + 1
           WHERE app_id = ? AND id = ? AND campaign_id = ? AND version = ?
             AND status = 'PROCESSING' AND lease_token = ?`,
          [now(), appId, dispatch.id, campaign.id, Number(dispatch.version), dispatch.lease_token],
        )
        if (Number(completed.affectedRows) !== 1) throw codeError('MESSAGE_SCHEDULE_LEASE_LOST')
        await writeAudit(tx, {
          appId,
          actorUserId: dispatch.scheduled_by_user_id,
          scopeType: campaign.scopeType,
          scopeId: campaign.scopeType === 'BRANCH' ? campaign.branchId : null,
          action: 'admin.message_campaigns.publish_scheduled',
          resourceId: campaign.id,
          effectiveRole: grant.roleKey,
          metadata: {
            recipientCount: result.recipientCount,
            delivery: 'OUTBOX_QUEUED',
            attempts: Number(dispatch.attempts),
          },
        })
        return { status: 'COMPLETED', retryDisposition: 'TERMINAL' }
      })
    }
    catch (error) {
      if (!TERMINAL_DISPATCH_ERRORS.has(error?.code || error?.message)) throw error
      return finalizeKnownDispatchFailure(appId, claimed, error.code || error.message)
    }
  }

  async function finalizeKnownDispatchFailure(appId, claimed, errorCode) {
    return database.transaction(async (tx) => {
      const dispatch = await lockClaimedDispatch(tx, appId, claimed, now())
      if (!dispatch) return { status: 'LEASE_LOST' }
      const campaign = await lockPublicationCampaign(tx, appId, dispatch.campaign_id)
      const fact = await tx.one(
        `SELECT COUNT(*) AS submitted_count
         FROM mip_operations_messages
         WHERE app_id = ? AND publication_id = ?`,
        [appId, dispatch.campaign_id],
      )
      if (campaign
        && campaign.status === 'READY'
        && campaign.activeDispatchId === dispatch.id
        && Number(fact?.submitted_count || 0) === 0) {
        await markDispatchTerminal(tx, appId, dispatch, errorCode)
        await writeSystemDispatchAudit(tx, {
          appId,
          actorUserId: dispatch.scheduled_by_user_id,
          campaign,
          action: 'system.message_campaigns.schedule_terminal_failure',
          metadata: { errorCode, attempts: Number(dispatch.attempts) },
        })
        return { status: 'FAILED', retryDisposition: 'TERMINAL' }
      }
      await markDispatchManualReview(tx, appId, dispatch, 'MESSAGE_SCHEDULE_OUTCOME_UNKNOWN')
      return { status: 'FAILED', retryDisposition: 'MANUAL_REVIEW' }
    })
  }

  async function withdrawCampaign(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await getCampaign(input.appId, input.campaignId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const scope = campaignScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
      const withdrawnAt = now()
      const update = await tx.query(
        `UPDATE mip_message_campaigns
         SET status = 'WITHDRAWN', withdrawn_at = ?, withdrawal_reason = ?,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PUBLISHED'`,
        [withdrawnAt, input.reason, input.actorUserId, input.appId,
          input.campaignId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.withdraw', {
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        recipientCount: current.recipientCount,
        deliveredMessagesRetained: true,
      }))
      return getCampaign(input.appId, input.campaignId, tx)
    })
  }

  return {
    cancelScheduledCampaign,
    getCampaign,
    getCampaignScope,
    listCampaigns,
    listScopes,
    publishCampaign,
    runDueMessageCampaigns,
    saveCampaign,
    scheduleCampaign,
    searchRecipients,
    snapshotCampaign,
    withdrawCampaign,
  }
}

async function assertDraftRecipients(tx, appId, draft) {
  if (draft.scopeType === 'BRANCH') {
    const branch = await tx.one(
      `SELECT id FROM mip_city_branches
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [appId, draft.branchId],
    )
    if (!branch) throw codeError('VALIDATION_FAILED')
  }
  if (draft.audienceType !== 'EXPLICIT') return
  if (!draft.audienceUserIds.length || draft.audienceUserIds.length > MAX_EXPLICIT_RECIPIENTS) {
    throw codeError('MESSAGE_RECIPIENT_INVALID')
  }
  const branchJoin = draft.scopeType === 'BRANCH'
    ? `INNER JOIN mip_branch_memberships membership
        ON membership.app_id = user.app_id AND membership.user_id = user.id
       AND membership.branch_id = ? AND membership.status = 'ACTIVE'`
    : ''
  const params = draft.scopeType === 'BRANCH'
    ? [draft.branchId, appId, ...draft.audienceUserIds]
    : [appId, ...draft.audienceUserIds]
  const rows = await tx.query(
    `SELECT user.id FROM mip_users user ${branchJoin}
     WHERE user.app_id = ? AND user.status = 'ACTIVE'
       AND user.id IN (${placeholders(draft.audienceUserIds)}) FOR UPDATE`,
    params,
  )
  if (new Set(rows.map(row => row.id)).size !== draft.audienceUserIds.length) {
    throw codeError('MESSAGE_RECIPIENT_INVALID')
  }
}

async function selectSnapshotRecipients(tx, appId, campaign, pageLimit) {
  const entitlement = `EXISTS (
    SELECT 1 FROM mip_membership_entitlements entitlement
    WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
      AND entitlement.status = 'ACTIVE' AND entitlement.starts_at <= UTC_TIMESTAMP(3)
      AND entitlement.ends_at > UTC_TIMESTAMP(3)
  )`
  if (campaign.audienceType === 'EXPLICIT') {
    const branchJoin = campaign.scopeType === 'BRANCH'
      ? `INNER JOIN mip_branch_memberships membership
          ON membership.app_id = user.app_id AND membership.user_id = user.id
         AND membership.branch_id = ? AND membership.status = 'ACTIVE'`
      : ''
    const params = campaign.scopeType === 'BRANCH'
      ? [campaign.branchId, appId, ...campaign.audienceUserIds, pageLimit]
      : [appId, ...campaign.audienceUserIds, pageLimit]
    return tx.query(
      `SELECT user.id, user.primary_branch_id,
        CASE WHEN ${entitlement} THEN 'PLAYER' ELSE 'GUEST' END AS kind
       FROM mip_users user ${branchJoin}
       WHERE user.app_id = ? AND user.status = 'ACTIVE'
         AND user.id IN (${placeholders(campaign.audienceUserIds)})
       ORDER BY user.id LIMIT ? FOR UPDATE`,
      params,
    )
  }
  if (campaign.scopeType === 'BRANCH') {
    return tx.query(
      `SELECT user.id, user.primary_branch_id,
        CASE WHEN ${entitlement} THEN 'PLAYER' ELSE 'GUEST' END AS kind
       FROM mip_branch_memberships membership
       INNER JOIN mip_users user
         ON user.app_id = membership.app_id AND user.id = membership.user_id AND user.status = 'ACTIVE'
       WHERE membership.app_id = ? AND membership.branch_id = ? AND membership.status = 'ACTIVE'
       ORDER BY user.id LIMIT ? FOR UPDATE`,
      [appId, campaign.branchId, pageLimit],
    )
  }
  return tx.query(
    `SELECT user.id, user.primary_branch_id,
      CASE WHEN ${entitlement} THEN 'PLAYER' ELSE 'GUEST' END AS kind
     FROM mip_users user
     WHERE user.app_id = ? AND user.status = 'ACTIVE'
     ORDER BY user.id LIMIT ? FOR UPDATE`,
    [appId, pageLimit],
  )
}

async function materializeCampaignPublication(tx, input) {
  const recipients = await tx.query(
    `SELECT recipient_user_id
     FROM mip_message_campaign_recipients
     WHERE app_id = ? AND campaign_id = ?
     ORDER BY recipient_user_id FOR UPDATE`,
    [input.appId, input.campaignId],
  )
  if (recipients.length !== input.campaign.recipientCount || !recipients.length) {
    throw codeError('MESSAGE_RECIPIENT_SNAPSHOT_INVALID')
  }
  await insertPublicationFacts(tx, {
    ...input,
    recipients,
  })
  const publishedAt = input.now()
  const update = await tx.query(
    `UPDATE mip_message_campaigns
     SET status = 'PUBLISHED', published_at = ?, updated_by_user_id = ?,
       publish_idempotency_key = ?, publish_request_hash = ?, active_dispatch_id = NULL,
       version = version + 1
     WHERE app_id = ? AND id = ? AND version = ? AND status = 'READY'
       ${input.requiredDispatchId ? 'AND active_dispatch_id = ?' : 'AND active_dispatch_id IS NULL'}`,
    [publishedAt, input.actorUserId, input.publicationIdempotencyKey,
      input.publicationRequestHash, input.appId, input.campaignId,
      input.campaign.version, ...(input.requiredDispatchId ? [input.requiredDispatchId] : [])],
  )
  if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
  return {
    campaignId: input.campaignId,
    status: 'PUBLISHED',
    recipientCount: recipients.length,
    queuedCount: recipients.length,
    wechatDelivery: 'NOT_CONFIGURED',
    version: input.campaign.version + 1,
    idempotent: false,
  }
}

async function claimOperationRequest(tx, input) {
  const requestId = input.createId()
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [requestId, input.appId, input.actorUserId, input.operation,
        input.idempotencyKey, input.requestHash],
    )
    return { replay: null }
  }
  catch (error) {
    if (!duplicateError(error)) throw error
  }
  const stored = await tx.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
     FOR UPDATE`,
    [input.appId, input.actorUserId, input.operation, input.idempotencyKey],
  )
  if (!stored || stored.request_hash !== input.requestHash) {
    throw codeError('MESSAGE_SCHEDULE_IDEMPOTENCY_CONFLICT')
  }
  if (stored.status !== 'COMPLETED') {
    throw codeError('MESSAGE_SCHEDULE_REQUEST_IN_PROGRESS', true)
  }
  const response = parseOperationResponse(stored.response_json)
  if (!response
    || Reflect.ownKeys(response).length !== 1
    || response.campaignId !== input.campaignId) {
    throw codeError('MESSAGE_SCHEDULE_IDEMPOTENCY_CONFLICT')
  }
  return { replay: response }
}

async function completeOperationRequest(tx, input) {
  const completed = await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ?
       AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(input.response), input.appId, input.actorUserId, input.operation,
      input.idempotencyKey, input.requestHash],
  )
  if (Number(completed.affectedRows) !== 1) throw codeError('CONFLICT')
}

async function lockCampaignMutationState(tx, appId, campaignId) {
  // Read only the pointer first so every READY mutation can follow dispatch -> campaign -> actor locks.
  const hint = await tx.one(
    `SELECT active_dispatch_id FROM mip_message_campaigns WHERE app_id = ? AND id = ?`,
    [appId, campaignId],
  )
  if (!hint) return null
  const hintedDispatchId = hint.active_dispatch_id || null
  const dispatch = hintedDispatchId ? await lockDispatch(tx, appId, hintedDispatchId) : null
  const campaign = await lockPublicationCampaign(tx, appId, campaignId)
  if (!campaign) return null
  if (campaign.activeDispatchId !== hintedDispatchId
    || (hintedDispatchId && (!dispatch || dispatch.campaign_id !== campaignId))) {
    throw codeError('CONFLICT')
  }
  return { campaign, dispatch }
}

async function lockDispatch(tx, appId, dispatchId) {
  return tx.one(
    `SELECT id, campaign_id, scheduled_by_user_id, status, scheduled_for,
      available_at, attempts, lease_token, lease_expires_at, last_outcome,
      retry_disposition, last_error_code, version, updated_at
     FROM mip_message_campaign_dispatches
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, dispatchId],
  )
}

async function lockClaimedDispatch(tx, appId, claimed, currentTime) {
  const dispatch = await tx.one(
    `SELECT id, campaign_id, scheduled_by_user_id, status, attempts,
      lease_token, lease_expires_at, version
     FROM mip_message_campaign_dispatches
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, claimed.id],
  )
  if (!dispatch
    || dispatch.status !== 'PROCESSING'
    || dispatch.lease_token !== claimed.leaseToken
    || Number(dispatch.version) !== claimed.version
    || new Date(dispatch.lease_expires_at).getTime() <= currentTime.getTime()) {
    return null
  }
  return dispatch
}

async function lockPublicationCampaign(tx, appId, campaignId) {
  const row = await tx.one(
    `SELECT id, scope_type, branch_id, title, body, status, recipient_count,
      publish_idempotency_key, publish_request_hash, active_dispatch_id,
      published_at, version
     FROM mip_message_campaigns
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, campaignId],
  )
  if (!row) return null
  return {
    id: String(row.id),
    scopeType: row.scope_type,
    branchId: row.branch_id || null,
    title: row.title,
    body: row.body,
    status: row.status,
    recipientCount: Number(row.recipient_count || 0),
    publishIdempotencyKey: row.publish_idempotency_key || null,
    publishRequestHash: row.publish_request_hash || null,
    activeDispatchId: row.active_dispatch_id || null,
    publishedAt: row.published_at || null,
    version: Number(row.version),
  }
}

async function lockScheduledAuthorization(tx, appId, userId, scope) {
  const scheduler = await tx.one(
    `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!scheduler || scheduler.status !== 'ACTIVE') return null
  const rows = await tx.query(
    `SELECT binding.scope_type, binding.scope_id, binding.role_key, binding.status,
      CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END
        AS policy_capabilities_json
     FROM mip_admin_role_bindings binding
     LEFT JOIN mip_role_capability_policies policy
       ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
     WHERE binding.app_id = ? AND binding.user_id = ?
     ORDER BY binding.scope_type, binding.scope_id, binding.role_key FOR UPDATE`,
    [appId, userId],
  )
  for (const row of rows) {
    if (row.status !== 'ACTIVE') continue
    const binding = {
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' && row.scope_id === PLATFORM_SCOPE_ID
        ? null
        : row.scope_id,
      roleKey: row.role_key,
      capabilities: capabilitiesForBinding({
        roleKey: row.role_key,
        policyCapabilities: Object.hasOwn(row, 'policy_capabilities_json')
          ? row.policy_capabilities_json
          : null,
      }),
    }
    if (binding.capabilities.includes(CAPABILITIES.MESSAGES_MANAGE)
      && coversScope(binding, scope)) {
      return binding
    }
  }
  return null
}

async function reconcileExpiredDispatches(tx, appId, currentTime, limit) {
  const expired = await tx.query(
    `SELECT id, campaign_id, scheduled_by_user_id, attempts, version
     FROM mip_message_campaign_dispatches
     WHERE app_id = ? AND status = 'PROCESSING' AND lease_expires_at <= ?
     ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
    [appId, currentTime, limit],
  )
  const results = []
  for (const dispatch of expired) {
    const campaign = await lockPublicationCampaign(tx, appId, dispatch.campaign_id)
    const fact = await tx.one(
      `SELECT COUNT(DISTINCT message.id) AS submitted_count,
        COUNT(DISTINCT CASE WHEN outbox.id IS NOT NULL THEN message.id END) AS outbox_covered_count,
        COUNT(outbox.id) AS outbox_count
       FROM mip_operations_messages message
       LEFT JOIN mip_outbox_events outbox
         ON outbox.app_id = message.app_id
        AND outbox.aggregate_type = 'OPERATIONS_MESSAGE'
        AND outbox.aggregate_id = message.id
        AND outbox.event_type = 'operations.notification_published'
       WHERE message.app_id = ? AND message.publication_id = ?`,
      [appId, dispatch.campaign_id],
    )
    const submittedCount = Number(fact?.submitted_count || 0)
    const outboxCoveredCount = Number(fact?.outbox_covered_count || 0)
    const outboxCount = Number(fact?.outbox_count || 0)
    const exactPublication = campaign
      && ['PUBLISHED', 'WITHDRAWN'].includes(campaign.status)
      && campaign.activeDispatchId === null
      && campaign.publishIdempotencyKey === scheduledPublicationKey(dispatch.id)
      && campaign.publishRequestHash === scheduledPublicationHash(dispatch.id, campaign.id)
      && submittedCount > 0
      && submittedCount === campaign.recipientCount
      && outboxCoveredCount === campaign.recipientCount
      && outboxCount === campaign.recipientCount
    if (exactPublication) {
      await tx.query(
        `UPDATE mip_message_campaign_dispatches
         SET status = 'COMPLETED', completed_at = ?, lease_token = NULL,
           lease_expires_at = NULL, last_error_code = NULL,
           last_outcome = 'SUCCEEDED', retry_disposition = 'TERMINAL', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PROCESSING'`,
        [campaign.publishedAt || currentTime, appId, dispatch.id, Number(dispatch.version)],
      )
      results.push({ status: 'COMPLETED', retryDisposition: 'TERMINAL' })
      continue
    }
    const safeToRetry = campaign
      && campaign.status === 'READY'
      && campaign.activeDispatchId === dispatch.id
      && submittedCount === 0
      && outboxCoveredCount === 0
      && outboxCount === 0
    if (safeToRetry) {
      const exhausted = Number(dispatch.attempts) >= MAX_DISPATCH_ATTEMPTS
      await tx.query(
        `UPDATE mip_message_campaign_dispatches
         SET status = 'FAILED', available_at = ?, lease_token = NULL, lease_expires_at = NULL,
           last_error_code = ?, last_outcome = 'NOT_ATTEMPTED', retry_disposition = ?,
           version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PROCESSING'`,
        [currentTime,
          exhausted ? 'MESSAGE_SCHEDULE_ATTEMPTS_EXHAUSTED' : 'MESSAGE_SCHEDULE_LEASE_EXPIRED',
          exhausted ? 'TERMINAL' : 'RETRIABLE', appId, dispatch.id, Number(dispatch.version)],
      )
      results.push({ status: 'FAILED', retryDisposition: exhausted ? 'TERMINAL' : 'RETRIABLE' })
      continue
    }
    await tx.query(
      `UPDATE mip_message_campaign_dispatches
       SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
         last_error_code = 'MESSAGE_SCHEDULE_OUTCOME_UNKNOWN', last_outcome = 'UNKNOWN',
         retry_disposition = 'MANUAL_REVIEW', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ? AND status = 'PROCESSING'`,
      [appId, dispatch.id, Number(dispatch.version)],
    )
    results.push({ status: 'FAILED', retryDisposition: 'MANUAL_REVIEW' })
  }
  return results
}

async function markDispatchTerminal(tx, appId, dispatch, errorCode) {
  const updated = await tx.query(
    `UPDATE mip_message_campaign_dispatches
     SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
       last_error_code = ?, last_outcome = 'NOT_ATTEMPTED',
       retry_disposition = 'TERMINAL', version = version + 1
     WHERE app_id = ? AND id = ? AND version = ? AND status = 'PROCESSING'
       AND lease_token = ?`,
    [errorCode, appId, dispatch.id, Number(dispatch.version), dispatch.lease_token],
  )
  if (Number(updated.affectedRows) !== 1) throw codeError('MESSAGE_SCHEDULE_LEASE_LOST')
}

async function markDispatchManualReview(tx, appId, dispatch, errorCode) {
  const updated = await tx.query(
    `UPDATE mip_message_campaign_dispatches
     SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
       last_error_code = ?, last_outcome = 'UNKNOWN',
       retry_disposition = 'MANUAL_REVIEW', version = version + 1
     WHERE app_id = ? AND id = ? AND version = ? AND status = 'PROCESSING'
       AND lease_token = ?`,
    [errorCode, appId, dispatch.id, Number(dispatch.version), dispatch.lease_token],
  )
  if (Number(updated.affectedRows) !== 1) throw codeError('MESSAGE_SCHEDULE_LEASE_LOST')
}

async function writeSystemDispatchAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'SYSTEM', ?, ?, ?, 'MESSAGE_CAMPAIGN', ?, NULL, ?)`,
    [input.appId, input.actorUserId, input.campaign.scopeType,
      input.campaign.scopeType === 'BRANCH' ? input.campaign.branchId : null,
      input.action, input.campaign.id, JSON.stringify(input.metadata || {})],
  )
}

async function insertPublicationFacts(tx, input) {
  const facts = input.recipients.map(recipient => ({
    messageId: input.createId(),
    outboxId: input.createId(),
    userId: recipient.recipient_user_id,
  }))
  const messageValues = facts.map(() => "(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, 'PUBLISHED', 1)").join(', ')
  const messageParams = facts.flatMap(fact => [
    fact.messageId,
    input.appId,
    input.campaignId,
    input.actorUserId,
    input.campaign.scopeType,
    input.campaign.branchId,
    fact.userId,
    input.campaign.title,
    input.campaign.body,
  ])
  await tx.query(
    `INSERT INTO mip_operations_messages (
      id, app_id, publication_id, created_by_user_id, scope_type,
      branch_id, event_id, recipient_user_id, title, body,
      target_type, target_id, template_key, template_payload_json, status, version
    ) VALUES ${messageValues}`,
    messageParams,
  )
  const outboxValues = facts.map(() => "(?, ?, 'OPERATIONS_MESSAGE', ?, 'operations.notification_published', 1, JSON_OBJECT(), 'PENDING')").join(', ')
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type,
      source_version, payload_json, status
    ) VALUES ${outboxValues}`,
    facts.flatMap(fact => [fact.outboxId, input.appId, fact.messageId]),
  )
}

function campaignSelect(includeAudience) {
  return `SELECT campaign.id, campaign.scope_type, campaign.branch_id,
    branch.name AS branch_name, campaign.audience_type,
    ${includeAudience ? 'campaign.audience_user_ids_json,' : ''}
    campaign.name, campaign.title, ${includeAudience ? 'campaign.body,' : ''}
    campaign.status, campaign.content_safety_status, campaign.recipient_count,
    (SELECT COUNT(*) FROM mip_operations_messages submitted
      WHERE submitted.app_id = campaign.app_id AND submitted.publication_id = campaign.id
    ) AS submitted_count,
    (SELECT COUNT(*) FROM mip_operations_messages ready_message
      INNER JOIN mip_outbox_events ready_outbox
        ON ready_outbox.app_id = ready_message.app_id
       AND ready_outbox.aggregate_type = 'OPERATIONS_MESSAGE'
       AND ready_outbox.aggregate_id = ready_message.id
       AND ready_outbox.event_type = 'operations.notification_published'
      INNER JOIN mip_inbox_messages ready_inbox
        ON ready_inbox.app_id = ready_message.app_id
       AND ready_inbox.recipient_user_id = ready_message.recipient_user_id
       AND ready_inbox.dedupe_key = CONCAT('outbox:', ready_outbox.id, ':operations')
      WHERE ready_message.app_id = campaign.app_id AND ready_message.publication_id = campaign.id
    ) AS inbox_ready_count,
    (SELECT COUNT(*) FROM mip_operations_messages failed_message
      INNER JOIN mip_outbox_events failed_outbox
        ON failed_outbox.app_id = failed_message.app_id
       AND failed_outbox.aggregate_type = 'OPERATIONS_MESSAGE'
       AND failed_outbox.aggregate_id = failed_message.id
       AND failed_outbox.event_type = 'operations.notification_published'
       AND failed_outbox.status IN ('FAILED', 'CANCELLED')
      WHERE failed_message.app_id = campaign.app_id AND failed_message.publication_id = campaign.id
    ) AS failed_count,
    ${campaignOutboxCount("= 'PENDING'")} AS outbox_pending_count,
    ${campaignOutboxCount("= 'PROCESSING'")} AS outbox_processing_count,
    ${campaignOutboxCount("= 'FAILED'")} AS outbox_retrying_count,
    ${campaignOutboxCount("= 'DELIVERED'")} AS outbox_delivered_count,
    ${campaignOutboxCount("= 'CANCELLED'")} AS outbox_terminal_count,
    ${campaignExternalTaskCount("= 'PENDING'")} AS external_task_pending_count,
    ${campaignExternalTaskCount("= 'PROCESSING'")} AS external_task_processing_count,
    ${campaignExternalTaskCount("= 'FAILED'")} AS external_task_retrying_count,
    ${campaignExternalTaskCount("= 'DELIVERED'")} AS external_task_delivered_count,
    ${campaignExternalTaskCount("= 'CANCELLED'")} AS external_task_terminal_count,
    campaign.snapshot_at, campaign.published_at, campaign.withdrawn_at,
    ${includeAudience ? 'campaign.withdrawal_reason, campaign.publish_idempotency_key, campaign.publish_request_hash,' : ''}
    campaign.active_dispatch_id,
    active_dispatch.status AS active_dispatch_status,
    active_dispatch.scheduled_for AS active_dispatch_scheduled_for,
    active_dispatch.attempts AS active_dispatch_attempts,
    active_dispatch.last_outcome AS active_dispatch_last_outcome,
    active_dispatch.retry_disposition AS active_dispatch_retry_disposition,
    active_dispatch.last_error_code AS active_dispatch_last_error_code,
    active_dispatch.version AS active_dispatch_version,
    active_dispatch.updated_at AS active_dispatch_updated_at,
    campaign.version, campaign.updated_at
    FROM mip_message_campaigns campaign
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = campaign.app_id AND branch.id = campaign.branch_id
    LEFT JOIN mip_message_campaign_dispatches active_dispatch
      ON active_dispatch.app_id = campaign.app_id
     AND active_dispatch.campaign_id = campaign.id
     AND active_dispatch.id = campaign.active_dispatch_id`
}

function campaignDto(row) {
  return {
    id: String(row.id),
    scopeType: row.scope_type,
    branchId: row.branch_id || null,
    branchName: row.branch_name || '',
    audienceType: row.audience_type,
    ...(Object.hasOwn(row, 'audience_user_ids_json')
      ? { audienceUserIds: jsonArray(row.audience_user_ids_json) }
      : {}),
    name: row.name,
    title: row.title,
    ...(Object.hasOwn(row, 'body') ? { body: row.body } : {}),
    status: row.status,
    contentSafetyStatus: row.content_safety_status,
    recipientCount: Number(row.recipient_count || 0),
    deliveryStats: {
      submittedCount: Number(row.submitted_count || 0),
      inboxReadyCount: Number(row.inbox_ready_count || 0),
      failedCount: Number(row.failed_count || 0),
      outboxStats: {
        pendingCount: Number(row.outbox_pending_count || 0),
        processingCount: Number(row.outbox_processing_count || 0),
        retryingCount: Number(row.outbox_retrying_count || 0),
        deliveredCount: Number(row.outbox_delivered_count || 0),
        terminalCount: Number(row.outbox_terminal_count || 0),
      },
      externalTaskStats: {
        pendingCount: Number(row.external_task_pending_count || 0),
        processingCount: Number(row.external_task_processing_count || 0),
        retryingCount: Number(row.external_task_retrying_count || 0),
        deliveredCount: Number(row.external_task_delivered_count || 0),
        terminalCount: Number(row.external_task_terminal_count || 0),
      },
    },
    snapshotAt: iso(row.snapshot_at),
    publishedAt: iso(row.published_at),
    withdrawnAt: iso(row.withdrawn_at),
    ...(Object.hasOwn(row, 'withdrawal_reason') ? { withdrawalReason: row.withdrawal_reason || '' } : {}),
    ...(Object.hasOwn(row, 'publish_idempotency_key')
      ? {
          publishIdempotencyKey: row.publish_idempotency_key || null,
          publishRequestHash: row.publish_request_hash || null,
        }
      : {}),
    activeDispatchId: row.active_dispatch_id || null,
    activeDispatch: row.active_dispatch_id
      ? {
          status: row.active_dispatch_status,
          scheduledFor: iso(row.active_dispatch_scheduled_for),
          attempts: Number(row.active_dispatch_attempts || 0),
          lastOutcome: row.active_dispatch_last_outcome,
          retryDisposition: row.active_dispatch_retry_disposition,
          lastErrorCode: row.active_dispatch_last_error_code || null,
          version: Number(row.active_dispatch_version),
          updatedAt: iso(row.active_dispatch_updated_at),
        }
      : null,
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
  }
}

function campaignOutboxCount(statusCondition) {
  return `(SELECT COUNT(*) FROM mip_operations_messages counted_message
    INNER JOIN mip_outbox_events counted_outbox
      ON counted_outbox.app_id = counted_message.app_id
     AND counted_outbox.aggregate_type = 'OPERATIONS_MESSAGE'
     AND counted_outbox.aggregate_id = counted_message.id
     AND counted_outbox.event_type = 'operations.notification_published'
     AND counted_outbox.status ${statusCondition}
    WHERE counted_message.app_id = campaign.app_id
      AND counted_message.publication_id = campaign.id)`
}

function campaignExternalTaskCount(statusCondition) {
  return `(SELECT COUNT(*) FROM mip_operations_messages external_message
    INNER JOIN mip_outbox_events external_outbox
      ON external_outbox.app_id = external_message.app_id
     AND external_outbox.aggregate_type = 'OPERATIONS_MESSAGE'
     AND external_outbox.aggregate_id = external_message.id
     AND external_outbox.event_type = 'operations.notification_published'
    INNER JOIN mip_inbox_messages external_inbox
      ON external_inbox.app_id = external_message.app_id
     AND external_inbox.recipient_user_id = external_message.recipient_user_id
     AND external_inbox.dedupe_key = CONCAT('outbox:', external_outbox.id, ':operations')
    INNER JOIN mip_delivery_tasks external_task
      ON external_task.app_id = external_inbox.app_id
     AND external_task.inbox_message_id = external_inbox.id
     AND external_task.status ${statusCondition}
    WHERE external_message.app_id = campaign.app_id
      AND external_message.publication_id = campaign.id)`
}

function campaignScope(value) {
  return {
    scopeType: value.scopeType,
    scopeId: value.scopeType === 'BRANCH' ? value.branchId : null,
  }
}

function visibleWhere(visibility) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  if (!visibility.branchIds.length) return { sql: '0 = 1', params: [] }
  return {
    sql: `(campaign.scope_type = 'BRANCH'
      AND campaign.branch_id IN (${placeholders(visibility.branchIds)}))`,
    params: [...visibility.branchIds],
  }
}

function publishRequestHash(input) {
  return createHash('sha256')
    .update(`${input.campaignId}\0${input.expectedVersion}\0${input.idempotencyKey}`)
    .digest('hex')
}

function scheduleRequestHash(input) {
  return createHash('sha256')
    .update([
      input.campaignId,
      input.expectedVersion,
      input.expectedDispatchVersion ?? '',
      input.scheduledFor.toISOString(),
      input.idempotencyKey,
    ].join('\0'))
    .digest('hex')
}

function cancelScheduleRequestHash(input) {
  return createHash('sha256')
    .update([
      input.campaignId,
      input.expectedVersion,
      input.expectedDispatchVersion,
      input.reason,
      input.idempotencyKey,
    ].join('\0'))
    .digest('hex')
}

function scheduledPublicationKey(dispatchId) {
  return `dispatch:${dispatchId}`
}

function scheduledPublicationHash(dispatchId, campaignId) {
  return createHash('sha256').update(`${campaignId}\0${dispatchId}`).digest('hex')
}

function publishResponse(campaign, idempotent) {
  return {
    campaignId: campaign.id,
    status: campaign.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'PUBLISHED',
    recipientCount: campaign.recipientCount,
    queuedCount: campaign.recipientCount,
    wechatDelivery: 'NOT_CONFIGURED',
    version: campaign.version,
    idempotent,
  }
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, 'MESSAGE_CAMPAIGN', ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceId, audit.effectiveRole || null,
      JSON.stringify(audit.metadata || {})],
  )
}

function jsonArray(value) {
  if (Array.isArray(value)) return value.map(String)
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  }
  catch {
    return []
  }
}

function parseOperationResponse(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function boundedMaximum(value) {
  const parsed = Number(value || MAX_SNAPSHOT_RECIPIENTS)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_SNAPSHOT_RECIPIENTS
    ? parsed
    : MAX_SNAPSHOT_RECIPIENTS
}

function assertScheduledDate(scheduledFor) {
  if (!(scheduledFor instanceof Date)
    || !Number.isFinite(scheduledFor.getTime())) {
    throw codeError('VALIDATION_FAILED')
  }
}

function assertScheduleLeadTime(scheduledFor, currentTime) {
  if (scheduledFor.getTime() < currentTime.getTime() + MIN_SCHEDULE_DELAY_MS) {
    throw codeError('VALIDATION_FAILED')
  }
}

function duplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function safeDispatchError(error) {
  const code = error?.code || error?.message
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
    ? code
    : 'MESSAGE_SCHEDULE_EXECUTION_UNCERTAIN'
}

function codeError(code, retryable = false) {
  const error = new Error(code)
  error.code = code
  error.retryable = retryable
  return error
}

module.exports = {
  MAX_EXPLICIT_RECIPIENTS,
  MAX_SNAPSHOT_RECIPIENTS,
  campaignDto,
  cancelScheduleRequestHash,
  createMessageCampaignRepository,
  publishRequestHash,
  scheduleRequestHash,
  scheduledPublicationHash,
}
