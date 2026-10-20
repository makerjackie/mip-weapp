'use strict'

const { CAPABILITIES } = require('./capabilities')
const { AdminError, expectedVersion, requiredId, stableKey, text } = require('./validation')
const CAPABILITY = CAPABILITIES.INDUSTRIES_MANAGE
const SCOPE = Object.freeze({ scopeType: 'PLATFORM', scopeId: null })

function createIndustryCatalogAdmin({ access, repository }) {
  async function owner(caller) {
    const context = await access.session(caller)
    return { context, grant: access.requirePlatformOwner(context) }
  }

  async function listIndustryCatalog(caller, rawInput = {}) {
    const { context } = await owner(caller)
    exact(rawInput, [])
    return repository.listIndustryCatalog(context.caller.appId)
  }

  async function saveIndustryTag(caller, rawInput = {}) {
    const { context, grant } = await owner(caller)
    exact(rawInput, ['tagId', 'expectedVersion', 'label', 'parentId', 'popular', 'sortOrder', 'idempotencyKey'])
    const tagId = rawInput.tagId ? requiredId(rawInput.tagId, '行业') : null
    if (!tagId && rawInput.expectedVersion !== undefined) throw new AdminError('VALIDATION_FAILED', '新建行业不需要版本')
    const parentId = rawInput.parentId ? requiredId(rawInput.parentId, '一级分类') : null
    if (typeof rawInput.popular !== 'boolean' || (!parentId && rawInput.popular)) throw new AdminError('VALIDATION_FAILED', '热门项只能设置在二级行业')
    if (!Number.isSafeInteger(rawInput.sortOrder) || rawInput.sortOrder < 0 || rawInput.sortOrder > 100000) throw new AdminError('VALIDATION_FAILED', '排序须为0至100000的整数')
    return repository.saveIndustryTag({
      appId: context.caller.appId, actorUserId: context.caller.userId,
      tagId, expectedVersion: tagId ? expectedVersion(rawInput.expectedVersion) : null,
      label: text(rawInput.label, 80, { required: true, label: '行业名称' }),
      parentId, popular: rawInput.popular, sortOrder: rawInput.sortOrder,
      idempotencyKey: rawInput.idempotencyKey ? stableKey(rawInput.idempotencyKey, '请求', 128) : null,
      authorization: access.mutationAuthorization(grant, CAPABILITY),
      audit: id => access.audit(context, grant, { ...SCOPE, action: tagId ? 'admin.industries.update' : 'admin.industries.create', resourceType: 'INDUSTRY_TAG', resourceId: id,
        metadata: { label: rawInput.label, parentId, popular: rawInput.popular, sortOrder: rawInput.sortOrder } }),
    })
  }

  async function changeIndustryTagStatus(caller, rawInput = {}) {
    const { context, grant } = await owner(caller)
    exact(rawInput, ['tagId', 'expectedVersion', 'enabled', 'idempotencyKey'])
    if (typeof rawInput.enabled !== 'boolean') throw new AdminError('VALIDATION_FAILED', '行业状态无效')
    return repository.changeIndustryTagStatus({
      appId: context.caller.appId, actorUserId: context.caller.userId,
      tagId: requiredId(rawInput.tagId, '行业'), expectedVersion: expectedVersion(rawInput.expectedVersion), enabled: rawInput.enabled,
      idempotencyKey: rawInput.idempotencyKey ? stableKey(rawInput.idempotencyKey, '请求', 128) : null,
      authorization: access.mutationAuthorization(grant, CAPABILITY),
      audit: id => access.audit(context, grant, { ...SCOPE, action: 'admin.industries.status.change', resourceType: 'INDUSTRY_TAG', resourceId: id, metadata: { enabled: rawInput.enabled } }),
    })
  }
  return { listIndustryCatalog, saveIndustryTag, changeIndustryTagStatus }
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new AdminError('VALIDATION_FAILED', '行业目录参数无效')
}

module.exports = { createIndustryCatalogAdmin }
