'use strict'

const messages = {
  AUTH_REQUIRED: '登录后可查看成长记录',
  CONFLICT: '成长记录正在处理，请稍后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  GROWTH_LEVEL_BASE_REQUIRED: '成长等级尚未配置',
  GROWTH_RULE_CONFLICT: '成长规则配置冲突',
  GAME_COIN_RULE_NOT_AVAILABLE: '当前游戏币规则不可用',
  INSUFFICIENT_GAME_COIN_BALANCE: '游戏币余额不足',
  MEMBERSHIP_REQUIRED: '当前会员资格不可用',
  BADGE_EQUIPMENT_INVALID: '最多可以佩戴 3 个已获得且已启用的勋章',
  IDEMPOTENCY_CONFLICT: '业务事件与已有记录不一致',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  INTERNAL_AUTH_NOT_CONFIGURED: '成长写入服务尚未配置',
  VALIDATION_FAILED: '提交内容格式不正确',
}

function createHandler(options) {
  return async function main(event = {}) {
    if (event.action === 'health') {
      try {
        return success(await options.health())
      }
      catch (error) {
        return failure(error)
      }
    }
    try {
      if (event.action === 'applyCheckInTransition') {
        return success(await options.service.applyCheckInTransition(options.verifyInternal(event)))
      }
      if (event.action === 'recordConfirmedEvent') {
        return success(await options.service.recordConfirmedEvent(options.verifyInternal(event)))
      }
      if (event.action === 'grantGameCoins' || event.action === 'spendGameCoins') {
        return success(await options.service.recordGameCoinEvent(options.verifyInternal(event)))
      }
      const caller = await options.resolveCaller()
      if (event.action === 'getSnapshot') {
        return success(await options.service.getSnapshot(caller))
      }
      if (event.action === 'listEntries') {
        return success(await options.service.listEntries(caller, event))
      }
      if (event.action === 'listBadgeCollection') {
        return success(await options.service.listBadgeCollection(caller))
      }
      if (event.action === 'equipBadges') {
        return success(await options.service.equipBadges(caller, event))
      }
      throw new Error('NOT_FOUND')
    }
    catch (error) {
      return failure(error)
    }
  }
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const raw = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || '成长服务暂时不可用',
      retryable: ['CONFLICT', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = { createHandler, failure, success }
