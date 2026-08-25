'use strict'

const { randomUUID } = require('node:crypto')

function createMessageTemplateRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  if (typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Message template mutation authorization is invalid')
  }

  async function listTemplates(appId, visibility, filters, pageLimit) {
    const visible = visibleWhere(visibility)
    const clauses = ['template.app_id = ?', visible.sql]
    const params = [appId, ...visible.params]
    if (filters.status) {
      clauses.push('template.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query)}%`
      clauses.push('(revision.name LIKE ? OR revision.title LIKE ? OR revision.body LIKE ?)')
      params.push(pattern, pattern, pattern)
    }
    const rows = await database.query(
      `${templateSelect()}
       WHERE ${clauses.join(' AND ')}
       ORDER BY template.updated_at DESC, template.id DESC LIMIT ?`,
      [...params, pageLimit],
    )
    return rows.map(templateDto)
  }

  async function getTemplate(appId, templateId, adapter = database, lock = false) {
    const sql = lock
      ? `SELECT template.id, template.scope_type, template.branch_id,
       branch.name AS branch_name, template.status, template.current_revision_number,
       revision.name, revision.title, revision.body, revision.content_safety_status,
       revision.created_at AS revision_created_at,
       template.version, template.created_at, template.updated_at
       FROM mip_message_templates template
       INNER JOIN mip_message_template_revisions revision
         ON revision.app_id = template.app_id
        AND revision.template_id = template.id
        AND revision.revision_number = template.current_revision_number
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = template.app_id AND branch.id = template.branch_id
       WHERE template.app_id = ? AND template.id = ? FOR UPDATE OF template`
      : `${templateSelect()}
       WHERE template.app_id = ? AND template.id = ?`
    const row = await adapter.one(
      sql,
      [appId, templateId],
    )
    return row ? templateDto(row) : null
  }

  async function getTemplateScope(appId, templateId) {
    const row = await database.one(
      `SELECT scope_type, branch_id, status
       FROM mip_message_templates WHERE app_id = ? AND id = ?`,
      [appId, templateId],
    )
    return row
      ? {
          scopeType: row.scope_type,
          scopeId: row.scope_type === 'BRANCH' ? row.branch_id : null,
          status: row.status,
        }
      : null
  }

  async function saveTemplate(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const requestedScope = templateScope(input.draft)
      assertScope(authorization, requestedScope)
      await assertActiveBranch(tx, input.appId, input.draft)

      if (!input.templateId) {
        const templateId = createId()
        await tx.query(
          `INSERT INTO mip_message_templates (
            id, app_id, scope_type, branch_id, status, current_revision_number,
            created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, 'DRAFT', 1, ?, ?)`,
          [templateId, input.appId, input.draft.scopeType, input.draft.branchId,
            input.actorUserId, input.actorUserId],
        )
        await insertRevision(tx, input, templateId, 1)
        await writeAudit(tx, input.audit(templateId, 'admin.message_templates.create', {
          revisionNumber: 1,
          contentSafetyStatus: input.contentSafetyStatus,
        }))
        return getTemplate(input.appId, templateId, tx)
      }

      const current = await getTemplate(input.appId, input.templateId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const currentScope = templateScope(current)
      assertScope(authorization, currentScope)
      if (!sameScope(currentScope, input.authorizedExistingScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status === 'ARCHIVED') throw codeError('INVALID_STATE')

      const nextRevisionNumber = current.currentRevisionNumber + 1
      await insertRevision(tx, input, input.templateId, nextRevisionNumber)
      const update = await tx.query(
        `UPDATE mip_message_templates
         SET scope_type = ?, branch_id = ?, status = 'DRAFT',
           current_revision_number = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'ACTIVE')`,
        [input.draft.scopeType, input.draft.branchId, nextRevisionNumber,
          input.actorUserId, input.appId, input.templateId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.templateId, 'admin.message_templates.update', {
        expectedVersion: input.expectedVersion,
        previousStatus: current.status,
        revisionNumber: nextRevisionNumber,
        contentSafetyStatus: input.contentSafetyStatus,
      }))
      return getTemplate(input.appId, input.templateId, tx)
    })
  }

  async function activateTemplate(input) {
    return transitionTemplate(input, {
      allowedStatuses: ['DRAFT'],
      nextStatus: 'ACTIVE',
      action: 'admin.message_templates.activate',
      assertCurrent(current) {
        if (current.contentSafetyStatus !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')
      },
    })
  }

  async function archiveTemplate(input) {
    return transitionTemplate(input, {
      allowedStatuses: ['DRAFT', 'ACTIVE'],
      nextStatus: 'ARCHIVED',
      action: 'admin.message_templates.archive',
    })
  }

  async function transitionTemplate(input, transition) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await getTemplate(input.appId, input.templateId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const scope = templateScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (!transition.allowedStatuses.includes(current.status)) throw codeError('INVALID_STATE')
      transition.assertCurrent?.(current)

      const update = await tx.query(
        `UPDATE mip_message_templates
         SET status = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND status IN (${placeholders(transition.allowedStatuses)})`,
        [transition.nextStatus, input.actorUserId, input.appId, input.templateId,
          input.expectedVersion, ...transition.allowedStatuses],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.templateId, transition.action, {
        expectedVersion: input.expectedVersion,
        revisionNumber: current.currentRevisionNumber,
        previousStatus: current.status,
      }))
      return getTemplate(input.appId, input.templateId, tx)
    })
  }

  return {
    activateTemplate,
    archiveTemplate,
    getTemplate,
    getTemplateScope,
    listTemplates,
    saveTemplate,
  }
}

