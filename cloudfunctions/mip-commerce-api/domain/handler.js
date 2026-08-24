'use strict'

const knownErrors = new Set([
  'AUTH_REQUIRED',
  'AGREEMENT_REQUIRED',
  'FORBIDDEN',
  'IDENTITY_CONFIG_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'MEMBERSHIP_PLAN_NOT_AVAILABLE',
  'MEMBERSHIP_INVITATION_FORBIDDEN',
  'MEMBERSHIP_INVITATION_CODE_UNAVAILABLE',
  'MEMBERSHIP_INVITATION_INVALID',
  'CONTENT_REFUND_NOT_AVAILABLE',
  'EVENT_REFUND_REQUIRES_CANCELLATION',
  'KNOWLEDGE_ALREADY_UNLOCKED',
  'KNOWLEDGE_PRODUCT_NOT_AVAILABLE',
  'NOT_FOUND',
  'PHONE_REQUIRED',
  'PROFILE_REQUIRED',
  'PAYMENT_UNAVAILABLE',
  'REFUND_AMOUNT_INVALID',
  'REFUND_NOT_AVAILABLE',
  'VALIDATION_FAILED',
])

function createHandler(options) {
  return async function main(event = {}) {
    try {
      const caller = options.resolveCaller(options.getContext())
      const action = String(event.action || '')
      const method = options.service[action]
      if (typeof method !== 'function') {
        throw new Error('NOT_FOUND')
      }
      return { ok: true, data: await method(caller, event) }
    }
    catch (error) {
      const code = knownErrors.has(error?.message) ? error.message : 'SERVICE_UNAVAILABLE'
      return { ok: false, error: { code, message: messageFor(code) } }
    }
  }
}

function messageFor(code) {
  return ({
    AUTH_REQUIRED: '请先登录',
    AGREEMENT_REQUIRED: '请先接受当前用户协议和隐私政策',
    FORBIDDEN: '当前账号不可用',
    IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
    IDEMPOTENCY_CONFLICT: '请勿重复提交不同的购买内容',
    MEMBERSHIP_PLAN_NOT_AVAILABLE: '会员方案当前不可购买',
    MEMBERSHIP_INVITATION_FORBIDDEN: '仅有效会员可以发出邀请',
    MEMBERSHIP_INVITATION_CODE_UNAVAILABLE: '小程序码服务尚未配置',
    MEMBERSHIP_INVITATION_INVALID: '会员邀请无效或已失效',
    CONTENT_REFUND_NOT_AVAILABLE: '内容已访问或已超过可退款时间',
    EVENT_REFUND_REQUIRES_CANCELLATION: '活动退款请从活动报名中取消',
    KNOWLEDGE_ALREADY_UNLOCKED: '当前内容已可访问',
    KNOWLEDGE_PRODUCT_NOT_AVAILABLE: '内容商品当前不可购买',
    NOT_FOUND: '未找到相关记录',
    PHONE_REQUIRED: '请先绑定手机号',
    PROFILE_REQUIRED: '请先完成身份资料',
    PAYMENT_UNAVAILABLE: '当前环境未开启微信支付',
    REFUND_AMOUNT_INVALID: '订单当前没有可退金额',
    REFUND_NOT_AVAILABLE: '订单当前不可退款',
    VALIDATION_FAILED: '提交内容不完整',
  })[code] || '服务暂时不可用'
}

module.exports = { createHandler }
