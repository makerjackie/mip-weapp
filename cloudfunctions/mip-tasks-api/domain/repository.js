'use strict'

const { randomUUID } = require('node:crypto')
const {
  decodeCursor,
  encodeCursor,
  expectedVersion,
  normalizeAssignmentInput,
  normalizeCompletionFilters,
  normalizeMemberFilters,
  normalizeTask,
  normalizeTaskFilters,
  pageLimit,
  requiredId,
} = require('./validation')
const { buildTaskWorkbook } = require('./workbook')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const TASKS_CAPABILITY = 'tasks.manage'
const TASK_ADMIN_ROLES = new Set(['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'])

function createTaskRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function getAdminSession(caller) {
    const roleKey = await assertTasksAdmin(database, caller)
    return { capability: TASKS_CAPABILITY, roleKey }
  }

  async function listTasks(caller, event = {}) {
    const limit = pageLimit(event.limit)
    const cursor = decodeCursor(event.cursor)
    const params = [caller.userId, caller.appId, caller.userId]
    let cursorSql = ''
    if (cursor) {
      cursorSql = 'AND (task.published_at < ? OR (task.published_at = ? AND task.id < ?))'
      params.push(cursor.at, cursor.at, cursor.id)
    }
    params.push(limit + 1)
    const rows = await database.query(
      `SELECT task.*, completion.id AS completion_id, completion.completed_at,
              completion.reward_experience AS awarded_experience
       FROM mip_task_cards task
       LEFT JOIN mip_task_completions completion
         ON completion.app_id = task.app_id AND completion.task_id = task.id
        AND completion.user_id = ?
       WHERE task.app_id = ? AND task.status = 'PUBLISHED'
         AND (task.assignment_mode = 'ALL' OR EXISTS (
           SELECT 1 FROM mip_task_assignments assignment
           WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
             AND assignment.user_id = ? AND assignment.status = 'ACTIVE'
         )) ${cursorSql}
       ORDER BY task.published_at DESC, task.id DESC LIMIT ?`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      items: page.map(row => userTaskDto(row)),
      nextCursor: rows.length > limit ? encodeCursor({ ...page.at(-1), updated_at: page.at(-1).published_at }) : undefined,
    }
  }

  async function getTask(caller, value) {
    const taskId = requiredId(value.taskId)
    const row = await database.one(
      `SELECT task.*, completion.id AS completion_id, completion.completed_at,
              completion.reward_experience AS awarded_experience,
              template.cloud_file_id AS template_url,
              template.content_type AS template_content_type,
              template.content_bytes AS template_bytes
       FROM mip_task_cards task
       LEFT JOIN mip_task_completions completion
         ON completion.app_id = task.app_id AND completion.task_id = task.id
        AND completion.user_id = ?
       LEFT JOIN mip_media_assets template
         ON template.app_id = task.app_id AND template.id = task.template_asset_id
        AND template.status = 'READY' AND template.purpose = 'TASK_TEMPLATE'
       WHERE task.app_id = ? AND task.id = ? AND task.status = 'PUBLISHED'
         AND (task.assignment_mode = 'ALL' OR EXISTS (
           SELECT 1 FROM mip_task_assignments assignment
           WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
             AND assignment.user_id = ? AND assignment.status = 'ACTIVE'
         ))`,
      [caller.userId, caller.appId, taskId, caller.userId],
    )
    if (!row) throw new Error('NOT_FOUND')
    return userTaskDto(row, true)
  }

  async function completeTask(caller, value) {
    const taskId = requiredId(value.taskId)
    const attachmentAssetId = value.attachmentAssetId ? requiredId(value.attachmentAssetId) : null
    return database.transaction(async (tx) => {
      const user = await tx.one(
        `SELECT status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, caller.userId],
      )
      if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
      const task = await tx.one(
        `SELECT id, name, content, reward_experience, attachment_required, assignment_mode,
                ends_at, status, version,
                CASE WHEN ends_at IS NOT NULL AND ends_at <= UTC_TIMESTAMP(3) THEN 1 ELSE 0 END AS is_ended
         FROM mip_task_cards WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, taskId],
      )
      if (!task || task.status !== 'PUBLISHED') throw new Error('NOT_FOUND')
      const prior = await completionRow(tx, caller.appId, caller.userId, taskId)
      if (prior) return completionDto(prior, true)
      if (Boolean(task.is_ended)) throw new Error('TASK_ENDED')
      if (task.assignment_mode === 'SELECTED') {
        const assignment = await tx.one(
          `SELECT status FROM mip_task_assignments
           WHERE app_id = ? AND task_id = ? AND user_id = ? FOR UPDATE`,
          [caller.appId, taskId, caller.userId],
        )
        if (!assignment || assignment.status !== 'ACTIVE') throw new Error('FORBIDDEN')
      }
      if (Boolean(task.attachment_required) && !attachmentAssetId) throw new Error('ATTACHMENT_REQUIRED')
      let attachment = null
      if (attachmentAssetId) {
        attachment = await tx.one(
          `SELECT id, cloud_file_id, content_bytes, content_type, width_px, height_px,
                  status, purpose, owner_user_id
           FROM mip_media_assets WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, attachmentAssetId],
        )
        if (!attachment || attachment.status !== 'READY' || attachment.purpose !== 'TASK_ATTACHMENT'
          || attachment.owner_user_id !== caller.userId
          || typeof attachment.cloud_file_id !== 'string'
          || !attachment.cloud_file_id.startsWith('cloud://')
          || !['image/jpeg', 'image/png'].includes(attachment.content_type)
          || !Number.isSafeInteger(Number(attachment.content_bytes))
          || Number(attachment.content_bytes) < 1
          || Number(attachment.content_bytes) > 10 * 1024 * 1024) {
          throw new Error('ATTACHMENT_INVALID')
        }
        if (!Number.isSafeInteger(Number(attachment.width_px)) || Number(attachment.width_px) < 1
          || !Number.isSafeInteger(Number(attachment.height_px)) || Number(attachment.height_px) < 1) {
          throw new Error('ATTACHMENT_INVALID')
        }
      }
      const completionId = createId()
      const rewardExperience = Number(task.reward_experience)
      let growthEntryId = null
      let balanceAfter = null
      if (rewardExperience > 0) {
        await tx.query(
          `INSERT INTO mip_growth_accounts (app_id, user_id)
           VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
          [caller.appId, caller.userId],
        )
        const account = await tx.one(
          `SELECT experience_balance, version FROM mip_growth_accounts
           WHERE app_id = ? AND user_id = ? FOR UPDATE`,
          [caller.appId, caller.userId],
        )
        balanceAfter = Number(account.experience_balance) + rewardExperience
        await tx.query(
          `UPDATE mip_growth_accounts SET experience_balance = ?, version = version + 1
           WHERE app_id = ? AND user_id = ?`,
          [balanceAfter, caller.appId, caller.userId],
        )
        growthEntryId = createId()
        await tx.query(
          `INSERT INTO mip_growth_entries (
             id, app_id, user_id, rule_id, source_event_id, source_event_type,
             metric, delta_value, balance_after, adjustment_reason, actor_user_id
           ) VALUES (?, ?, ?, NULL, ?, 'task.completed', 'EXPERIENCE', ?, ?, NULL, NULL)`,
          [growthEntryId, caller.appId, caller.userId, completionId, rewardExperience, balanceAfter],
        )
        await tx.query(
          `INSERT INTO mip_outbox_events (
             id, app_id, aggregate_type, aggregate_id, event_type,
             source_version, payload_json, status
           ) VALUES (?, ?, 'GROWTH_ENTRY', ?, 'growth.changed', ?, JSON_OBJECT(), 'PENDING')`,
          [createId(), caller.appId, growthEntryId, Number(account.version) + 1],
        )
      }
      await tx.query(
        `INSERT INTO mip_task_completions (
           id, app_id, task_id, user_id, task_version, task_name_snapshot,
           task_content_snapshot, attachment_asset_id, reward_experience,
           growth_entry_id, result_status, result_message
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', NULL)`,
        [
          completionId,
          caller.appId,
          taskId,
          caller.userId,
          Number(task.version),
          task.name,
          task.content,
          attachmentAssetId,
          rewardExperience,
          growthEntryId,
        ],
      )
      await tx.query(
        `INSERT INTO mip_outbox_events (
           id, app_id, aggregate_type, aggregate_id, event_type,
           source_version, payload_json, status
         ) VALUES (?, ?, 'TASK_COMPLETION', ?, 'task.completed', 1, JSON_OBJECT(), 'PENDING')`,
        [createId(), caller.appId, completionId],
      )
      const row = await completionRow(tx, caller.appId, caller.userId, taskId)
      return { ...completionDto(row, false), balanceAfter }
    })
  }

  async function listAdminTasks(caller, event = {}) {
    await assertTasksAdmin(database, caller)
    const filters = normalizeTaskFilters(event.filters)
    const limit = pageLimit(event.limit)
    const cursor = decodeCursor(event.cursor)
    const clauses = ['task.app_id = ?']
    const params = [caller.appId]
    if (filters.status) {
      clauses.push('task.status = ?')
      params.push(filters.status)
    }
    else {
      clauses.push("task.status <> 'DELETED'")
    }
    if (filters.query) {
      clauses.push('(task.name LIKE ? OR task.content LIKE ?)')
      params.push(`%${filters.query}%`, `%${filters.query}%`)
    }
    if (cursor) {
      clauses.push('(task.updated_at < ? OR (task.updated_at = ? AND task.id < ?))')
      params.push(cursor.at, cursor.at, cursor.id)
    }
    params.push(limit + 1)
    const rows = await database.query(
      `SELECT task.*,
              (SELECT COUNT(*) FROM mip_task_completions completion
               WHERE completion.app_id = task.app_id AND completion.task_id = task.id
                 AND completion.result_status = 'SUCCESS') AS completion_count,
              (SELECT COUNT(*) FROM mip_task_assignments assignment
               WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
                 AND assignment.status = 'ACTIVE') AS assignment_count
       FROM mip_task_cards task WHERE ${clauses.join(' AND ')}
       ORDER BY task.updated_at DESC, task.id DESC LIMIT ?`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      items: page.map(row => adminTaskDto(row)),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function getAdminTask(caller, value) {
    await assertTasksAdmin(database, caller)
    const taskId = requiredId(value.taskId)
    const row = await database.one(
      `SELECT task.*,
              (SELECT COUNT(*) FROM mip_task_completions completion
               WHERE completion.app_id = task.app_id AND completion.task_id = task.id
                 AND completion.result_status = 'SUCCESS') AS completion_count,
              (SELECT COUNT(*) FROM mip_task_assignments assignment
               WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
                 AND assignment.status = 'ACTIVE') AS assignment_count,
              template.cloud_file_id AS template_url,
              template.content_type AS template_content_type,
              template.content_bytes AS template_bytes
       FROM mip_task_cards task
       LEFT JOIN mip_media_assets template
         ON template.app_id = task.app_id AND template.id = task.template_asset_id
        AND template.status = 'READY' AND template.purpose = 'TASK_TEMPLATE'
       WHERE task.app_id = ? AND task.id = ?`,
      [caller.appId, taskId],
    )
    if (!row || row.status === 'DELETED') throw new Error('NOT_FOUND')
    return adminTaskDto(row, true)
  }

  async function saveTask(caller, value) {
    const draft = normalizeTask(value.task)
    const taskId = value.taskId ? requiredId(value.taskId) : createId()
    const version = value.taskId ? expectedVersion(value.expectedVersion) : null
    return database.transaction(async (tx) => {
      const roleKey = await assertTasksAdmin(tx, caller, true)
      if (draft.templateAssetId) await assertTaskTemplate(tx, caller, draft.templateAssetId)
      if (!value.taskId) {
        await tx.query(
          `INSERT INTO mip_task_cards (
             id, app_id, name, content, reward_experience, attachment_required,
             assignment_mode, ends_at, template_asset_id, status, created_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
          [taskId, caller.appId, draft.name, draft.content, draft.rewardExperience,
            draft.attachmentRequired ? 1 : 0, draft.assignmentMode, draft.endsAt,
            draft.templateAssetId, caller.userId],
        )
        await writeAudit(tx, caller, roleKey, 'task.created', taskId, { status: 'DRAFT' })
      }
      else {
        const current = await tx.one(
          `SELECT status, version FROM mip_task_cards
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, taskId],
        )
        if (!current || current.status === 'DELETED') throw new Error('NOT_FOUND')
        if (Number(current.version) !== version) throw new Error('CONFLICT')
        const result = await tx.query(
          `UPDATE mip_task_cards SET name = ?, content = ?, reward_experience = ?,
             attachment_required = ?, assignment_mode = ?, ends_at = ?, template_asset_id = ?,
             version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.name, draft.content, draft.rewardExperience, draft.attachmentRequired ? 1 : 0,
            draft.assignmentMode, draft.endsAt, draft.templateAssetId, caller.appId, taskId, version],
        )
        if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
        await writeAudit(tx, caller, roleKey, 'task.updated', taskId, { status: current.status })
      }
      const row = await tx.one(
        `SELECT task.*,
                (SELECT COUNT(*) FROM mip_task_completions completion
                 WHERE completion.app_id = task.app_id AND completion.task_id = task.id
                   AND completion.result_status = 'SUCCESS') AS completion_count,
                (SELECT COUNT(*) FROM mip_task_assignments assignment
                 WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
                   AND assignment.status = 'ACTIVE') AS assignment_count
         FROM mip_task_cards task WHERE task.app_id = ? AND task.id = ?`,
        [caller.appId, taskId],
      )
      return adminTaskDto(row)
    })
  }

  async function transitionTask(caller, value, targetStatus) {
    const taskId = requiredId(value.taskId)
    const version = expectedVersion(value.expectedVersion)
    const allowed = {
      PUBLISHED: new Set(['DRAFT', 'UNPUBLISHED']),
      UNPUBLISHED: new Set(['PUBLISHED']),
      DELETED: new Set(['DRAFT', 'UNPUBLISHED', 'PUBLISHED']),
    }
    return database.transaction(async (tx) => {
      const roleKey = await assertTasksAdmin(tx, caller, true)
      const current = await tx.one(
        `SELECT * FROM mip_task_cards WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, taskId],
      )
      if (!current || current.status === 'DELETED') throw new Error('NOT_FOUND')
      if (Number(current.version) !== version) throw new Error('CONFLICT')
      if (!allowed[targetStatus]?.has(current.status)) throw new Error('INVALID_STATE')
      const nextVersion = version + 1
      const publishedAtSql = targetStatus === 'PUBLISHED'
        ? 'published_at = UTC_TIMESTAMP(3), deleted_at = NULL'
        : targetStatus === 'DELETED'
          ? 'deleted_at = UTC_TIMESTAMP(3)'
          : 'deleted_at = NULL'
      const result = await tx.query(
        `UPDATE mip_task_cards SET status = ?, ${publishedAtSql}, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [targetStatus, caller.appId, taskId, version],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
      await writeAudit(tx, caller, roleKey, `task.${targetStatus.toLowerCase()}`, taskId, {
        fromStatus: current.status,
        toStatus: targetStatus,
      })
      await tx.query(
        `INSERT INTO mip_outbox_events (
           id, app_id, aggregate_type, aggregate_id, event_type,
           source_version, payload_json, status
         ) VALUES (?, ?, 'TASK', ?, ?, ?, JSON_OBJECT(), 'PENDING')`,
        [createId(), caller.appId, taskId, `task.${targetStatus.toLowerCase()}`, nextVersion],
      )
      const row = await tx.one(
        `SELECT task.*,
                (SELECT COUNT(*) FROM mip_task_completions completion
                 WHERE completion.app_id = task.app_id AND completion.task_id = task.id
                   AND completion.result_status = 'SUCCESS') AS completion_count,
                (SELECT COUNT(*) FROM mip_task_assignments assignment
                 WHERE assignment.app_id = task.app_id AND assignment.task_id = task.id
                   AND assignment.status = 'ACTIVE') AS assignment_count
         FROM mip_task_cards task WHERE task.app_id = ? AND task.id = ?`,
        [caller.appId, taskId],
      )
      return adminTaskDto(row)
    })
  }

  async function listAssignableMembers(caller, event = {}) {
    await assertTasksAdmin(database, caller)
    const filters = normalizeMemberFilters(event.filters)
    const task = await database.one(
      `SELECT assignment_mode, status FROM mip_task_cards
       WHERE app_id = ? AND id = ?`,
      [caller.appId, filters.taskId],
    )
    if (!task || task.status === 'DELETED') throw new Error('NOT_FOUND')
    if (task.assignment_mode !== 'SELECTED') throw new Error('ASSIGNMENT_MODE_REQUIRED')
    const limit = pageLimit(event.limit)
    const cursor = decodeCursor(event.cursor)
    const clauses = ["member.app_id = ?", "member.status = 'ACTIVE'"]
    const params = [filters.taskId || null, caller.appId]
    if (filters.query) {
      clauses.push('(profile.nickname LIKE ? OR branch.name LIKE ?)')
      params.push(`%${filters.query}%`, `%${filters.query}%`)
    }
    if (cursor) {
      clauses.push('(member.updated_at < ? OR (member.updated_at = ? AND member.id < ?))')
      params.push(cursor.at, cursor.at, cursor.id)
    }
    params.push(limit + 1)
    const rows = await database.query(
      `SELECT member.id, member.updated_at,
              COALESCE(NULLIF(profile.nickname, ''), '未设置昵称') AS nickname,
              COALESCE(branch.name, '未设置分会') AS branch_name,
              assignment.status AS assignment_status,
              assignment.assigned_at, assignment.revoked_at
       FROM mip_users member
       LEFT JOIN mip_profiles profile
         ON profile.app_id = member.app_id AND profile.user_id = member.id
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = member.app_id AND branch.id = member.primary_branch_id
       LEFT JOIN mip_task_assignments assignment
         ON assignment.app_id = member.app_id AND assignment.user_id = member.id
        AND assignment.task_id = ?
       WHERE ${clauses.join(' AND ')}
       ORDER BY member.updated_at DESC, member.id DESC LIMIT ?`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      items: page.map(row => assignmentMemberDto(row, caller)),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function changeAssignments(caller, value, targetStatus) {
    const input = normalizeAssignmentInput(value)
    const version = expectedVersion(value.expectedVersion)
    const userIds = [...new Set(input.memberRefs.map(
      ref => readProfileRef(ref, caller.appId, caller.profileRefSecret),
    ))]
    return database.transaction(async (tx) => {
      const roleKey = await assertTasksAdmin(tx, caller, true)
      const task = await tx.one(
        `SELECT status, assignment_mode, version FROM mip_task_cards
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, input.taskId],
      )
      if (!task || task.status === 'DELETED') throw new Error('NOT_FOUND')
      if (Number(task.version) !== version) throw new Error('CONFLICT')
      if (task.assignment_mode !== 'SELECTED') throw new Error('ASSIGNMENT_MODE_REQUIRED')
      const placeholders = userIds.map(() => '?').join(', ')
      const members = await tx.query(
        `SELECT id FROM mip_users WHERE app_id = ? AND status = 'ACTIVE'
         AND id IN (${placeholders})`,
        [caller.appId, ...userIds],
      )
      if (members.length !== userIds.length) throw new Error('MEMBER_NOT_FOUND')
      let changed = 0
      if (targetStatus === 'ACTIVE') {
        for (const memberId of userIds) {
          const result = await tx.query(
            `INSERT INTO mip_task_assignments (
               id, app_id, task_id, user_id, status, assigned_by_user_id
             ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)
             ON DUPLICATE KEY UPDATE
               version = IF(status = 'ACTIVE', version, version + 1),
               assigned_by_user_id = IF(status = 'ACTIVE', assigned_by_user_id, VALUES(assigned_by_user_id)),
               assigned_at = IF(status = 'ACTIVE', assigned_at, UTC_TIMESTAMP(3)),
               revoked_by_user_id = NULL,
               revoked_at = NULL,
               status = 'ACTIVE'`,
            [createId(), caller.appId, input.taskId, memberId, caller.userId],
          )
          if (Number(result.affectedRows) > 0) changed += 1
        }
      }
      else {
        const result = await tx.query(
          `UPDATE mip_task_assignments SET status = 'REVOKED', version = version + 1,
             revoked_by_user_id = ?, revoked_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND task_id = ? AND status = 'ACTIVE'
             AND user_id IN (${placeholders})`,
          [caller.userId, caller.appId, input.taskId, ...userIds],
        )
        changed = Number(result.affectedRows || 0)
      }
      await writeAudit(tx, caller, roleKey,
        targetStatus === 'ACTIVE' ? 'task.assignments.assigned' : 'task.assignments.revoked',
        input.taskId, { requestedCount: userIds.length, changedCount: changed })
      return { taskId: input.taskId, requestedCount: userIds.length, changedCount: changed }
    })
  }

  async function listCompletions(caller, event = {}) {
    await assertTasksAdmin(database, caller)
    const limit = pageLimit(event.limit)
    const cursor = decodeCursor(event.cursor)
    const { sql, params } = completionWhere(caller.appId, normalizeCompletionFilters(event.filters), cursor)
    params.push(limit + 1)
    const rows = await database.query(`${completionSelect()} WHERE ${sql}
      ORDER BY completion.completed_at DESC, completion.id DESC LIMIT ?`, params)
    const page = rows.slice(0, limit)
    return {
      items: page.map(row => adminCompletionDto(row, false)),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function getCompletion(caller, value) {
    await assertTasksAdmin(database, caller)
    const completionId = requiredId(value.completionId)
    const row = await database.one(`${completionSelect()}
      WHERE completion.app_id = ? AND completion.id = ?`, [caller.appId, completionId])
    if (!row) throw new Error('NOT_FOUND')
    return adminCompletionDto(row, true)
  }

  async function exportCompletions(caller, event = {}) {
    await assertTasksAdmin(database, caller)
    const { sql, params } = completionWhere(caller.appId, normalizeCompletionFilters(event.filters), null)
    const rows = await database.query(`${completionSelect()} WHERE ${sql}
      ORDER BY completion.completed_at DESC, completion.id DESC LIMIT 1001`, params)
    if (rows.length > 1000) throw new Error('EXPORT_TOO_LARGE')
    const workbook = buildTaskWorkbook(rows)
    if (workbook.length > 3 * 1024 * 1024) throw new Error('EXPORT_TOO_LARGE')
    return {
      fileName: `mip-task-completions-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentBase64: workbook.toString('base64'),
      rowCount: rows.length,
    }
  }

  return {
    completeTask,
    exportCompletions,
    getAdminTask,
    getAdminSession,
    getCompletion,
    getTask,
    listAdminTasks,
    listAssignableMembers,
    listCompletions,
    listTasks,
    saveTask,
    assignMembers: (caller, value) => changeAssignments(caller, value, 'ACTIVE'),
    revokeMembers: (caller, value) => changeAssignments(caller, value, 'REVOKED'),
    transitionTask,
  }
}

async function assertTasksAdmin(adapter, caller, lock = false) {
  if (lock) {
    const user = await adapter.one(
      `SELECT status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, caller.userId],
    )
    if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  }
  const row = await adapter.one(
    `SELECT role_key FROM mip_admin_role_bindings
     WHERE app_id = ? AND user_id = ? AND scope_type = 'PLATFORM'
       AND scope_id = ? AND status = 'ACTIVE'
       AND role_key IN ('PLATFORM_OWNER', 'PLATFORM_OPERATIONS')
     ORDER BY role_key ${lock ? 'FOR UPDATE' : ''}`,
    [caller.appId, caller.userId, PLATFORM_SCOPE_ID],
  )
  if (!row || !TASK_ADMIN_ROLES.has(row.role_key)) throw new Error('FORBIDDEN')
  return row.role_key
}

