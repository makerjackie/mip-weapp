'use strict'

const { assertNoClientScore } = require('./validation')

const actions = Object.freeze({
  listBlindBoxes: (service, caller) => service.listBlindBoxes(caller),
  getBlindBox: (service, caller, event) => service.getBlindBox(caller, event),
  drawBlindBox: (service, caller, event) => service.drawBlindBox(caller, event),
  getBlindBoxInventory: (service, caller, event) => service.getBlindBoxInventory(caller, event),
  listBlindBoxCoinEntries: (service, caller, event) => service.listBlindBoxCoinEntries(caller, event),
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
  'admin.changeTeamStatus': (service, caller, event) => service.changeTeamStatus(caller, event),
  'admin.listAssignableMembers': (service, caller, event) => service.listAssignableMembers(caller, event),
  'admin.replaceTeamMembers': (service, caller, event) => service.replaceTeamMembers(caller, event),
  'admin.listMatches': (service, caller, event) => service.listAdminMatches(caller, event),
  'admin.saveWeeklyMatch': (service, caller, event) => service.saveWeeklyMatch(caller, event),
  'admin.finalizeWeeklyMatch': (service, caller, event) => service.finalizeWeeklyMatch(caller, event),
  'admin.generateRankingSnapshot': (service, caller, event) => service.generateRankingSnapshot(caller, event),
  'admin.listBlindBoxCatalogs': (service, caller) => service.adminListBlindBoxCatalogs(caller),
  'admin.saveBlindBoxCatalog': (service, caller, event) => service.adminSaveBlindBoxCatalog(caller, event),
  'admin.changeBlindBoxCatalogStatus': (service, caller, event) => service.adminChangeBlindBoxCatalogStatus(caller, event),
  'admin.listBlindBoxCards': (service, caller, event) => service.adminListBlindBoxCards(caller, event),
  'admin.saveBlindBoxCard': (service, caller, event) => service.adminSaveBlindBoxCard(caller, event),
  'admin.changeBlindBoxCardStatus': (service, caller, event) => service.adminChangeBlindBoxCardStatus(caller, event),
})

const messages = Object.freeze({
  AUTH_REQUIRED: '登录后可继续操作',
  AGREEMENT_REQUIRED: '请先确认服务协议和隐私协议',
  BLIND_BOX_DAILY_LIMIT_REACHED: '今日抽取次数已达到上限',
  BLIND_BOX_PITY_STOCK_UNAVAILABLE: '当前库存不能满足保底规则',
  BLIND_BOX_STOCK_CONFLICT: '库存数量低于已抽取数量，请刷新后重试',
  BLIND_BOX_STOCK_UNAVAILABLE: '当前没有可抽取的卡牌',
  CONFLICT: '数据已变化，请刷新后重试',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  IDEMPOTENCY_CONFLICT: '该请求标识已用于其他盲盒',
  INVALID_STATE: '当前状态不支持此操作',
  INSUFFICIENT_GAME_COIN_BALANCE: '游戏币余额不足',
  MEMBER_NOT_FOUND: '部分成员当前不可用，请刷新后重试',
  MEMBER_LIMIT_EXCEEDED: '所选成员超过当前队伍人数上限',
  MEMBERSHIP_REQUIRED: '当前功能仅对有效会员开放',
  NOT_FOUND: '相关记录不存在',
  PAGINATION_REQUIRED: '成员名单需要按页完整加载后再操作',
  PHONE_REQUIRED: '请先绑定手机号',
  PROFILE_REQUIRED: '请先完善个人资料',
  SCORE_NOT_ACCEPTED: '积分由服务端成长流水生成，不能手动提交',
  TEAM_HAS_ACTIVE_MEMBERS: '请先迁移或移除队伍中的成员，再停用队伍',
  VALIDATION_FAILED: '提交内容格式不正确，请检查后重试',
})

const CONTRACT_VERSION = 1

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutCloudbaseMetadata(value) {
  const request = { ...value }
  for (const key of ['userInfo', 'tcbContext']) {
    if (!Object.hasOwn(request, key)) continue
    if (!isRecord(request[key])) throw new Error('VALIDATION_FAILED')
    delete request[key]
  }
  return request
}

function businessInput(value) {
  const {
    action: _action,
    contractVersion: _contractVersion,
    input: _input,
    ...input
  } = value
  return input
}

function normalizeRequest(rawEvent) {
  if (!isRecord(rawEvent)) throw new Error('VALIDATION_FAILED')
  const event = withoutCloudbaseMetadata(rawEvent)
  const action = typeof event.action === 'string' ? event.action : ''
  if (event.contractVersion === undefined) {
    return { action, input: businessInput(event), legacy: true }
  }
  if (event.contractVersion !== CONTRACT_VERSION
    || !isRecord(event.input)
    || Object.keys(event).some(key => !['contractVersion', 'action', 'input'].includes(key))) {
    throw new Error('VALIDATION_FAILED')
  }
  return { action, input: businessInput(event.input), legacy: false }
}

function createHandler(options) {
  return async function handler(event = {}) {
    try {
      const { action, input } = normalizeRequest(event)
      if (action === 'health') return success(await options.health())
      const dispatch = Object.hasOwn(actions, action) ? actions[action] : null
      if (!dispatch) throw new Error('NOT_FOUND')
      assertNoClientScore(input)
      const caller = await options.resolveCaller()
      if (action.startsWith('admin.')) await options.assertAdminReady(caller)
      else await options.assertPlayerReady(caller)
      return success(await dispatch(options.service, caller, input))
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

module.exports = { CONTRACT_VERSION, actions, createHandler, failure, normalizeRequest, success }
