'use strict'

const { assertNoClientScore } = require('./validation')

const actions = Object.freeze({
  getOverview: (service, caller, event) => service.getOverview(caller, event),
  getRules: (service, caller, event) => service.getRules(caller, event),
  getTeam: (service, caller, event) => service.getTeam(caller, event),
  listHistory: (service, caller, event) => service.listHistory(caller, event),
  listRankings: (service, caller, event) => service.listRankings(caller, event),
  'admin.getSession': (service, caller) => service.getAdminSession(caller),
  'admin.listRankings': (service, caller, event) => service.listAdminRankings(caller, event),
  'admin.listSeasons': (service, caller) => service.listSeasons(caller),
  'admin.saveSeason': (service, caller, event) => service.saveSeason(caller, event),
  'admin.changeSeasonStatus': (service, caller, event) => service.changeSeasonStatus(caller, event),
  'admin.listTeams': (service, caller, event) => service.listTeams(caller, event),
  'admin.saveTeam': (service, caller, event) => service.saveTeam(caller, event),
  'admin.listAssignableMembers': (service, caller, event) => service.listAssignableMembers(caller, event),
  'admin.replaceTeamMembers': (service, caller, event) => service.replaceTeamMembers(caller, event),
  'admin.listMatches': (service, caller, event) => service.listAdminMatches(caller, event),
  'admin.saveWeeklyMatch': (service, caller, event) => service.saveWeeklyMatch(caller, event),
  'admin.finalizeWeeklyMatch': (service, caller, event) => service.finalizeWeeklyMatch(caller, event),
  'admin.generateRankingSnapshot': (service, caller, event) => service.generateRankingSnapshot(caller, event),
})

const messages = Object.freeze({
  AUTH_REQUIRED: '登录后可继续操作',
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  CONFLICT: '数据已变化，请刷新后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  INVALID_STATE: '当前状态不支持此操作',
  MEMBER_NOT_FOUND: '部分成员当前不可用，请刷新后重试',
  MEMBERSHIP_REQUIRED: '当前功能仅对有效会员开放',
  NOT_FOUND: '相关记录不存在',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  SCORE_NOT_ACCEPTED: '积分由服务端成长流水生成，不能手动提交',
  VALIDATION_FAILED: '提交内容格式不正确，请检查后重试',
})

function createHandler(options) {
  return async function handler(event = {}) {
    try {
      if (event.action === 'health') return success(await options.health())
      const action = typeof event.action === 'string' ? event.action : ''
      const dispatch = actions[action]
      if (!dispatch) throw new Error('NOT_FOUND')
      assertNoClientScore(event)
      const caller = await options.resolveCaller()
      if (action.startsWith('admin.')) await options.assertAdminReady(caller)
      else await options.assertPlayerReady(caller)
      return success(await dispatch(options.service, caller, event))
    }
    catch (error) {
      return failure(error)
    }
  }
}

function success(data) { return { ok: true, data } }

function failure(error) {
  const raw = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || '赛季服务暂时不可用',
      retryable: ['CONFLICT', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = { actions, createHandler, failure, success }