async function assertTaskTemplate(adapter, caller, assetId) {
  const asset = await adapter.one(
    `SELECT id, cloud_file_id, content_type, content_bytes, width_px, height_px,
            purpose, status
     FROM mip_media_assets WHERE app_id = ? AND id = ? FOR UPDATE`,
    [caller.appId, assetId],
  )
  if (!asset || asset.status !== 'READY' || asset.purpose !== 'TASK_TEMPLATE'
    || typeof asset.cloud_file_id !== 'string' || !asset.cloud_file_id.startsWith('cloud://')
    || !['image/jpeg', 'image/png'].includes(asset.content_type)
    || !Number.isSafeInteger(Number(asset.content_bytes))
    || Number(asset.content_bytes) < 1 || Number(asset.content_bytes) > 10 * 1024 * 1024
    || !Number.isSafeInteger(Number(asset.width_px)) || Number(asset.width_px) < 1
    || !Number.isSafeInteger(Number(asset.height_px)) || Number(asset.height_px) < 1) {
    throw new Error('TEMPLATE_INVALID')
  }
  return asset
}

function completionWhere(appId, filters, cursor) {
  const clauses = ['completion.app_id = ?']
  const params = [appId]
  if (filters.taskId) {
    clauses.push('completion.task_id = ?')
    params.push(filters.taskId)
  }
  if (filters.query) {
    clauses.push('(profile.nickname LIKE ? OR completion.task_name_snapshot LIKE ?)')
    params.push(`%${filters.query}%`, `%${filters.query}%`)
  }
  if (filters.resultStatus) {
    clauses.push('completion.result_status = ?')
    params.push(filters.resultStatus)
  }
  if (filters.completedFrom) {
    clauses.push('completion.completed_at >= ?')
    params.push(filters.completedFrom)
  }
  if (filters.completedUntil) {
    clauses.push('completion.completed_at < ?')
    params.push(filters.completedUntil)
  }
  if (cursor) {
    clauses.push('(completion.completed_at < ? OR (completion.completed_at = ? AND completion.id < ?))')
    params.push(cursor.at, cursor.at, cursor.id)
  }
  return { sql: clauses.join(' AND '), params }
}

