'use strict'

const { decryptPhone } = require('../lib/phone')
const { buildXlsx } = require('../lib/xlsx')
const { feedbackDisplayFields } = require('./event-feedback-display')
const { CARD_TYPES } = require('./cooperation-cards')

const definitions = Object.freeze({
  USERS: {
    filePrefix: 'mip-users',
    sheetName: '用户',
    columns: [
      ['id', '用户记录编号'], ['playerNumber', '玩家编号'], ['nickname', '昵称'], ['kind', '身份'], ['status', '状态'],
      ['branchName', '分会'], ['cityName', '城市'], ['industryNames', '行业'], ['identityStatus', '职业身份'], ['levelName', '当前等级'],
      ['experience', '累计经验值'], ['contribution', '贡献值'], ['firstPlayerAt', '首次成为玩家时间'],
      ['latestEntitlementEndsAt', '最近权益到期时间'], ['totalValidMembershipSeconds', '累计有效会员时长（秒）'],
      ['controls', '名单状态'], ['createdAt', '注册时间'], ['updatedAt', '更新时间'],
    ],
  },
  EVENT_ROSTER: {
    filePrefix: 'mip-event-roster',
    sheetName: '参与者名单',
    columns: [
      ['id', '报名编号'], ['nickname', '昵称'], ['cityName', '城市'], ['status', '报名状态'],
      ...rosterColumns(),
    ],
  },
  EVENT_ROSTER_ALL: {
    filePrefix: 'mip-event-roster-all',
    sheetName: '全部活动参与者',
    columns: [
      ['id', '报名编号'], ['eventTitle', '活动'], ['branchName', '分会'],
      ['nickname', '昵称'], ['cityName', '城市'], ['status', '报名状态'],
      ...rosterColumns(),
    ],
  },
  EVENT_FEEDBACK: {
    filePrefix: 'mip-event-feedback',
    sheetName: '活动反馈',
    columns: [
      ['id', '反馈编号'], ['nickname', '昵称'], ['rating', '评分'],
      ['wouldRecommend', '是否推荐'], ['capabilityRoles', '能力角色'], ['body', '资源与合作需求全文'],
      ['joinMipIntent', '加入意向'], ['discoverySource', '了解方式'], ['rosterConsent', '名册授权'],
      ['answers', '结构化答案'], ['submittedAt', '提交时间'],
    ],
  },
  EVENT_ORDERS: {
    filePrefix: 'mip-event-orders',
    sheetName: '活动订单',
    columns: orderColumns(),
  },
  ORDERS: {
    filePrefix: 'mip-orders',
    sheetName: '订单',
    columns: orderColumns(),
  },
  GROWTH_ENTRIES: {
    filePrefix: 'mip-growth-entries',
    sheetName: '成长流水',
    columns: [
      ['id', '流水编号'], ['nickname', '用户昵称'], ['sourceEventType', '来源'], ['sourceEventId', '关联业务编号'], ['metric', '类型'],
      ['deltaValue', '变动值'], ['balanceBefore', '变动前余额'], ['balanceAfter', '变动后余额'], ['adjustmentReason', '调整原因'], ['createdAt', '创建时间'],
    ],
  },
  OPPORTUNITIES: {
    filePrefix: 'mip-opportunities',
    sheetName: '机会',
    columns: [
      ['id', '机会编号'], ['title', '标题'], ['ownerNickname', '发布人'],
      ['scopeType', '可见范围'], ['branchName', '分会'], ['locationDisplay', '合作地区'], ['status', '状态'],
      ['valueSummary', '价值说明'], ['targetSummary', '合作目标'], ['description', '机会全文'],
      ['minimumAmountWan', '最低金额（万元）'], ['maximumAmountWan', '最高金额（万元）'], ['currency', '币种'],
      ['roleNames', '合作角色'], ['tags', '标签'], ['referralCount', '引荐数量'], ['coverUrl', '封面地址'],
      ['contentSafetyStatus', '内容安全状态'], ['deadlineAt', '截止时间'], ['publishedAt', '发布时间'],
      ['endedAt', '结束时间'], ['moderatedAt', '处理时间'], ['moderationReason', '处理原因'],
      ['archivedAt', '归档时间'], ['archiveReason', '归档原因'], ['updatedAt', '更新时间'],
    ],
  },
})

