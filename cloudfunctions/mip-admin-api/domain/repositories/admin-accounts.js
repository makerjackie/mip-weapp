'use strict'

const { randomUUID } = require('node:crypto')
const { AdminError } = require('../validation')
const { pageRows } = require('../pagination')
const { claimOptional, complete } = require('../idempotency')
const { lockMutationAuthorization, assertMutationScope, PLATFORM_SCOPE_ID } = require('../mutation-authorization')

function error(code) { return new AdminError(code, code === 'CONFLICT' ? '账号已更新，请刷新后重试' : '无法操作此账号') }
function dto(row) {
  return {
    accountId: String(row.account_id), userId: row.linked_user_id, name: row.name,
    loginAccount: row.login_account, roleKey: row.role_key, scopeId: row.managed_scope_id || null,
    branchName: row.branch_name || '', status: row.status === 'DISABLED' ? 'INACTIVE' : row.status,
    version: Number(row.version),
  }
}
function createAdminAccountRepository(database, { writeAudit }) {
  async function listAdminAccounts(appId, input) {
    const clauses = ['a.app_id = ?']; const params = [appId]
    if (input.query) {
      clauses.push('(a.name LIKE ? OR a.login_account LIKE ?)')
      const query = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`
      params.push(query, query)
    }
    if (input.status) { clauses.push('a.status = ?'); params.push(input.status === 'INACTIVE' ? 'DISABLED' : input.status) }
    if (input.cursor) { clauses.push('a.account_id < ?'); params.push(input.cursor.id) }
    const rows = await database.query(`SELECT a.account_id, a.linked_user_id, a.name, a.login_account,
      a.role_key, a.managed_scope_id, a.status, a.version, b.name AS branch_name
      FROM mip_admin_accounts a LEFT JOIN mip_city_branches b
        ON b.app_id = a.app_id AND a.managed_scope_type = 'BRANCH' AND b.id = a.managed_scope_id
      WHERE ${clauses.join(' AND ')} ORDER BY a.account_id DESC LIMIT ${input.limit + 1}`, params)
    const page = pageRows(rows, input.limit, row => ({ id: String(row.account_id) }))
    return { ...page, items: page.items.map(dto) }
  }
  async function mutateAdminAccount(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutationAuthorization(tx, input)
      assertMutationScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const operation = `admin.accounts.${input.operation}`
      const request = { ...input, audit: undefined, authorization: undefined }
      const claim = await claimOptional(tx, input, operation, request, randomUUID)
      if (claim.replay) return claim.replay
      let stored = null
      if (input.accountId) {
        stored = await tx.one('SELECT * FROM mip_admin_accounts WHERE app_id = ? AND account_id = ? FOR UPDATE', [input.appId, input.accountId])
        if (!stored) throw error('NOT_FOUND')
        if (Number(stored.version) !== input.expectedVersion) throw error('CONFLICT')
        if (stored.linked_user_id === input.actorUserId) throw error('FORBIDDEN')
        if (stored.role_key === 'PLATFORM_OWNER') throw error('FORBIDDEN')
      }
      const userId = stored?.linked_user_id || input.userId
      const user = await tx.one(`SELECT u.id, u.status FROM mip_users u
        JOIN mip_private_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
        WHERE u.app_id = ? AND u.id = ? AND p.phone_verified_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM mip_user_identities i WHERE i.app_id = u.app_id
          AND i.user_id = u.id AND i.provider = 'WECHAT_MINIPROGRAM') FOR UPDATE`, [input.appId, userId])
      if (!user || user.status !== 'ACTIVE') throw error('NOT_FOUND')
      const roleKey = input.roleKey || stored.role_key
      if (roleKey === 'PLATFORM_OWNER' && authorization.effectiveGrant.roleKey !== 'PLATFORM_OWNER') throw error('FORBIDDEN')
      const scopeType = input.scopeType || stored.managed_scope_type
      const scopeId = input.scopeType ? input.scopeId : stored.managed_scope_id
      if (scopeType !== 'PLATFORM') {
        const scope = scopeType === 'BRANCH'
          ? await tx.one('SELECT id FROM mip_city_branches WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, scopeId])
          : await tx.one('SELECT id FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, scopeId])
        if (!scope) throw error('NOT_FOUND')
      }
      const status = input.status || stored?.status || 'ACTIVE'
      let accountId = input.accountId
      let bindingId = stored?.binding_id
      if (stored && input.operation === 'update') {
        await tx.query("UPDATE mip_admin_role_bindings SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3) WHERE app_id = ? AND id = ?", [input.appId, bindingId])
      }
      if (!stored || input.operation === 'update') {
        const current = await tx.one(`SELECT id, status FROM mip_admin_role_bindings WHERE app_id = ? AND user_id = ?
          AND scope_type = ? AND scope_id = ? AND role_key = ? FOR UPDATE`, [input.appId, userId, scopeType, scopeId || PLATFORM_SCOPE_ID, roleKey])
        bindingId = current?.id || randomUUID()
        if (current) {
          await tx.query(`UPDATE mip_admin_role_bindings SET status = ?, granted_by_user_id = ?,
            granted_at = UTC_TIMESTAMP(3), revoked_at = NULL WHERE app_id = ? AND id = ?`,
          [status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', input.actorUserId, input.appId, bindingId])
        }
        else {
          await tx.query(`INSERT INTO mip_admin_role_bindings (id, app_id, user_id, scope_type, scope_id,
            role_key, status, granted_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [bindingId, input.appId, userId, scopeType, scopeId || PLATFORM_SCOPE_ID, roleKey, status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', input.actorUserId])
        }
      }
      else {
        await tx.query(`UPDATE mip_admin_role_bindings SET status = ?, revoked_at = CASE WHEN ? = 'REVOKED'
          THEN UTC_TIMESTAMP(3) ELSE NULL END WHERE app_id = ? AND id = ?`,
        [status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', input.appId, bindingId])
      }
      if (!stored) {
        try {
          const result = await tx.query(`INSERT INTO mip_admin_accounts (app_id, linked_user_id, binding_id,
            name, login_account, phone, role_key, managed_scope_type, managed_scope_id,
            status, created_by, created_by_user_id) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'ACTIVE', 0, ?)`,
          [input.appId, userId, bindingId, input.name, input.loginAccount, roleKey, scopeType, scopeId, input.actorUserId])
          accountId = String(result.insertId)
        }
        catch (cause) { if (cause.code === 'ER_DUP_ENTRY') throw error('CONFLICT'); throw cause }
      }
      else {
        const result = await tx.query(`UPDATE mip_admin_accounts SET name = ?, role_key = ?, managed_scope_type = ?,
          managed_scope_id = ?, binding_id = ?, status = ?, version = version + 1
          WHERE app_id = ? AND account_id = ? AND version = ?`,
        [input.name || stored.name, roleKey, scopeType, scopeId, bindingId, status, input.appId, accountId, input.expectedVersion])
        if (Number(result.affectedRows) !== 1) throw error('CONFLICT')
      }
      await writeAudit(tx, { ...input.audit, resourceId: userId, metadata: { ...input.audit.metadata, accountId, roleKey, status } })
      const result = { accountId, userId, status: status === 'DISABLED' ? 'INACTIVE' : status, version: stored ? input.expectedVersion + 1 : 1 }
      await complete(tx, input, operation, claim.requestHash, result)
      return result
    })
  }
  async function listAdminAccountLoginRecords(appId, accountId, limit) {
    const account = await database.one('SELECT linked_user_id FROM mip_admin_accounts WHERE app_id = ? AND account_id = ?', [appId, accountId])
    if (!account) throw error('NOT_FOUND')
    const items = await database.query(`SELECT id, action, created_at AS createdAt FROM mip_audit_logs
      WHERE app_id = ? AND actor_user_id = ? AND action IN ('admin.web_login.confirm', 'admin.web_login.confirmed')
      ORDER BY created_at DESC, id DESC LIMIT ${limit}`, [appId, account.linked_user_id])
    return { items, nextCursor: null }
  }
  return { listAdminAccounts, mutateAdminAccount, listAdminAccountLoginRecords }
}
module.exports = { createAdminAccountRepository }