function completionSelect() {
  return `SELECT completion.*,
                 COALESCE(NULLIF(profile.nickname, ''), '未设置昵称') AS nickname,
                 asset.cloud_file_id AS attachment_url,
                 asset.content_type AS attachment_content_type,
                 asset.content_bytes AS attachment_bytes
          FROM mip_task_completions completion
          LEFT JOIN mip_profiles profile
            ON profile.app_id = completion.app_id AND profile.user_id = completion.user_id
          LEFT JOIN mip_media_assets asset
            ON asset.app_id = completion.app_id AND asset.id = completion.attachment_asset_id`
}

async function completionRow(adapter, appId, userId, taskId) {
  return adapter.one(
    `SELECT completion.* FROM mip_task_completions completion
     WHERE completion.app_id = ? AND completion.user_id = ? AND completion.task_id = ?`,
    [appId, userId, taskId],
  )
}

async function writeAudit(tx, caller, roleKey, action, resourceId, metadata) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id,
       action, resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', 'PLATFORM', NULL, ?, 'TASK', ?, ?, ?)`,
    [caller.appId, caller.userId, action, resourceId, roleKey, JSON.stringify(metadata)],
  )
}

function userTaskDto(row, includeTemplateUrl = false) {
  const completed = Boolean(row.completion_id)
  const ended = !completed && row.ends_at && new Date(row.ends_at).getTime() <= Date.now()
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    rewardExperience: Number(row.reward_experience),
    attachmentRequired: Boolean(row.attachment_required),
    endsAt: iso(row.ends_at),
    hasTemplate: Boolean(row.template_asset_id),
    version: Number(row.version),
    status: completed ? 'COMPLETED' : ended ? 'ENDED' : 'AVAILABLE',
    completion: row.completion_id ? {
      id: row.completion_id,
      completedAt: iso(row.completed_at),
      rewardExperience: Number(row.awarded_experience),
    } : undefined,
    template: includeTemplateUrl && row.template_asset_id ? {
      assetId: row.template_asset_id,
      url: row.template_url || '',
      contentType: row.template_content_type || '',
      bytes: Number(row.template_bytes || 0),
    } : undefined,
  }
}

