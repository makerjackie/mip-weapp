'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const {
  createMessageTemplateRepository,
  templateDto,
} = require('../domain/message-templates')

const appId = 'wx-template-test'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const templateId = '20000000-0000-4000-8000-000000000002'
const branchId = '30000000-0000-4000-8000-000000000003'

function row(overrides = {}) {
  return {
    id: templateId,
    scope_type: 'PLATFORM',
    branch_id: null,
    branch_name: '',
    status: 'DRAFT',
    current_revision_number: 2,
    name: '活动提醒',
    title: '活动即将开始',
    body: '请在活动页查看最新安排。',
    content_safety_status: 'PASSED',
    revision_created_at: new Date('2030-08-24T08:00:00.000Z'),
    version: 4,
    created_at: new Date('2030-08-20T08:00:00.000Z'),
    updated_at: new Date('2030-08-24T08:00:00.000Z'),
    created_by_user_id: 'private-creator',
    updated_by_user_id: 'private-updater',
    ...overrides,
  }
}

function authorization(scopeType = 'PLATFORM', scopeId = null) {
  return {
    capability: CAPABILITIES.MESSAGES_MANAGE,
    effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType, scopeId },
  }
}

function draft(overrides = {}) {
  return {
    scopeType: 'PLATFORM',
    branchId: null,
    name: '活动提醒',
    title: '活动即将开始',
    body: '请在活动页查看最新安排。',
    ...overrides,
  }
}

function audit(resourceId, action, metadata) {
  return {
    appId,
    actorUserId,
    scopeType: 'PLATFORM',
    scopeId: null,
    resourceId,
    action,
    effectiveRole: 'PLATFORM_OWNER',
    metadata,
  }
}

function repository(tx, options = {}) {
  const authCalls = []
  const scopeCalls = []
  const database = {
    transaction: work => work(tx),
    one: (...args) => tx.one(...args),
    query: (...args) => tx.query(...args),
  }
  const repo = createMessageTemplateRepository(database, {
    createId: () => templateId,
    async lockMutationAuthorization(lockedTx, input) {
      authCalls.push({ tx: lockedTx, input })
      return input.authorization
    },
    assertMutationScope(lockedAuthorization, scope) {
      scopeCalls.push({ authorization: lockedAuthorization, scope })
      if (options.rejectScope) throw codeError('FORBIDDEN')
    },
  })
  return { authCalls, repo, scopeCalls }
}

