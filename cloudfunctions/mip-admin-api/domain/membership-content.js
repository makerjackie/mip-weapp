'use strict'
const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError, text } = require('./validation')
function documentKind(value = 'membership') {
  if (!['membership', 'user'].includes(value)) throw new AdminError('VALIDATION_FAILED', '协议类型无效')
  return value
}
const scope = { scopeType: 'PLATFORM', scopeId: null }
function createMembershipContent({ access, repository }) {
  async function getMembershipAgreement(caller, input = {}) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.GROWTH_READ, scope)
    return repository.getMembershipAgreement(context.caller.appId, documentKind(input.document))
  }
  async function saveMembershipAgreement(caller, input = {}) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_CONFIGURE, scope)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new AdminError('VALIDATION_FAILED', '协议版本无效')
    const document = documentKind(input.document)
    const draft = input.draft || {}
    if (typeof draft.isDemo !== 'boolean') throw new AdminError('VALIDATION_FAILED', '请选择演示或正式内容')
    const value = { title: text(draft.title, 100, { required: true, label: '协议标题' }),
      body: text(draft.body, 8000, { required: true, label: '协议正文' }), isDemo: draft.isDemo }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 28000) throw new AdminError('VALIDATION_FAILED', '协议正文过长，请精简后重试')
    return repository.saveMembershipAgreement({ appId: context.caller.appId, actorUserId: context.caller.userId,
      document, expectedVersion: input.expectedVersion, draft: value, idempotencyKey: input.idempotencyKey,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: access.audit(context, grant, { ...scope, action: 'admin.membership.agreement.save', resourceType: 'APP_SETTING', resourceId: document === 'user' ? 'USER_AGREEMENT' : 'MEMBERSHIP_AGREEMENT', metadata: { document, isDemo: value.isDemo } }) })
  }
  return { getMembershipAgreement, saveMembershipAgreement }
}
module.exports = { createMembershipContent }