function adminTaskDto(row, includeTemplateUrl = false) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    rewardExperience: Number(row.reward_experience),
    attachmentRequired: Boolean(row.attachment_required),
    assignmentMode: row.assignment_mode || 'ALL',
    assignmentCount: Number(row.assignment_count || 0),
    endsAt: iso(row.ends_at),
    template: row.template_asset_id ? {
      assetId: row.template_asset_id,
      url: includeTemplateUrl ? row.template_url || '' : '',
      contentType: row.template_content_type || '',
      bytes: Number(row.template_bytes || 0),
    } : undefined,
    status: row.status,
    version: Number(row.version),
    completionCount: Number(row.completion_count || 0),
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at),
  }
}

function assignmentMemberDto(row, caller) {
  return {
    memberRef: createProfileRef({ appId: caller.appId, userId: row.id }, caller.profileRefSecret),
    nickname: row.nickname,
    branchName: row.branch_name,
    assignmentStatus: row.assignment_status || 'NONE',
    assignedAt: iso(row.assigned_at),
    revokedAt: iso(row.revoked_at),
  }
}

function completionDto(row, alreadyCompleted) {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name_snapshot,
    rewardExperience: Number(row.reward_experience),
    resultStatus: row.result_status,
    completedAt: iso(row.completed_at),
    alreadyCompleted,
  }
}

function adminCompletionDto(row, includeAttachmentUrl = true) {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name_snapshot,
    taskContent: row.task_content_snapshot,
    nickname: row.nickname,
    rewardExperience: Number(row.reward_experience),
    resultStatus: row.result_status,
    resultMessage: row.result_message || '',
    completedAt: iso(row.completed_at),
    attachment: row.attachment_asset_id ? {
      url: includeAttachmentUrl ? row.attachment_url || '' : '',
      contentType: row.attachment_content_type || '',
      bytes: Number(row.attachment_bytes || 0),
    } : undefined,
  }
}

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

module.exports = {
  PLATFORM_SCOPE_ID,
  TASKS_CAPABILITY,
  TASK_ADMIN_ROLES,
  adminCompletionDto,
  adminTaskDto,
  assignmentMemberDto,
  assertTaskTemplate,
  assertTasksAdmin,
  createTaskRepository,
  userTaskDto,
}
