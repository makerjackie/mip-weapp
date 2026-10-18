import { describe, expect, it } from 'vitest'
import { createDemoReadPage } from './demo-read-pages'

describe('demo read pages', () => {
  it('renders the first-join approval demo queue with the same decide row action shape', () => {
    const page = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'membershipApprovals' } })
    expect(page.sections.map(section => section.title)).toEqual(['入会审核'])
    const section = page.sections[0]
    expect(section.columns.map(column => column.key)).toEqual(['user', 'playerNumber', 'plan', 'amount', 'paidAt', 'requestedAt', 'state', 'decision'])
    expect(section.rows).toHaveLength(2)
    const [pending, rejected] = section.rows
    expect(pending.state).toBe('待处理')
    expect(pending.decision).toBe('—')
    expect(pending.rowActions).toEqual([{
      action: 'mip.admin.membershipApprovals.decide',
      label: '审核',
      targetId: 'USR-1002',
      values: { expectedChainVersion: 3 },
      allowedCapabilities: ['memberships.adjust'],
    }])
    expect(rejected.decision).toBe('驳回：线下支付未确认')
    expect(rejected.rowActions?.[0].label).toBe('复议')
  })

  it('keeps the demo growth overview compact and honors the section filter', () => {
    const overview = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20 })
    // MIW-129：无分区调用保留四页主分区的紧凑概览。
    expect(overview.sections.map(section => section.title)).toEqual(['等级', '经验值流水', '贡献值流水', '权益流水'])
    const levels = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'levels' } })
    expect(levels.sections.map(section => section.title)).toEqual(['等级'])
    expect(levels.sections[0].columns.map(column => column.label)).toEqual(['等级', '名称', '经验值门槛', '权益数', '用户数', '状态'])
    const entries = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'entries' } })
    expect(entries.sections[0].columns.map(column => column.label)).toEqual(['流水号', '玩家 ID', '来源', '变动值', '变动前', '变动后', '时间'])
    const contribution = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'contributionTransactions' } })
    expect(contribution.sections[0].columns.map(column => column.label)).toEqual(['流水号', '用户', '行为', '变动值', '关联业务', '时间'])
    expect(contribution.sections[0].rows[0].related).toBeTruthy()
    const entitlements = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'entitlements' } })
    expect(entitlements.sections[0].columns.map(column => column.label)).toEqual(['权益流水号', '用户', '昵称', '权益类型', '权益内容', '关联订单号', '发放人', '发放时间'])
  })

  it('serves the login-record demo fixture with the login column set for type=LOGIN', () => {
    const page = createDemoReadPage('auditLogs', { query: '', status: '', cursor: null, limit: 20, filters: { type: 'LOGIN' } })
    expect(page.sections).toHaveLength(1)
    expect(page.sections[0].title).toBe('登录记录')
    expect(page.sections[0].columns.map(column => column.label)).toEqual(['登录账号', '时间', '结果', 'IP', '设备', '失败原因'])
    expect(page.sections[0].rows).toHaveLength(3)
    const [first, second, failed] = page.sections[0].rows
    expect(first.result).toBe('成功')
    expect(first.account).toBe('admin')
    expect(second.result).toBe('成功')
    expect(failed.result).toBe('失败')
    expect(failed.failureReason).toBe('密码错误')
    expect(failed.ip).toBe('198.51.100.7')
  })

  it('keeps the audit-logs demo page on operation columns without the LOGIN type filter', () => {
    const page = createDemoReadPage('auditLogs', { query: '', status: '', cursor: null, limit: 20 })
    expect(page.sections[0].columns.map(column => column.label)).toEqual(['操作者', '操作', '模块', '时间'])
    expect(page.sections[0].rows).toHaveLength(0)
  })
})
