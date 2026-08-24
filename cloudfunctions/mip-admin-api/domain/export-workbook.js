'use strict'

const { decryptPhone } = require('../lib/phone')
const { buildXlsx } = require('../lib/xlsx')

const definitions = Object.freeze({
  USERS: {
    filePrefix: 'mip-users',
    sheetName: '用户',
    columns: [
      ['id', '用户编号'], ['nickname', '昵称'], ['kind', '身份'], ['status', '状态'],
      ['branchName', '分会'], ['cityName', '城市'], ['controls', '名单状态'], ['updatedAt', '更新时间'],
    ],
  },
  EVENT_ROSTER: {
    filePrefix: 'mip-event-roster',
    sheetName: '参与者名单',
    columns: [
      ['id', '报名编号'], ['nickname', '昵称'], ['cityName', '城市'], ['status', '报名状态'],
      ['answers', '报名信息'], ['registeredAt', '报名时间'], ['checkedInAt', '签到时间'],
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
      ['id', '流水编号'], ['nickname', '用户昵称'], ['sourceEventType', '来源'], ['metric', '类型'],
      ['deltaValue', '变动值'], ['balanceAfter', '变动后余额'], ['adjustmentReason', '调整原因'], ['createdAt', '创建时间'],
    ],
  },
})

function orderColumns() {
  return [
    ['id', '订单编号'], ['nickname', '用户昵称'], ['orderType', '订单类型'], ['resourceId', '业务编号'],
    ['merchantOrderNoMasked', '商户订单号'], ['amountCents', '金额（分）'], ['refundedAmountCents', '已退款金额（分）'],
    ['currency', '币种'], ['status', '订单状态'], ['refundStatus', '退款状态'], ['paidAt', '支付时间'], ['createdAt', '创建时间'],
  ]
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
    const index = input.exportType === 'USERS' ? 6 : 4
    columns.splice(index, 0, ['phoneNumber', '手机号'])
  }
  const rows = input.rows.map((source) => {
    const row = {
      ...source,
      controls: Array.isArray(source.controls) ? source.controls.join('、') : source.controls,
      answers: jsonCell(source.answers),
      phoneNumber: phoneNumber(source, input),
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
