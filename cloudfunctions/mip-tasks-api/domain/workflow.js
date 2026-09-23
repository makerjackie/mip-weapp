'use strict'

const { requiredId, boundedText, normalizeRewardConfig, pageLimit, optionalDate, expectedVersion } = require('./validation')
const { idempotentMutation } = require('./idempotency')
const { appendLevelTransition } = require('./level-transitions')
const { readProfileRef } = require('../lib/profile-ref')

function json(value, fallback = null) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value) ?? fallback }
  catch { return fallback }
}

function workflowDto(row) {
  const raw = row.submission_status
  const submissionStatus = row.reward_config_snapshot_json
    ? String(raw || 'pending_review').toLowerCase()
    : row.result_status === 'SUCCESS' ? 'approved' : String(raw || 'reward_failed').toLowerCase()
  return {
    submissionId: row.id,
    submissionStatus,
    assignedOwnerId: row.assigned_owner_id || null,
    starLevel: Number(row.star_level_snapshot || 0),
    reviewRemark: row.review_remark || '',
    reviewedBy: row.reviewed_by_user_id || null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : '',
    rewardConfig: json(row.reward_config_snapshot_json),
    rewardResult: json(row.reward_result_json, {}),
    retryLog: json(row.retry_log_json, []),
    version: Number(row.version || 1),
  }
}

