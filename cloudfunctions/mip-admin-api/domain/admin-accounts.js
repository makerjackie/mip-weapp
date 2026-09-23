'use strict'

const { CAPABILITIES, authorize, roleCapabilities } = require('./capabilities')
const { AdminError, expectedVersion, requiredId, text, limit } = require('./validation')
const { decodeCursor } = require('./pagination')

function accountId(value) {
  if (!/^[1-9][0-9]{0,19}$/.test(String(value || ''))) throw new AdminError('VALIDATION_FAILED', '后台账号无效')
  return String(value)
}
function accountDraft(input) {
  const roleKey = input.roleKey
  if (!Object.hasOwn(roleCapabilities, roleKey)) throw new AdminError('VALIDATION_FAILED', '角色无效')
  const scopeType = roleKey.startsWith('PLATFORM_') ? 'PLATFORM' : roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'EVENT'
  return {
    name: text(input.name, 64, { required: true, label: '姓名' }),
    roleKey, scopeType,
    scopeId: scopeType === 'PLATFORM' ? null : requiredId(input.scopeId, '管理范围'),
  }
}
function createAdminAccounts({ access, repository }) {
  async function contextOf(caller) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.ROLES_CHANGE, { scopeType: 'PLATFORM', scopeId: null })
    return { context, grant }
  }
  async function listAdminAccounts(caller, input = {}) {
    const { context } = await contextOf(caller)
    return repository.listAdminAccounts(context.caller.appId, {
      query: text(input.query, 80), status: input.status || '', limit: limit(input.limit),
      cursor: decodeCursor(input.cursor, ['id']),
    })
  }
  async function mutate(caller, input, operation, draft = {}) {
    const { context, grant } = await contextOf(caller)
    if (draft.roleKey === 'PLATFORM_OWNER' && grant.roleKey !== 'PLATFORM_OWNER') throw new AdminError('FORBIDDEN', '只有超级管理员可以授予此角色')
    return repository.mutateAdminAccount({
      appId: context.caller.appId, actorUserId: context.caller.userId,
      operation, accountId: operation === 'create' ? null : accountId(input.accountId),
      expectedVersion: operation === 'create' ? null : expectedVersion(input.expectedVersion),
      ...draft, idempotencyKey: input.idempotencyKey,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      audit: access.audit(context, grant, { scopeType: 'PLATFORM', action: `admin.accounts.${operation}`, resourceType: 'ADMIN_ACCOUNT', metadata: { reason: text(input.reason, 300) || null } }),
    })
  }
  async function createAdminAccount(caller, input = {}) {
    const loginAccount = text(input.loginAccount, 64, { required: true, label: '账号标识' })
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(loginAccount)) throw new AdminError('VALIDATION_FAILED', '账号标识格式无效')
    return mutate(caller, input, 'create', { ...accountDraft(input), loginAccount, userId: requiredId(input.userId, '已注册用户') })
  }
  async function updateAdminAccount(caller, input = {}) {
    return mutate(caller, input, 'update', accountDraft(input))
  }
  async function changeAdminAccountStatus(caller, input = {}) {
    if (!['ACTIVE', 'INACTIVE', 'DISABLED'].includes(input.status)) throw new AdminError('VALIDATION_FAILED', '账号状态无效')
    if (!text(input.reason, 300)) throw new AdminError('VALIDATION_FAILED', '请填写原因')
    return mutate(caller, input, 'status', { status: input.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED' })
  }
  async function listLoginRecords(caller, input = {}) {
    const { context } = await contextOf(caller)
    return repository.listAdminAccountLoginRecords(context.caller.appId, accountId(input.accountId), limit(input.limit))
  }
  // ADR 0006: passwords are not an identity source for this product.
  async function passwordLogin() { throw new AdminError('AUTH_METHOD_UNAVAILABLE', '请使用小程序确认网页登录') }
  async function resetAdminCredential() { throw new AdminError('AUTH_METHOD_UNAVAILABLE', '登录码每次单独生成，无需重置密码') }
  return { listAdminAccounts, createAdminAccount, updateAdminAccount, changeAdminAccountStatus, listLoginRecords, passwordLogin, resetAdminCredential }
}
module.exports = { createAdminAccounts, accountDraft }