function orderColumns() {
  return [
    ['id', '订单编号'], ['nickname', '用户昵称'], ['orderType', '订单类型'], ['resourceId', '业务编号'],
    ['resourceTitle', '活动/会员/内容商品名'], ['resourceBranchName', '活动服务器'], ['merchantOrderNoMasked', '商户订单号'],
    ['providerTransactionIdMasked', '微信支付单号（脱敏）'], ['amountYuan', '金额（元）'], ['refundedAmountYuan', '已退款金额（元）'],
    ['currency', '币种'], ['status', '订单状态'], ['refundStatus', '退款状态'], ['paidAt', '支付时间'], ['createdAt', '创建时间'],
    ['entitlementStartsAt', '会员权益开始时间'], ['entitlementEndsAt', '会员权益结束时间'],
  ]
}

function rosterColumns() {
  return [
    ['registrationStatus', '原始报名状态'], ['source', '报名来源'], ['roleMark', '角色标记'], ['abnormalReason', '异常原因'],
    ['answers', '报名信息'], ['submittedAt', '提交时间'], ['registeredAt', '报名时间'], ['checkedInAt', '签到时间'],
    ['orderId', '订单编号'], ['paymentStatus', '支付状态'], ['paidAmountYuan', '实付金额（元）'],
    ['refundedAmountYuan', '已退款金额（元）'], ['currency', '币种'], ['paidAt', '支付时间'],
  ]
}

function money(value, divisor, fixed = false) {
  if (value === null || value === undefined || value === '') return ''
  const amount = Number(value)
  if (!Number.isSafeInteger(amount)) throw new Error('EXPORT_AMOUNT_INVALID')
  return fixed ? (amount / divisor).toFixed(2) : String(amount / divisor)
}

function jsonCell(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'object') return String(value)
  return JSON.stringify(value)
}

function phoneNumber(row, input) {
  if (!input.includesPhone) return ''
  if (!row.phoneCiphertext) return ''
  return decryptPhone(row.phoneCiphertext, input.phoneEncryptionKey, {
    appId: input.appId,
    userId: row.userId || row.id,
  })
}

function workbookForExport(input) {
  const definition = definitions[input.exportType]
  if (!definition || !Array.isArray(input.rows)) throw new Error('EXPORT_TYPE_INVALID')
  const columns = [...definition.columns]
  if (input.includesPhone) {
    const index = columns.findIndex(([key]) => key === 'cityName') + 1
    if (index === 0) throw new Error('EXPORT_PHONE_TYPE_INVALID')
    columns.splice(index, 0, ['phoneNumber', '手机号'])
  }
  const rows = input.rows.map((source) => {
    const row = {
      ...source,
      controls: Array.isArray(source.controls) ? source.controls.join('、') : source.controls,
      answers: jsonCell(source.answers),
      tags: Array.isArray(source.tags) ? source.tags.join('、') : source.tags,
      phoneNumber: phoneNumber(source, input),
      amountYuan: money(source.amountCents, 100, true),
      paidAmountYuan: money(source.paidAmountCents, 100, true),
      refundedAmountYuan: money(source.refundedAmountCents, 100, true),
      minimumAmountWan: money(source.commercialTerms?.minAmountCents, 1000000),
      maximumAmountWan: money(source.commercialTerms?.maxAmountCents, 1000000),
      currency: source.commercialTerms?.currency || source.currency,
      locationDisplay: source.commercialTerms?.locationDisplay || source.commercialTerms?.locations?.map(location =>
        location.type === 'NATIONAL' ? '全国' : location.type === 'REMOTE' ? '远程' : location.cityName || '').filter(Boolean).join('、') || source.cityName,
      roleNames: Array.isArray(source.roleKeys) ? source.roleKeys.map(key => Object.values(CARD_TYPES).find(card => card.roleKey === key)?.label || key).join('、') : '',
      ...(input.exportType === 'EVENT_FEEDBACK' ? feedbackDisplayFields(source) : {}),
    }
    return columns.map(([key]) => jsonCell(row[key]))
  })
  const content = buildXlsx({
    sheetName: definition.sheetName,
    header: columns.map(([, label]) => label),
    rows,
  })
  return {
    content,
    filePrefix: definition.filePrefix,
    rowCount: rows.length,
  }
}

function exportFileName(exportType, createdAt) {
  const definition = definitions[exportType]
  if (!definition) throw new Error('EXPORT_TYPE_INVALID')
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) throw new Error('EXPORT_DATE_INVALID')
  return `${definition.filePrefix}-${date.toISOString().replace(/[-:.]/g, '')}.xlsx`
}

module.exports = { definitions, exportFileName, workbookForExport }
