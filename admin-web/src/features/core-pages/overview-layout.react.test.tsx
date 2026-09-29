import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { mapAdminOverview } from './overview-model'
import { groupOverviewMetrics } from './overview-metric-groups'
import { OverviewPageView } from './overview-page'

afterEach(cleanup)

it('keeps chart values numeric and preserves unknowns and money units in the matching table', () => {
  const data = mapAdminOverview({ membership: { purchaseFlow: { availability: 'AVAILABLE', series: [{ bucketStartDate: '2030-01-01', initialPurchaseCount: 1234, firstRenewalCount: 0, eligiblePaidAmountCents: 12345 }] } } })
  expect(data.purchaseTrend?.points).toEqual([{ date: '2030-01-01', initial: 1234, firstRenewal: 0, repeatRenewal: null, paidAmount: 123.45 }])
  expect(data.purchaseTrend?.rows[0]).toMatchObject({ initial: '1,234', firstRenewal: '0', repeatRenewal: '—', paidAmount: '123.45' })
  expect(mapAdminOverview({ membership: { purchaseFlow: { availability: 'RESTRICTED', series: [{ initialPurchaseCount: 10 }] } } }).purchaseTrend?.points).toEqual([])
})

it('retains every secondary metric including future unclassified metrics', () => {
  const data = mapAdminOverview({})
  data.metrics.push({ label: '新增指标', value: '—', detail: '暂未统计' })
  expect(groupOverviewMetrics(data.metrics).flatMap(group => group.metrics)).toHaveLength(data.metrics.length - 4)
  expect(groupOverviewMetrics(data.metrics).at(-1)?.metrics[0].label).toBe('新增指标')
})

it('shows four headline cards and lets operators inspect grouped values and pending work', async () => {
  const user = userEvent.setup()
  const data = mapAdminOverview({ membership: { expiringPlayers30d: { availability: 'AVAILABLE', count: 7 } } })
  const navigate = vi.fn()
  render(<OverviewPageView data={data} quickActions={[{ label: '活动管理', target: '/events' }]} onNavigate={navigate} />)
  expect(within(screen.getByRole('region', { name: '关键运营指标' })).getAllByText('—')).toHaveLength(4)
  await user.click(screen.getByRole('tab', { name: '活动与收入' }))
  expect(within(screen.getByRole('tabpanel', { name: '活动与收入' })).getByText('活动净收入')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /30 日内到期会员/ }))
  expect(navigate).toHaveBeenLastCalledWith('/users')
  await user.click(screen.getByRole('button', { name: /活动管理/ }))
  expect(navigate).toHaveBeenLastCalledWith('/events')
})

it('preserves successful data during a failed refresh and keeps retry reachable', async () => {
  const retry = vi.fn()
  render(<OverviewPageView data={mapAdminOverview({})} error="暂时不可用" quickActions={[]} onNavigate={vi.fn()} onRetry={retry} />)
  expect(screen.getByText('刷新失败，当前显示上次成功加载的数据')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '关键运营指标' })).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: /重\s*试/ }))
  expect(retry).toHaveBeenCalledOnce()
})
