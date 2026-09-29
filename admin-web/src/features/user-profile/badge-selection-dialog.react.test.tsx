import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BadgeSelectionDialog } from './badge-selection-dialog'
const state = vi.hoisted(() => ({ request: vi.fn(), boundary: 'session-a' }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request: state.request, session: { enabled: true, actor: { id: state.boundary } }, sessionBoundary: state.boundary, demoMode: false }) }))
const catalog = { items: [{ id: 'badge-a', name: '助人徽章', status: 'ACTIVE' }, { id: 'badge-b', name: '协作徽章', status: 'ACTIVE' }] }
const awards: Array<{id: string; userId: string; badgeId: string; version: number; equipped: boolean}> = []
const award = (badgeId: string) => ({ id: `award-${badgeId}`, userId: 'user-a', badgeId, version: 1, equipped: false })
function mount(onClose = vi.fn()) { const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return { ...render(<QueryClientProvider client={cache}><App><BadgeSelectionDialog userId="user-a" open onClose={onClose} /></App></QueryClientProvider>), onClose } }
async function select(name: string) { await waitFor(() => expect(screen.getByRole('button', { name: '保存勋章' })).toBeEnabled()); fireEvent.mouseDown(screen.getByRole('combobox')); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' }); fireEvent.click(await screen.findByText(name, { selector: '.ant-select-item-option-content' })); }
const save = () => fireEvent.click(screen.getByRole('button', { name: /保存勋章/ }))
afterEach(cleanup)
beforeEach(() => { awards.length = 0; state.boundary = 'session-a'; state.request.mockReset(); state.request.mockImplementation(async action => action === 'mip.admin.badges.list' ? catalog : { items: [...awards] }) })
it('only changes selection locally and cancellation never grants or revokes', async () => {
  const { onClose } = mount(); await select('助人徽章'); fireEvent.click(screen.getByRole('button', { name: /取\s*消/ })); expect(onClose).toHaveBeenCalledOnce(); expect(state.request.mock.calls.every(call => !['mip.admin.badges.grant', 'mip.admin.badges.revoke'].includes(call[0]))).toBe(true)
})
it('retries an ambiguous grant with the same request key after reading existing awards', async () => {
  let writes = 0
  state.request.mockImplementation(async (action, input) => {
    if (action === 'mip.admin.badges.list') return catalog
    if (action === 'mip.admin.badges.awards') return { items: [...awards] }
    if (++writes === 1) throw { code: 'SERVICE_UNAVAILABLE' }
    awards.push(award(input.badgeId)); return { id: awards[0].id }
  })
  const { onClose } = mount(); await select('助人徽章'); fireEvent.change(screen.getByLabelText('勋章调整原因'), { target: { value: '活动帮助' } }); save()
  await screen.findByText(/已重新读取获授记录/); save(); await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  const calls = state.request.mock.calls.filter(call => call[0] === 'mip.admin.badges.grant'); expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1])
})
it('keeps the dialog and local selection when a committed write cannot be read back', async () => {
  let written = false
  state.request.mockImplementation(async (action, input) => {
    if (action === 'mip.admin.badges.list') return catalog
    if (action === 'mip.admin.badges.awards') { if (written) throw { code: 'SERVICE_UNAVAILABLE' }; return { items: [] } }
    written = true; awards.push(award(input.badgeId)); return { id: awards[0].id }
  })
  const { onClose } = mount(); await select('助人徽章'); fireEvent.change(screen.getByLabelText('勋章调整原因'), { target: { value: '活动帮助' } }); save()
  await screen.findByText(/结果尚未确认/); expect(onClose).not.toHaveBeenCalled(); await waitFor(() => expect(screen.getByRole('button', { name: /保存勋章/ })).toBeDisabled()); await waitFor(() => expect(screen.getByRole('button', { name: '重新读取勋章记录' })).toBeEnabled())
})
it('reads partially committed awards and retries only the remaining selection', async () => {
  let failed = false
  state.request.mockImplementation(async (action, input) => {
    if (action === 'mip.admin.badges.list') return catalog
    if (action === 'mip.admin.badges.awards') return { items: [...awards] }
    if (input.badgeId === 'badge-b' && !failed) { failed = true; throw { code: 'SERVICE_UNAVAILABLE' } }
    awards.push(award(input.badgeId)); return { id: awards.at(-1)?.id }
  })
  const { onClose } = mount(); await select('助人徽章'); await select('协作徽章'); fireEvent.change(screen.getByLabelText('勋章调整原因'), { target: { value: '活动帮助' } }); save(); await screen.findByText(/已重新读取获授记录/); save(); await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(state.request.mock.calls.filter(call => call[0] === 'mip.admin.badges.grant').map(call => call[1].badgeId)).toEqual(['badge-a', 'badge-b', 'badge-b'])
})
