import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { loadAdminDetail } from '../../modules/admin-details'
import type { AdminDetailRequest } from '../../modules/admin-details'
import { DetailSections } from '../../shared/ui/detail-drawer'

const session = vi.hoisted(() => ({ client: { tempUrls: vi.fn() }, demoMode: false }))
const tempUrls = session.client.tempUrls
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => session }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders saved event HTML safely and keeps roster, feedback, and operational data individually reachable', async () => {
  tempUrls.mockResolvedValue({ 'cloud://test/intro.png': 'https://cdn.example.test/intro.png' })
  const event = {
    id: 'event-1', title: '城市交流', status: 'PUBLISHED', version: 8, priceCents: 18800,
    description: '<p>介绍<strong>重点</strong></p><img src="cloud://test/intro.png" alt="活动插图" onerror="alert(1)"><script>alert(1)</script>',
    organizerIntroduction: '<p>主办方内容</p><img src="https://cdn.example.test/org.png" alt="主办方图片">',
    notices: '<p>请准时到场</p>',
  }
  const request: AdminDetailRequest = async <T,>(action: string) => ({
    'mip.admin.events.get': event,
    'mip.admin.events.insights.get': { participation: { effectiveRegistrationCount: 4 } },
    'mip.admin.events.roster': { items: [{ id: 'reg-1', nickname: '参与测试用户', status: 'REGISTERED', userDetailId: 'user-1' }], nextCursor: 'page-2' },
    'mip.admin.events.feedbacks.list': { items: [], nextCursor: null },
  }[action] as T)
  const view = await loadAdminDetail('events', 'event-1', request, { includeEventFeedback: true })
  const onPagerChange = vi.fn()
  const onNestedView = vi.fn()
  const { container } = render(<DetailSections open view={view} onClose={() => {}} onPagerChange={onPagerChange} onNestedView={onNestedView} />)
  expect(screen.getByText('重点').tagName).toBe('STRONG')
  expect(await screen.findByRole('img', { name: '活动插图' })).toHaveAttribute('src', 'https://cdn.example.test/intro.png')
  expect(container.querySelector('script, [onerror]')).toBeNull()
  expect(container.textContent).not.toContain('<p>')
  expect(screen.queryByText('版本')).toBeNull()
  expect(view.sections[0].fields?.find(field => field.label === '版本')?.value).toBe('8')
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: '主办方介绍' }))
  expect(await screen.findByText('主办方内容')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: '报名须知' }))
  expect(await screen.findByText('请准时到场')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: '参与人' }))
  expect(await screen.findByText('参与测试用户')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '用户档案' }))
  expect(onNestedView).toHaveBeenCalledWith('users', { detailId: 'user-1' })
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(onPagerChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'eventRoster', nextCursor: 'page-2' }), 'next')
  await user.click(screen.getByRole('tab', { name: '活动反馈' }))
  expect(await screen.findByText('暂无记录')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: '运营数据' }))
  expect(await screen.findByText('有效报名')).toBeVisible()
})

it('does not discard readable content when image resolution fails or expose ungranted roster tabs', async () => {
  tempUrls.mockRejectedValue(new Error('临时不可用'))
  const request: AdminDetailRequest = async <T,>(action: string) => (action === 'mip.admin.events.get'
    ? { id: 'e-2', title: '正常正文', description: '<p>可读内容</p><img src="cloud://test/p.png">' }
    : {}) as T
  const view = await loadAdminDetail('events', 'e-2', request, { includeEventRoster: false, includeEventFeedback: false })
  render(<DetailSections open view={view} onClose={() => {}} />)
  expect(screen.getByText('可读内容')).toBeVisible()
  await waitFor(() => expect(tempUrls).toHaveBeenCalledWith(['cloud://test/p.png']))
  expect(screen.getByText('图片暂不可预览，请稍后重试')).toBeVisible()
  expect(screen.queryByRole('tab', { name: '参与人' })).toBeNull()
  expect(screen.queryByRole('tab', { name: '活动反馈' })).toBeNull()
})
