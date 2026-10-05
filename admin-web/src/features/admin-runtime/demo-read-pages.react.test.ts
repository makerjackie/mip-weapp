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
    expect(overview.sections.map(section => section.title)).toEqual(['等级', '成长流水', '徽章', '入会审核'])
    const levels = createDemoReadPage('growth', { query: '', status: '', cursor: null, limit: 20, filters: { section: 'levels' } })
    expect(levels.sections.map(section => section.title)).toEqual(['等级'])
  })
})