async function assertActiveBranch(tx, appId, draft) {
  if (draft.scopeType !== 'BRANCH') return
  const branch = await tx.one(
    `SELECT id FROM mip_city_branches
     WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
    [appId, draft.branchId],
  )
  if (!branch) throw codeError('VALIDATION_FAILED')
}

async function insertRevision(tx, input, templateId, revisionNumber) {
  await tx.query(
    `INSERT INTO mip_message_template_revisions (
      app_id, template_id, revision_number, name, title, body,
      content_safety_status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.appId, templateId, revisionNumber, input.draft.name, input.draft.title,
      input.draft.body, input.contentSafetyStatus, input.actorUserId],
  )
}

function templateSelect() {
  return `SELECT template.id, template.scope_type, template.branch_id,
    branch.name AS branch_name, template.status, template.current_revision_number,
    revision.name, revision.title, revision.body, revision.content_safety_status,
    revision.created_at AS revision_created_at,
    template.version, template.created_at, template.updated_at
    FROM mip_message_templates template
    INNER JOIN mip_message_template_revisions revision
      ON revision.app_id = template.app_id
     AND revision.template_id = template.id
     AND revision.revision_number = template.current_revision_number
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = template.app_id AND branch.id = template.branch_id`
}

function templateDto(row) {
  return {
    id: String(row.id),
    scopeType: row.scope_type,
    branchId: row.branch_id || null,
    branchName: row.branch_name || '',
    status: row.status,
    currentRevisionNumber: Number(row.current_revision_number),
    name: row.name,
    title: row.title,
    body: row.body,
    contentSafetyStatus: row.content_safety_status,
    revisionCreatedAt: iso(row.revision_created_at),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function templateScope(value) {
  return {
    scopeType: value.scopeType,
    scopeId: value.scopeType === 'BRANCH' ? value.branchId : null,
  }
}

function visibleWhere(visibility) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  if (!visibility.branchIds.length) return { sql: '0 = 1', params: [] }
  return {
    sql: `(template.scope_type = 'BRANCH'
      AND template.branch_id IN (${placeholders(visibility.branchIds)}))`,
    params: [...visibility.branchIds],
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, 'MESSAGE_TEMPLATE', ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceId, audit.effectiveRole || null,
      JSON.stringify(audit.metadata || {})],
  )
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  createMessageTemplateRepository,
  templateDto,
}
