import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { UserCooperationCards } from './user-cooperation-cards'
import { emptyCooperationCard, type CooperationSchema, type CooperationCard } from '../../modules/user-cooperation-cards'
const require = createRequire(import.meta.url)
const { CARD_TYPES } = require('../../../../cloudfunctions/mip-admin-api/domain/cooperation-cards.js')
const schemas: CooperationSchema[] = Object.entries(CARD_TYPES).map(([key, value]) => ({ key, ...value as Omit<CooperationSchema, 'key'> }))
const state = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request: state.request, demoMode: false, session: { enabled: true, actor: { id: 'operator' } }, sessionBoundary: 1, hasCapability: () => true }) }))
let cards: CooperationCard[]
beforeEach(() => {
  cards = schemas.map(schema => ({ ...emptyCooperationCard('user-a', schema), id: `card-${schema.key}`, expectedVersion: 3, cardSummary: `${schema.label}说明`, targetSummary: '原有目标', menuFields: Object.fromEntries(schema.menu.map(key => [key, `${key}内容`])), abilityScores: schema.scores.map(key => ({ key, score: 3 })) }))
  state.request.mockReset().mockImplementation(async (action: string, body: CooperationCard) => {
    if (action === 'mip.admin.cooperationCards.get') return { userId: 'user-a', cards: structuredClone(cards), cardTypes: schemas }
    if (action === 'mip.admin.cooperationCards.save') { cards = cards.map(card => card.cardType === body.cardType ? { ...card, ...body, expectedVersion: body.expectedVersion + 1 } : card); return { version: body.expectedVersion + 1 } }
    throw new Error(`Unexpected action: ${action}`)
  })
})
afterEach(cleanup)
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><UserCooperationCards userId="user-a" onEditingChange={vi.fn()} /></App></QueryClientProvider>) }
async function editPlanner() {
  const planner = (await screen.findByText('狗策划', { selector: '.ant-card-head-title' })).closest('.ant-card')!
  fireEvent.click(within(planner as HTMLElement).getByRole('button', { name: /^编\s*辑$/ }))
  await screen.findByLabelText('我的目标')
}
describe('six-type cooperation card editor', () => {
  it('shows all six real types and saves only the selected card with full multiline data', async () => {
    mount(); await editPlanner()
    for (const schema of schemas) expect(screen.getByText(schema.label, { selector: '.ant-card-head-title' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('我的目标'), { target: { value: '新目标第一行\n第二行完整保留' } })
    fireEvent.click(screen.getByRole('button', { name: '保存合作卡' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.cooperationCards.save', expect.objectContaining({ userId: 'user-a', cardType: 'PLANNER', expectedVersion: 3, targetSummary: '新目标第一行\n第二行完整保留', abilityScores: schemas.find(schema => schema.key === 'PLANNER')!.scores.map(key => ({ key, score: 3 })) })))
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存合作卡' })).not.toBeInTheDocument())
    expect(cards.find(card => card.cardType === 'DESIGNER')!.targetSummary).toBe('原有目标')
    expect(state.request.mock.calls.filter(([action]) => action === 'mip.admin.cooperationCards.get').length).toBeGreaterThan(1)
  })
  it('does not write when cancelling an edited card', async () => {
    mount(); await editPlanner()
    fireEvent.change(screen.getByLabelText('我的目标'), { target: { value: '应丢弃的修改' } })
    fireEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByLabelText('我的目标')).not.toBeInTheDocument())
    expect(state.request.mock.calls.some(([action]) => action === 'mip.admin.cooperationCards.save')).toBe(false)
  })
  it('preserves input on a version conflict and requires review before saving again', async () => {
    const normal = state.request.getMockImplementation()!
    state.request.mockImplementation(async (action: string, body: CooperationCard) => {
      if (action === 'mip.admin.cooperationCards.save') throw Object.assign(new Error('合作卡已变化，请刷新'), { code: 'CONFLICT' })
      return normal(action, body)
    })
    mount(); await editPlanner()
    fireEvent.change(screen.getByLabelText('我的目标'), { target: { value: '我的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '保存合作卡' }))
    await screen.findByText('合作卡已变化，请刷新')
    expect(screen.getByLabelText('我的目标')).toHaveValue('我的修改')
    expect(screen.getByRole('button', { name: '保存合作卡' })).toBeDisabled()
    cards = cards.map(card => card.cardType === 'PLANNER' ? { ...card, expectedVersion: 4, cooperationValue: '同事新写的价值' } : card)
    fireEvent.click(screen.getByRole('button', { name: '读取最新版本并保留我的修改' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存合作卡' })).toBeEnabled())
    expect(screen.getByLabelText('我的目标')).toHaveValue('我的修改')
    expect(screen.getByLabelText('和我合作最大的价值')).toHaveValue('同事新写的价值')
  })
})
