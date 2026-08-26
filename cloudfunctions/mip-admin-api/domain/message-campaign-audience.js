'use strict'

const MAX_EXPLICIT_RECIPIENTS = 100

function createMessageCampaignAudience(maximumRecipients) {
  async function assertDraftRecipients(tx, appId, draft) {
    if (draft.scopeType === 'BRANCH') {
      const branch = await tx.one(
        `SELECT id FROM mip_city_branches
         WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [appId, draft.branchId],
      )
      if (!branch) {
        throw codeError('VALIDATION_FAILED')
      }
    }
    if (draft.audienceType !== 'EXPLICIT') {
      return
    }
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

  async function snapshotRecipients(tx, appId, campaign) {
    const recipients = await selectSnapshotRecipients(
      tx,
      appId,
      campaign,
      maximumRecipients + 1,
    )
    if (recipients.length > maximumRecipients) {
      throw codeError('MESSAGE_RECIPIENT_LIMIT_EXCEEDED')
    }
    if (!recipients.length) {
      throw codeError('MESSAGE_RECIPIENTS_EMPTY')
    }
    return recipients
  }

  return {
    assertDraftRecipients,
    snapshotRecipients,
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

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function codeError(code, retryable = false) {
  const error = new Error(code)
  error.code = code
  error.retryable = retryable
  return error
}

module.exports = {
  MAX_EXPLICIT_RECIPIENTS,
  createMessageCampaignAudience,
}
