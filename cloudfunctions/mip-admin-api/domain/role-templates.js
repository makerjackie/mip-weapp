'use strict'

const { roleCapabilities, CAPABILITIES, firstGrant } = require('./capabilities')
const { AdminError, expectedVersion, requiredId, text, stableKey } = require('./validation')
const { claimOptional, complete } = require('./idempotency')
const { randomUUID } = require('node:crypto')
const { capabilityArray } = require('./role-template-policy')

const ROLE_TEMPLATE_KEYS = Object.keys(roleCapabilities).filter(key => key !== 'PLATFORM_OWNER')
const templateBindingEnabled = () => process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED === 'true'
function templateId(value) {
  const id = requiredId(value, '岗位模板')
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new AdminError('VALIDATION_FAILED', '岗位模板无效')
  return id
}
function templateDto(row) {
  const capabilities = capabilityArray(row.capabilities)
  if (!capabilities || !ROLE_TEMPLATE_KEYS.includes(row.base_role_key)) throw new AdminError('SERVICE_UNAVAILABLE', '岗位模板配置无效')
  return { id: String(row.role_id), name: row.role_name, description: row.description || '',
    baseRoleKey: row.base_role_key, capabilities, status: row.status, version: Number(row.version),
    bindingCount: Number(row.binding_count || 0) }
}
async function lockTemplateForBinding(tx, input, authorization, id, roleKey) {
  if (!id) return null
  if (!templateBindingEnabled()) throw new AdminError('ROLE_TEMPLATES_NOT_ENABLED', '岗位模板尚未开放绑定')
  const row = await tx.one('SELECT * FROM mip_admin_roles WHERE app_id = ? AND role_id = ? FOR UPDATE', [input.appId, templateId(id)])
  const caps = row ? capabilityArray(row.capabilities) : null
  if (!row || row.status !== 'ACTIVE' || row.base_role_key !== roleKey || roleKey === 'PLATFORM_OWNER'
    || !caps || caps.some(cap => !(roleCapabilities[roleKey] || []).includes(cap)
      || !authorization.effectiveGrant.capabilities.includes(cap))) throw new AdminError('FORBIDDEN', '此岗位模板不可授予')
  return String(row.role_id)
}
function createRoleTemplateRepository(database, { lockMutation, writeAudit }) {
  async function listRoleTemplates(appId) {
    const rows = await database.query(`SELECT role.*, (SELECT COUNT(*) FROM mip_admin_role_bindings binding
      WHERE binding.app_id = role.app_id AND binding.role_template_id = role.role_id AND binding.status = 'ACTIVE') AS binding_count
      FROM mip_admin_roles role WHERE role.app_id = ? AND role.is_system = 0 ORDER BY role.status, role.role_name, role.role_id`, [appId])
    return rows.map(templateDto)
  }
  async function mutateRoleTemplate(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input)
      if (authorization.effectiveGrant.roleKey !== 'PLATFORM_OWNER' || authorization.effectiveGrant.scopeType !== 'PLATFORM') throw new AdminError('FORBIDDEN', '仅总部超管可维护岗位模板')
      const row = input.templateId ? await tx.one('SELECT * FROM mip_admin_roles WHERE app_id = ? AND role_id = ? FOR UPDATE', [input.appId, input.templateId]) : null
      if (input.templateId && (!row || row.is_system || !row.base_role_key)) throw new AdminError('NOT_FOUND', '岗位模板不存在')
      const request = { templateId: input.templateId, expectedVersion: input.expectedVersion, name: input.name, description: input.description,
        baseRoleKey: input.baseRoleKey, capabilities: input.capabilities, status: input.status, operation: input.operation, reason: input.reason }
      const claim = await claimOptional(tx, input, 'admin.roleTemplates.save', request, randomUUID)
      if (claim.replay) return claim.replay
      if (row && Number(row.version) !== input.expectedVersion) throw new AdminError('CONFLICT', '岗位模板已变化，请保留输入并核对最新版本')
      if (row && input.baseRoleKey && row.base_role_key !== input.baseRoleKey) throw new AdminError('VALIDATION_FAILED', '基础权限类型创建后不可修改，请复制新岗位')
      const next = row ? { ...templateDto(row), ...input } : input
      let id
      try {
        if (row && input.operation !== 'copy') {
          id = String(row.role_id)
          const result = await tx.query(`UPDATE mip_admin_roles SET role_name = ?, description = ?, capabilities = ?, status = ?, version = version + 1
            WHERE app_id = ? AND role_id = ? AND version = ?`, [next.name, next.description, JSON.stringify(next.capabilities), next.status || row.status, input.appId, id, input.expectedVersion])
          if (Number(result.affectedRows) !== 1) throw new AdminError('CONFLICT', '岗位模板已变化')
        } else {
          const inserted = await tx.query(`INSERT INTO mip_admin_roles (app_id, role_key, role_name, description, base_role_key, capabilities, status, is_system)
            VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`, [input.appId, `template-${randomUUID()}`, input.name, input.description, input.baseRoleKey, JSON.stringify(input.capabilities)])
          id = String(inserted.insertId)
        }
      } catch (reason) { if (reason.code === 'ER_DUP_ENTRY') throw new AdminError('CONFLICT', '岗位名称已存在'); throw reason }
      await writeAudit(tx, { ...input.audit, resourceId: id, metadata: { ...input.audit.metadata, before: row ? templateDto(row) : null,
        after: { name: next.name, baseRoleKey: next.baseRoleKey, capabilities: next.capabilities, status: next.status || 'ACTIVE' } } })
      const result = { id, version: row && input.operation !== 'copy' ? input.expectedVersion + 1 : 1 }
      await complete(tx, input, 'admin.roleTemplates.save', claim.requestHash, result)
      return result
    })
  }
  return { listRoleTemplates, mutateRoleTemplate }
}
function createRoleTemplates({ access, repository }) {
  async function listRoleTemplates(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.ROLES_CHANGE)
    return { items: await repository.listRoleTemplates(context.caller.appId),
      baseRoles: ROLE_TEMPLATE_KEYS.map(key => ({ key, allowedCapabilities: roleCapabilities[key] })), bindingWritesEnabled: templateBindingEnabled() }
  }
  async function mutate(caller, input, operation) {
    const context = await access.session(caller), grant = access.requirePlatformOwner(context)
    const baseRoleKey = input.baseRoleKey
    const capabilities = capabilityArray(input.capabilities)
    if (operation !== 'status' && (!ROLE_TEMPLATE_KEYS.includes(baseRoleKey) || !capabilities
      || capabilities.some(cap => !roleCapabilities[baseRoleKey].includes(cap)))) throw new AdminError('VALIDATION_FAILED', '岗位权限超出基础类型的上限')
    if (operation === 'status' && !['ACTIVE', 'INACTIVE'].includes(input.status)) throw new AdminError('VALIDATION_FAILED', '岗位状态无效')
    return repository.mutateRoleTemplate({ appId: context.caller.appId, actorUserId: context.caller.userId, operation,
      ...(operation === 'create' ? {} : { templateId: templateId(input.templateId), expectedVersion: expectedVersion(input.expectedVersion) }),
      ...(operation === 'status' ? { status: input.status } : { name: text(input.name, 128, { required: true, label: '岗位名称' }),
        description: text(input.description, 500), baseRoleKey, capabilities }),
      idempotencyKey: stableKey(input.idempotencyKey, '请求', 128),
      reason: text(input.reason, 300, { required: true, label: '变更原因' }),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      audit: access.audit(context, grant, { scopeType: 'PLATFORM', action: `admin.roleTemplates.${operation}`, resourceType: 'ADMIN_ROLE_TEMPLATE', metadata: { reason: text(input.reason, 300, { required: true, label: '变更原因' }) } }),
    })
  }
  return { listRoleTemplates, createRole: (caller, input) => mutate(caller, input, 'create'),
    updateRoleTemplate: (caller, input) => mutate(caller, input, 'update'),
    copyRoleTemplate: (caller, input) => mutate(caller, input, 'copy'),
    changeRoleTemplateStatus: (caller, input) => mutate(caller, input, 'status') }
}
module.exports = { createRoleTemplateRepository, createRoleTemplates, lockTemplateForBinding, templateBindingEnabled, templateId, templateDto }
