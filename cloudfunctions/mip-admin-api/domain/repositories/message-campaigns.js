'use strict'

function createMessageCampaignReadRepository(database) {
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
    const sql = lock
      ? `SELECT campaign.id, campaign.scope_type, campaign.branch_id,
       branch.name AS branch_name, campaign.audience_type,
       campaign.audience_user_ids_json, campaign.name, campaign.title, campaign.body,
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
       ${campaignOutboxCount('= \'PENDING\'')} AS outbox_pending_count,
       ${campaignOutboxCount('= \'PROCESSING\'')} AS outbox_processing_count,
       ${campaignOutboxCount('= \'FAILED\'')} AS outbox_retrying_count,
       ${campaignOutboxCount('= \'DELIVERED\'')} AS outbox_delivered_count,
       ${campaignOutboxCount('= \'CANCELLED\'')} AS outbox_terminal_count,
       ${campaignExternalTaskCount('= \'PENDING\'')} AS external_task_pending_count,
       ${campaignExternalTaskCount('= \'PROCESSING\'')} AS external_task_processing_count,
       ${campaignExternalTaskCount('= \'FAILED\'')} AS external_task_retrying_count,
       ${campaignExternalTaskCount('= \'DELIVERED\'')} AS external_task_delivered_count,
       ${campaignExternalTaskCount('= \'CANCELLED\'')} AS external_task_terminal_count,
       campaign.snapshot_at, campaign.published_at, campaign.withdrawn_at,
       campaign.withdrawal_reason, campaign.publish_idempotency_key, campaign.publish_request_hash,
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
        AND active_dispatch.id = campaign.active_dispatch_id
       WHERE campaign.app_id = ? AND campaign.id = ? FOR UPDATE OF campaign`
      : `${campaignSelect(true)}
       WHERE campaign.app_id = ? AND campaign.id = ?`
    const row = await adapter.one(
      sql,
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
    const clauses = ['user.app_id = ?', 'user.status = \'ACTIVE\'', 'NULLIF(TRIM(profile.nickname), \'\') IS NOT NULL']
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

  return {
    getCampaign,
    getCampaignScope,
    listCampaigns,
    listScopes,
    searchRecipients,
  }
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
    ${campaignOutboxCount('= \'PENDING\'')} AS outbox_pending_count,
    ${campaignOutboxCount('= \'PROCESSING\'')} AS outbox_processing_count,
    ${campaignOutboxCount('= \'FAILED\'')} AS outbox_retrying_count,
    ${campaignOutboxCount('= \'DELIVERED\'')} AS outbox_delivered_count,
    ${campaignOutboxCount('= \'CANCELLED\'')} AS outbox_terminal_count,
    ${campaignExternalTaskCount('= \'PENDING\'')} AS external_task_pending_count,
    ${campaignExternalTaskCount('= \'PROCESSING\'')} AS external_task_processing_count,
    ${campaignExternalTaskCount('= \'FAILED\'')} AS external_task_retrying_count,
    ${campaignExternalTaskCount('= \'DELIVERED\'')} AS external_task_delivered_count,
    ${campaignExternalTaskCount('= \'CANCELLED\'')} AS external_task_terminal_count,
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

function visibleWhere(visibility) {
  if (visibility.platform) {
    return { sql: '1 = 1', params: [] }
  }
  if (!visibility.branchIds.length) {
    return { sql: '0 = 1', params: [] }
  }
  return {
    sql: `(campaign.scope_type = 'BRANCH'
      AND campaign.branch_id IN (${placeholders(visibility.branchIds)}))`,
    params: [...visibility.branchIds],
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) {
    return value.map(String)
  }
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

function iso(value) {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

module.exports = {
  campaignDto,
  createMessageCampaignReadRepository,
}
