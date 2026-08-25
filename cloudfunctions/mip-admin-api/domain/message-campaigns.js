'use strict'

const { createHash, randomUUID } = require('node:crypto')

const MAX_EXPLICIT_RECIPIENTS = 100
const MAX_SNAPSHOT_RECIPIENTS = 1000

function createMessageCampaignRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
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
      const authorization = await lockMutation(tx, input)
      const current = await getCampaign(input.appId, input.campaignId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
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

      const recipients = await tx.query(
        `SELECT recipient_user_id
         FROM mip_message_campaign_recipients
         WHERE app_id = ? AND campaign_id = ?
         ORDER BY recipient_user_id FOR UPDATE`,
        [input.appId, input.campaignId],
      )
      if (recipients.length !== current.recipientCount || !recipients.length) {
        throw codeError('MESSAGE_RECIPIENT_SNAPSHOT_INVALID')
      }
      await insertPublicationFacts(tx, {
        ...input,
        campaign: current,
        createId,
        recipients,
      })
      const publishedAt = now()
      const update = await tx.query(
        `UPDATE mip_message_campaigns
         SET status = 'PUBLISHED', published_at = ?, updated_by_user_id = ?,
           publish_idempotency_key = ?, publish_request_hash = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'READY'`,
        [publishedAt, input.actorUserId, input.idempotencyKey, requestHash,
          input.appId, input.campaignId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.campaignId, 'admin.message_campaigns.publish', {
        expectedVersion: input.expectedVersion,
        recipientCount: recipients.length,
        delivery: 'OUTBOX_QUEUED',
      }))
      return {
        campaignId: input.campaignId,
        status: 'PUBLISHED',
        recipientCount: recipients.length,
        queuedCount: recipients.length,
        wechatDelivery: 'NOT_CONFIGURED',
        version: input.expectedVersion + 1,
        idempotent: false,
      }
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
    getCampaign,
    getCampaignScope,
    listCampaigns,
    listScopes,
    publishCampaign,
    saveCampaign,
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
    campaign.version, campaign.updated_at
    FROM mip_message_campaigns campaign
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = campaign.app_id AND branch.id = campaign.branch_id`
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

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  MAX_EXPLICIT_RECIPIENTS,
  MAX_SNAPSHOT_RECIPIENTS,
  campaignDto,
  createMessageCampaignRepository,
  publishRequestHash,
}