function createTaskWorkflow({ database, createId, assertTasksAdmin, writeAudit }) {
  async function assertTaskOwner(tx, caller, ownerId, capability) {
    const roleKey = await assertTasksAdmin(tx, caller, true)
    if (roleKey === 'PLATFORM_OWNER' || ownerId === caller.userId) return roleKey
    const policy = await tx.one(`SELECT capabilities_json FROM mip_role_capability_policies
      WHERE app_id = ? AND role_key = ? AND policy_mode = 'CUSTOM' FOR UPDATE`, [caller.appId, roleKey])
    const capabilities = json(policy?.capabilities_json, [])
    if (!Array.isArray(capabilities) || !capabilities.includes(capability)) throw new Error('FORBIDDEN')
    return roleKey
  }

  async function reviewPermissions(caller) {
    const roleKey = await assertTasksAdmin(database, caller)
    const policy = roleKey === 'PLATFORM_OWNER' ? null : await database.one(`SELECT capabilities_json FROM mip_role_capability_policies
      WHERE app_id = ? AND role_key = ? AND policy_mode = 'CUSTOM'`, [caller.appId, roleKey])
    const capabilities = json(policy?.capabilities_json, [])
    const any = roleKey === 'PLATFORM_OWNER' || (Array.isArray(capabilities) && capabilities.includes('tasks.review.any'))
    return submission => any || submission.assigned_owner_id === caller.userId
  }

  async function submit(tx, caller, task, attachmentAssetId, prior, occurrenceKey = 'once') {
    const rewardConfig = prior ? json(prior.reward_config_snapshot_json) : normalizeRewardConfig(json(task.reward_config_json))
    if (!rewardConfig || !task.assigned_owner_id) throw new Error('TASK_OWNER_REQUIRED')
    if (prior && prior.submission_status !== 'rejected') throw new Error('INVALID_STATE')
    const completionId = prior?.id || createId()
    if (prior) {
      await tx.query(`UPDATE mip_task_completions SET attachment_asset_id = ?, submission_status = 'pending_review',
        result_status = 'PENDING', result_message = NULL, version = version + 1,
        completed_at = UTC_TIMESTAMP(3)
        WHERE app_id = ? AND id = ? AND submission_status = 'rejected'`, [attachmentAssetId, caller.appId, completionId])
    }
    else {
      await tx.query(`INSERT INTO mip_task_completions (
        id, app_id, task_id, user_id, task_version, task_name_snapshot, task_content_snapshot,
        attachment_asset_id, reward_experience, result_status, submission_status,
        assigned_owner_id, reward_config_snapshot_json, star_level_snapshot, occurrence_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'pending_review', ?, ?, ?, ?)`, [
        completionId, caller.appId, task.id, caller.userId, Number(task.version), task.name, task.content,
        attachmentAssetId, task.assigned_owner_id, JSON.stringify(rewardConfig), Number(task.star_level || 1), occurrenceKey,
      ])
    }
    return {
      id: completionId, taskId: task.id, taskName: task.name, rewardExperience: 0,
      resultStatus: 'PENDING', submissionStatus: 'pending_review', alreadyCompleted: false,
    }
  }

  async function review(caller, value, decision) {
    const submissionId = requiredId(value.submissionId)
    const remark = boundedText(value.remark, 500, decision === 'REJECT')
    return idempotentMutation(database, {
      caller, createId, operation: `tasks.admin.review.${decision.toLowerCase()}`,
      idempotencyKey: value.idempotencyKey, request: { submissionId, remark },
      authorize: tx => assertTasksAdmin(tx, caller, true),
      work: async tx => {
        const submission = await tx.one(`SELECT * FROM mip_task_completions WHERE app_id = ? AND id = ? FOR UPDATE`, [caller.appId, submissionId])
        if (!submission) throw new Error('NOT_FOUND')
        const roleKey = await assertTaskOwner(tx, caller, submission.assigned_owner_id, 'tasks.review.any')
        if (submission.submission_status === 'approved' && decision !== 'REJECT') return workflowDto(submission)
        if (decision === 'RETRY' ? submission.submission_status !== 'reward_failed' : submission.submission_status !== 'pending_review') throw new Error('INVALID_STATE')
        if (decision === 'REJECT') {
          await tx.query(`UPDATE mip_task_completions SET submission_status = 'rejected', result_status = 'PENDING',
            review_remark = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3), version = version + 1
            WHERE app_id = ? AND id = ?`, [remark, caller.userId, caller.appId, submissionId])
          await recordReview(tx, caller, submission, 'REJECT', remark, {})
          await writeAudit(tx, caller, roleKey, 'task.submission.rejected', submissionId, { remark })
          return { ...workflowDto(submission), submissionStatus: 'rejected', reviewRemark: remark }
        }
        const rewardConfig = normalizeRewardConfig(json(submission.reward_config_snapshot_json))
        let rewardResult
        let failure = ''
        await tx.query('SAVEPOINT task_reward')
        try {
          rewardResult = await grantRewards(tx, caller, submission, rewardConfig)
          await tx.query('RELEASE SAVEPOINT task_reward')
        }
        catch (error) {
          if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) throw error
          await tx.query('ROLLBACK TO SAVEPOINT task_reward')
          await tx.query('RELEASE SAVEPOINT task_reward')
          failure = /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'REWARD_UNAVAILABLE'
          rewardResult = { error: failure }
        }
        const status = failure ? 'reward_failed' : 'approved'
        const retryLog = json(submission.retry_log_json, [])
        if (decision === 'RETRY') retryLog.push({ retriedBy: caller.userId, retriedAt: new Date().toISOString(), result: status, error: failure || undefined })
        await tx.query(`UPDATE mip_task_completions SET submission_status = ?, result_status = ?, result_message = ?,
          reward_experience = ?, growth_entry_id = ?, review_remark = ?, reviewed_by_user_id = ?,
          reviewed_at = UTC_TIMESTAMP(3), reward_result_json = ?, retry_log_json = ?, version = version + 1
          WHERE app_id = ? AND id = ?`, [status, failure ? 'FAILED' : 'SUCCESS', failure || null,
          failure ? 0 : rewardResult.experience?.amount || 0, failure ? null : rewardResult.experience?.entryId || null,
          remark, caller.userId, JSON.stringify(rewardResult), JSON.stringify(retryLog), caller.appId, submissionId])
        if (!failure) await tx.query(`INSERT INTO mip_outbox_events
          (id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json, status)
          VALUES (?, ?, 'TASK_COMPLETION', ?, 'task.completed', 1, JSON_OBJECT(), 'PENDING')`, [createId(), caller.appId, submissionId])
        await recordReview(tx, caller, submission, decision === 'RETRY' ? 'REQUEST_RETRY' : 'APPROVE', remark, rewardResult)
        await writeAudit(tx, caller, roleKey, `task.submission.${status}`, submissionId, { decision, failure: failure || undefined })
        return { ...workflowDto(submission), submissionStatus: status, rewardResult, retryLog, reviewRemark: remark }
      },
    })
  }

  async function recordReview(tx, caller, submission, action, remark, result) {
    await tx.query(`INSERT INTO mip_task_submission_reviews
      (app_id, submission_id, task_id, user_id, action, remark, reviewed_by_user_id, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [caller.appId, submission.id, submission.task_id, submission.user_id,
      action, remark || null, caller.userId, JSON.stringify(result)])
  }

  async function grantRewards(tx, caller, submission, config) {
    const member = await tx.one('SELECT status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE', [caller.appId, submission.user_id])
    if (member?.status !== 'ACTIVE') throw new Error('MEMBER_NOT_FOUND')
    await tx.query(`INSERT INTO mip_growth_accounts (app_id, user_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, [caller.appId, submission.user_id])
    const account = await tx.one(`SELECT experience_balance, contribution_balance, version FROM mip_growth_accounts
      WHERE app_id = ? AND user_id = ? FOR UPDATE`, [caller.appId, submission.user_id])
    if (!account) throw new Error('REWARD_UNAVAILABLE')
    const result = {}
    for (const [key, column, metric] of [['experience', 'experience_balance', 'EXPERIENCE'], ['contribution', 'contribution_balance', 'CONTRIBUTION']]) {
      if (!config[key].enabled) continue
      const existing = await tx.one(`SELECT id, delta_value, balance_after FROM mip_growth_entries
        WHERE app_id = ? AND user_id = ? AND source_event_type = 'task.completed' AND source_event_id = ? AND metric = ?`,
      [caller.appId, submission.user_id, submission.id, metric])
      if (existing) {
        result[key] = { granted: true, amount: Number(existing.delta_value), entryId: existing.id }
        continue
      }
      const amount = config[key].amount
      const before = Number(account[column] || 0)
      const after = before + amount
      if (!Number.isSafeInteger(after)) throw new Error('REWARD_LIMIT_EXCEEDED')
      const entryId = createId()
      await tx.query(`UPDATE mip_growth_accounts SET ${column} = ?, version = version + 1 WHERE app_id = ? AND user_id = ?`, [after, caller.appId, submission.user_id])
      await tx.query(`INSERT INTO mip_growth_entries (id, app_id, user_id, rule_id, source_event_id, source_event_type,
        metric, delta_value, balance_after, adjustment_reason, actor_user_id)
        VALUES (?, ?, ?, NULL, ?, 'task.completed', ?, ?, ?, NULL, ?)`, [entryId, caller.appId, submission.user_id,
        submission.id, metric, amount, after, caller.userId])
      await tx.query(`INSERT INTO mip_outbox_events (id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json, status)
        VALUES (?, ?, 'GROWTH_ENTRY', ?, 'growth.changed', ?, JSON_OBJECT(), 'PENDING')`, [createId(), caller.appId, entryId, Number(account.version) + 1])
      account.version = Number(account.version) + 1
      if (metric === 'EXPERIENCE') await appendLevelTransition(tx, { createId, appId: caller.appId, userId: submission.user_id,
        sourceEventId: submission.id, sourceEventType: 'task.completed', experienceBefore: before, experienceAfter: after })
      result[key] = { granted: true, amount, entryId }
    }
    if (config.bonus.enabled) result.bonus = { granted: false, amount: config.bonus.amount, status: 'OFFLINE_PENDING' }
    return result
  }

  async function assignTask(caller, value) {
    const taskId = requiredId(value.taskId)
    const version = expectedVersion(value.expectedVersion)
    const assignMode = value.assignMode === 'manual' ? 'batch' : value.assignMode
    if (!['single', 'batch', 'weekly'].includes(assignMode)) throw new Error('VALIDATION_FAILED')
    const recipients = normalizeRecipients(value.recipients, caller)
    let weeklyStartAt = optionalDate(value.weeklyStartAt)
    const weeklyEndAt = optionalDate(value.weeklyEndAt)
    const weeklyDeliverAt = boundedText(value.weeklyDeliverAt, 5)
    if (assignMode === 'weekly' && (!weeklyStartAt || !weeklyEndAt || weeklyEndAt <= weeklyStartAt
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(weeklyDeliverAt))) throw new Error('VALIDATION_FAILED')
    if (assignMode === 'weekly') {
      const localDate = new Date(weeklyStartAt.getTime() + 8 * 3600000).toISOString().slice(0, 10)
      weeklyStartAt = new Date(`${localDate}T${weeklyDeliverAt}:00+08:00`)
      if (weeklyEndAt <= weeklyStartAt) throw new Error('VALIDATION_FAILED')
    }
    return idempotentMutation(database, {
      caller, createId, operation: 'tasks.admin.assign', idempotencyKey: value.idempotencyKey,
      request: { taskId, version, assignMode, recipients, weeklyStartAt, weeklyEndAt, weeklyDeliverAt },
      authorize: tx => assertTasksAdmin(tx, caller, true),
      work: async tx => {
        const task = await tx.one('SELECT * FROM mip_task_cards WHERE app_id = ? AND id = ? FOR UPDATE', [caller.appId, taskId])
        if (!task || task.status === 'DELETED') throw new Error('NOT_FOUND')
        if (Number(task.version) !== version) throw new Error('CONFLICT')
        if (!task.assigned_owner_id) throw new Error('TASK_OWNER_REQUIRED')
        if (task.assignment_mode !== 'SELECTED') throw new Error('ASSIGNMENT_MODE_REQUIRED')
        const roleKey = await assertTaskOwner(tx, caller, task.assigned_owner_id, 'tasks.assign.any')
        const members = await resolveRecipients(tx, caller.appId, recipients)
        if (!members.length || members.length > 100 || (assignMode === 'single' && members.length !== 1)) throw new Error('VALIDATION_FAILED')
        const serverIds = json(task.applicable_servers_json, [])
        if (serverIds.length && members.some(member => !serverIds.includes(member.primary_branch_id))) throw new Error('MEMBER_NOT_ELIGIBLE')
        const assignmentIds = []
        for (const member of members) {
          const id = createId()
          await tx.query(`INSERT INTO mip_task_assignments (id, app_id, task_id, user_id, status, assigned_by_user_id,
            assign_mode, recipients_json, task_version, weekly_deliver_at, weekly_start_at, weekly_end_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE status = 'ACTIVE', revoked_at = NULL, revoked_by_user_id = NULL,
            version = version + 1, assigned_by_user_id = VALUES(assigned_by_user_id), assigned_at = UTC_TIMESTAMP(3),
            assign_mode = VALUES(assign_mode), recipients_json = VALUES(recipients_json), task_version = VALUES(task_version),
            weekly_deliver_at = VALUES(weekly_deliver_at), weekly_start_at = VALUES(weekly_start_at), weekly_end_at = VALUES(weekly_end_at)`,
          [id, caller.appId, taskId, member.id, caller.userId, assignMode, JSON.stringify(recipients), version,
            assignMode === 'weekly' ? weeklyDeliverAt : null, assignMode === 'weekly' ? weeklyStartAt : null, assignMode === 'weekly' ? weeklyEndAt : null])
          const saved = await tx.one('SELECT id FROM mip_task_assignments WHERE app_id = ? AND task_id = ? AND user_id = ?', [caller.appId, taskId, member.id])
          if (!saved) throw new Error('CONFLICT')
          assignmentIds.push(saved.id)
        }
        await writeAudit(tx, caller, roleKey, 'task.assigned', taskId, { recipients, resolvedUserIds: members.map(m => m.id), assignMode, taskVersion: version })
        return { taskId, assignmentId: assignmentIds[0], assignedCount: members.length, assignMode }
      },
    })
  }

  async function listAssignments(caller, value = {}) {
    await assertTasksAdmin(database, caller)
    const taskId = value.taskId ? requiredId(value.taskId) : null
    const rows = await database.query(`SELECT assignment.*, profile.nickname, actor.nickname AS assigned_by_name
      FROM mip_task_assignments assignment LEFT JOIN mip_profiles profile
      ON profile.app_id = assignment.app_id AND profile.user_id = assignment.user_id
      LEFT JOIN mip_profiles actor ON actor.app_id = assignment.app_id AND actor.user_id = assignment.assigned_by_user_id
      WHERE assignment.app_id = ? AND (? IS NULL OR assignment.task_id = ?)
      ORDER BY assignment.assigned_at DESC, assignment.id DESC LIMIT ?`, [caller.appId, taskId, taskId, pageLimit(value.limit, 100)])
    return { items: rows.map(row => ({ id: row.id, taskId: row.task_id, userId: row.user_id, nickname: row.nickname,
      assignedBy: row.assigned_by_user_id, assignedByName: row.assigned_by_name, assignedAt: row.assigned_at,
      assignMode: row.assign_mode, taskVersion: Number(row.task_version), recipients: json(row.recipients_json),
      status: row.status, weeklyDeliverAt: row.weekly_deliver_at, weeklyStartAt: row.weekly_start_at, weeklyEndAt: row.weekly_end_at })), nextCursor: null }
  }

  return { submit, reviewPermissions, approveSubmission: (caller, value) => review(caller, value, 'APPROVE'),
    rejectSubmission: (caller, value) => review(caller, value, 'REJECT'),
    retrySubmissionReward: (caller, value) => review(caller, value, 'RETRY'), assignTask, listAssignments }
}

