'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError, requiredId, text, limit } = require('./validation')
const platform = { scopeType: 'PLATFORM', scopeId: null }
const styles = ['PINK', 'BLUE', 'WHITE', 'YELLOW']
const allowedFields = ['name', 'avatar', 'company', 'position', 'contact']
function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new AdminError('VALIDATION_FAILED', '版本无效')
  return value
}
function createCards({ access, repository, resolveCardAvatars }) {
  async function context(caller, capability) {
    const session = await access.session(caller)
    const grant = authorize(session.bindings, capability, platform)
    return { session, grant }
  }
  async function listCards(caller, input = {}) {
    const { session } = await context(caller, CAPABILITIES.USERS_READ)
    const page = await repository.listProfileCards(session.caller.appId, {
      cardType: input.cardType === 'TEMPLATE' ? 'TEMPLATE' : 'PROFILE',
      query: text(input.query, 80), cursor: input.cursor, limit: limit(input.limit, 100),
    })
    return resolveCardAvatars && input.cardType !== 'TEMPLATE' ? resolveCardAvatars(page) : page
  }
  async function listCardHistory(caller, input = {}) {
    const cardId = requiredId(input.cardId)
    const session = await access.session(caller)
    const { scope, grant } = await access.userAuthorization(session, cardId, CAPABILITIES.USERS_READ)
    const result = await repository.listProfileCardHistory(session.caller.appId, cardId, input.cursor, limit(input.limit, 100))
    await repository.recordAudit(access.audit(session, grant, { ...scope, action: 'admin.cards.history.view', resourceType: 'USER', resourceId: cardId }))
    return result
  }
  async function mutate(caller, input, kind, changes) {
    const session = await access.session(caller)
    const { scope, grant } = kind === 'PROFILE_EDIT'
      ? await access.userAuthorization(session, requiredId(input.cardId), CAPABILITIES.USERS_EDIT)
      : { scope: platform, grant: authorize(session.bindings, CAPABILITIES.USERS_EDIT, platform) }
    return repository.changeProfileCard({
      appId: session.caller.appId, actorUserId: session.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USERS_EDIT),
      cardId: requiredId(input.cardId), expectedVersion: version(input.expectedVersion),
      kind, changes, idempotencyKey: input.idempotencyKey, authorizedScope: scope,
      audit: access.audit(session, grant, { ...scope, action: `admin.cards.${kind.toLowerCase()}`, resourceType: kind === 'TEMPLATE' ? 'CARD_TEMPLATE' : 'USER', resourceId: input.cardId }),
    })
  }
  async function saveCard(caller, input = {}) {
    if (input.cardType === 'PROFILE') {
      const fields = input.fields
      const allowed = ['realName', 'nickname', 'headline', 'introduction', 'companies', 'organizations', 'identityStatus']
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !allowed.includes(key))) throw new AdminError('VALIDATION_FAILED', '名片字段无效')
      const affiliations = (value) => {
        if (!Array.isArray(value) || value.length > 5) throw new AdminError('VALIDATION_FAILED', '公司或组织最多填写五项')
        return value.map(item => {
          if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['name', 'role'].includes(key))) throw new AdminError('VALIDATION_FAILED', '公司或组织格式无效')
          return { name: text(item.name, 120, { required: true }), role: text(item.role, 120) }
        })
      }
      return mutate(caller, input, 'PROFILE_EDIT', {
        realName: text(fields.realName, 60), nickname: text(fields.nickname, 60, { required: true }),
        headline: text(fields.headline, 120), introduction: text(fields.introduction, 600),
        companies: affiliations(fields.companies), organizations: affiliations(fields.organizations),
        identityStatus: text(fields.identityStatus, 32),
      })
    }
    if (input.cardType !== 'TEMPLATE' || !styles.includes(input.cardId)) throw new AdminError('VALIDATION_FAILED', '请选择现有名片模板')
    const fields = input.fields || {}
    if (!Array.isArray(fields.requiredFields) || fields.requiredFields.some(field => !allowedFields.includes(field))) throw new AdminError('VALIDATION_FAILED', '必填项无效')
    if (!Number.isSafeInteger(fields.sortOrder) || fields.sortOrder < 0 || fields.sortOrder > 9999) throw new AdminError('VALIDATION_FAILED', '排序无效')
    return mutate(caller, input, 'TEMPLATE', { name: text(fields.name, 60, { required: true }), requiredFields: [...new Set(fields.requiredFields)], sortOrder: fields.sortOrder })
  }
  async function changeCardStatus(caller, input = {}) {
    if (input.cardType === 'PROFILE') {
      if (input.status !== 'ACTIVE') throw new AdminError('VALIDATION_FAILED', '下架请填写原因')
      return mutate(caller, input, 'PROFILE', { status: 'ACTIVE', reason: '' })
    }
    if (!styles.includes(input.cardId) || !['ACTIVE', 'INACTIVE'].includes(input.status)) throw new AdminError('VALIDATION_FAILED', '模板状态无效')
    return mutate(caller, input, 'TEMPLATE', { status: input.status })
  }
  async function takedownCard(caller, input = {}) {
    return mutate(caller, input, 'PROFILE', { status: 'TAKEN_DOWN', reason: text(input.reason, 500, { required: true, label: '下架原因' }) })
  }
  return { listCards, saveCard, changeCardStatus, takedownCard, listCardHistory }
}
module.exports = { createCards }