describe('admin message templates', () => {
  it('locks only the template alias when a transaction-local read requests a lock', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return row()
      },
      async query() { return [] },
    }
    const { repo } = repository(tx)

    await repo.getTemplate(appId, templateId, tx)
    await repo.getTemplate(appId, templateId, tx, true)

    assert.doesNotMatch(calls[0].sql, /FOR UPDATE/)
    assert.match(calls[1].sql, /FROM mip_message_templates template/)
    assert.match(calls[1].sql, /FOR UPDATE OF template$/)
    assert.deepEqual(calls.map(call => call.params), [
      [appId, templateId],
      [appId, templateId],
    ])
  })

  it('returns only the current immutable revision and never exposes internal user ids', () => {
    const item = templateDto(row())
    assert.deepEqual(Object.keys(item).sort(), [
      'body',
      'branchId',
      'branchName',
      'contentSafetyStatus',
      'createdAt',
      'currentRevisionNumber',
      'id',
      'name',
      'revisionCreatedAt',
      'scopeType',
      'status',
      'title',
      'updatedAt',
      'version',
    ])
    assert.equal(JSON.stringify(item).includes('private-creator'), false)
    assert.equal(JSON.stringify(item).includes('private-updater'), false)
  })

  it('lists only app-scoped visible templates with bounded server filters', async () => {
    const calls = []
    const tx = {
      async one() { return null },
      async query(sql, params) {
        calls.push({ sql, params })
        return [row({
          scope_type: 'BRANCH',
          branch_id: branchId,
          branch_name: '深圳分会',
        })]
      },
    }
    const { repo } = repository(tx)
    const items = await repo.listTemplates(
      appId,
      { platform: false, branchIds: [branchId] },
      { status: 'ACTIVE', query: '活动' },
      50,
    )
    assert.equal(items.length, 1)
    assert.match(calls[0].sql, /template\.app_id = \?/)
    assert.match(calls[0].sql, /template\.branch_id IN \(\?\)/)
    assert.match(calls[0].sql, /revision\.revision_number = template\.current_revision_number/)
    assert.deepEqual(calls[0].params, [appId, branchId, 'ACTIVE', '%活动%', '%活动%', '%活动%', 50])
  })

  it('creates the parent, revision, and audit atomically after transaction-local authorization', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ type: 'one', sql, params })
        return row({ current_revision_number: 1, version: 1 })
      },
      async query(sql, params) {
        calls.push({ type: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const { authCalls, repo, scopeCalls } = repository(tx)
    const result = await repo.saveTemplate({
      appId,
      actorUserId,
      templateId: null,
      expectedVersion: null,
      draft: draft(),
      contentSafetyStatus: 'PASSED',
      authorization: authorization(),
      authorizedExistingScope: null,
      audit,
    })

    assert.equal(result.currentRevisionNumber, 1)
    assert.equal(authCalls.length, 1)
    assert.equal(authCalls[0].tx, tx)
    assert.deepEqual(scopeCalls.map(call => call.scope), [{ scopeType: 'PLATFORM', scopeId: null }])
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO mip_message_templates')).length, 1)
    const revision = calls.find(call => call.sql.includes('INSERT INTO mip_message_template_revisions'))
    assert.equal(revision.params[2], 1)
    assert.equal(revision.params.includes('PASSED'), true)
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })

  it('appends a new revision and returns an active template to draft without rewriting history', async () => {
    const calls = []
    let reads = 0
    const tx = {
      async one(sql, params) {
        calls.push({ type: 'one', sql, params })
        reads += 1
        return reads === 1
          ? row({ status: 'ACTIVE', current_revision_number: 2, version: 4 })
          : row({ status: 'DRAFT', current_revision_number: 3, version: 5 })
      },
      async query(sql, params) {
        calls.push({ type: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const { authCalls, repo, scopeCalls } = repository(tx)
    const result = await repo.saveTemplate({
      appId,
      actorUserId,
      templateId,
      expectedVersion: 4,
      draft: draft({ title: '活动安排已更新' }),
      contentSafetyStatus: 'PASSED',
      authorization: authorization(),
      authorizedExistingScope: { scopeType: 'PLATFORM', scopeId: null },
      audit,
    })

    assert.equal(result.status, 'DRAFT')
    assert.equal(result.currentRevisionNumber, 3)
    assert.equal(authCalls.length, 1)
    assert.equal(scopeCalls.length, 2)
    const revision = calls.find(call => call.sql.includes('INSERT INTO mip_message_template_revisions'))
    assert.equal(revision.params[2], 3)
    const parentUpdate = calls.find(call => /UPDATE mip_message_templates\s/.test(call.sql))
    assert.match(parentUpdate.sql, /status = 'DRAFT'/)
    assert.match(parentUpdate.sql, /version = version \+ 1/)
    assert.equal(calls.some(call => /UPDATE\s+mip_message_template_revisions/i.test(call.sql)), false)
    assert.equal(calls.some(call => /DELETE\s+FROM\s+mip_message_template_revisions/i.test(call.sql)), false)
  })

  it('activates only the transaction-locked current revision after safety passed', async () => {
    const rejectedCalls = []
    const rejectedTx = {
      async one(sql, params) {
        rejectedCalls.push({ type: 'one', sql, params })
        return row({ content_safety_status: 'REJECTED' })
      },
      async query(sql, params) {
        rejectedCalls.push({ type: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const rejected = repository(rejectedTx)
    await assert.rejects(() => rejected.repo.activateTemplate({
      appId,
      actorUserId,
      templateId,
      expectedVersion: 4,
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit,
    }), error => error?.code === 'CONTENT_SAFETY_REQUIRED')
    assert.equal(rejected.authCalls.length, 1)
    assert.equal(rejectedCalls.some(call => /UPDATE mip_message_templates/.test(call.sql)), false)

    const passedCalls = []
    let reads = 0
    const passedTx = {
      async one(sql, params) {
        passedCalls.push({ type: 'one', sql, params })
        reads += 1
        return reads === 1 ? row() : row({ status: 'ACTIVE', version: 5 })
      },
      async query(sql, params) {
        passedCalls.push({ type: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const passed = repository(passedTx)
    const result = await passed.repo.activateTemplate({
      appId,
      actorUserId,
      templateId,
      expectedVersion: 4,
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit,
    })
    assert.equal(result.status, 'ACTIVE')
    const update = passedCalls.find(call => /UPDATE mip_message_templates/.test(call.sql))
    assert.deepEqual(update.params, ['ACTIVE', actorUserId, appId, templateId, 4, 'DRAFT'])
  })

  it('fails closed on stale scope/version and soft archives without deleting revisions', async () => {
    const conflictTx = {
      async one() { return row({ version: 5 }) },
      async query() { throw new Error('unexpected write') },
    }
    const conflict = repository(conflictTx)
    await assert.rejects(() => conflict.repo.archiveTemplate({
      appId,
      actorUserId,
      templateId,
      expectedVersion: 4,
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit,
    }), error => error?.code === 'CONFLICT')

    const calls = []
    let reads = 0
    const tx = {
      async one(sql, params) {
        calls.push({ type: 'one', sql, params })
        reads += 1
        return reads === 1 ? row({ status: 'ACTIVE' }) : row({ status: 'ARCHIVED', version: 5 })
      },
      async query(sql, params) {
        calls.push({ type: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const { repo } = repository(tx)
    const archived = await repo.archiveTemplate({
      appId,
      actorUserId,
      templateId,
      expectedVersion: 4,
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit,
    })
    assert.equal(archived.status, 'ARCHIVED')
    assert.equal(calls.some(call => /DELETE\s+FROM/i.test(call.sql)), false)
    assert.equal(calls.some(call => /UPDATE\s+mip_message_template_revisions/i.test(call.sql)), false)
  })
})

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}