function normalizeRecipients(value, caller) {
  let source = Array.isArray(value) ? { userIds: value.map(ref => readProfileRef(ref, caller.appId, caller.profileRefSecret)) } : value
  if (!source || typeof source !== 'object') throw new Error('VALIDATION_FAILED')
  if (source.memberRefs !== undefined) {
    if (!Array.isArray(source.memberRefs) || source.memberRefs.length > 100) throw new Error('VALIDATION_FAILED')
    source = { ...source, userIds: [...(source.userIds || []), ...source.memberRefs.map(ref => readProfileRef(ref, caller.appId, caller.profileRefSecret))] }
  }
  const result = {}
  for (const key of ['userIds', 'roleIds', 'serverIds', 'tagIds']) {
    const items = source[key] || []
    if (!Array.isArray(items) || items.length > 100) throw new Error('VALIDATION_FAILED')
    result[key] = [...new Set(items.map(item => key === 'roleIds' ? boundedText(item, 32, true) : requiredId(item)))]
  }
  if (!Object.values(result).some(items => items.length)) throw new Error('VALIDATION_FAILED')
  return result
}

async function resolveRecipients(tx, appId, recipients) {
  const clauses = []
  const params = [appId]
  for (const [key, expression] of [
    ['userIds', 'member.id'], ['serverIds', 'member.primary_branch_id'],
    ['roleIds', `member.id IN (SELECT user_id FROM mip_admin_role_bindings WHERE app_id = ? AND status = 'ACTIVE' AND role_key`],
    ['tagIds', 'member.id IN (SELECT user_id FROM mip_profile_tags WHERE app_id = ? AND tag_id'],
  ]) {
    const values = recipients[key]
    if (!values.length) continue
    const nested = key === 'roleIds' || key === 'tagIds'
    clauses.push(`${expression} IN (${values.map(() => '?').join(',')})${nested ? ')' : ''}`)
    if (nested) params.push(appId)
    params.push(...values)
  }
  const rows = await tx.query(`SELECT member.id, member.primary_branch_id FROM mip_users member
    WHERE member.app_id = ? AND member.status = 'ACTIVE' AND (${clauses.join(' OR ')}) ORDER BY member.id LIMIT 101 FOR UPDATE`, params)
  if (recipients.userIds.some(id => !rows.some(row => row.id === id))) throw new Error('MEMBER_NOT_FOUND')
  return rows
}

module.exports = { createTaskWorkflow, workflowDto, normalizeRecipients }
