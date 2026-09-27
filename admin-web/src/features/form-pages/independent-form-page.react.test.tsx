import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndependentFormPageConfig } from './independent-form-page'
import { IndependentFormPage } from './independent-form-page'

const state = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  request: state.request, demoMode: false, hasCapability: () => true,
}) }))

afterEach(cleanup)
beforeEach(() => {
  state.request.mockReset().mockResolvedValue({})
  state.navigate.mockReset()
})

const config: IndependentFormPageConfig = {
  title: '编辑记录',
  description: '',
  fields: [
    { name: 'title', label: '标题', kind: 'text', required: true },
    { name: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
  ],
  values: { title: '默认标题', expectedVersion: 1 },
  backTarget: '/records',
  buildInput: values => ({ ok: true, input: { title: values.title, expectedVersion: values.expectedVersion } }),
  action: 'mip.admin.knowledge.contents.save',
  idempotencyKey: 'initial-save-key',
  capability: 'knowledge.write',
}

function mount(loadDetail: () => Promise<Record<string, unknown> | null>) {
  return render(<QueryClientProvider client={new QueryClient()}><App><IndependentFormPage config={config} loadDetail={loadDetail} /></App></QueryClientProvider>)
}

describe('IndependentFormPage loaded-record submission', () => {
  it('passes the loaded hidden expectedVersion through the real submit path', async () => {
    mount(async () => ({ title: '服务端标题', expectedVersion: 8 }))
    await screen.findByDisplayValue('服务端标题')
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))

    await waitFor(() => expect(state.request).toHaveBeenCalledOnce())
    expect(state.request).toHaveBeenCalledWith('mip.admin.knowledge.contents.save', {
      title: '服务端标题', expectedVersion: 8, idempotencyKey: 'initial-save-key',
    })
  })

  it('blocks submission after detail load failure and allows a successful retry', async () => {
    const loadDetail = vi.fn()
      .mockRejectedValueOnce(new Error('详情服务暂时不可用'))
      .mockResolvedValueOnce({ title: '恢复后的标题', expectedVersion: 5 })
    mount(loadDetail)

    await screen.findByText('记录加载失败')
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument()
    expect(state.request).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByDisplayValue('恢复后的标题')
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))

    await waitFor(() => expect(state.request).toHaveBeenCalledOnce())
    expect(state.request).toHaveBeenCalledWith('mip.admin.knowledge.contents.save', {
      title: '恢复后的标题', expectedVersion: 5, idempotencyKey: 'initial-save-key',
    })
    expect(loadDetail).toHaveBeenCalledTimes(2)
  })

  it('reuses the key for an unchanged retry and rotates it after the payload changes', async () => {
    state.request
      .mockRejectedValueOnce(new Error('请求失败'))
      .mockRejectedValueOnce(new Error('请求仍未确认'))
      .mockResolvedValueOnce({})
    mount(async () => ({ title: '已加载标题', expectedVersion: 3 }))
    await screen.findByDisplayValue('已加载标题')

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '第一次提交' } })
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2))

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '修改后的提交' } })
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3))

    const first = state.request.mock.calls[0]?.[1]
    const retry = state.request.mock.calls[1]?.[1]
    const changed = state.request.mock.calls[2]?.[1]
    expect(first).toMatchObject({ title: '第一次提交', expectedVersion: 3, idempotencyKey: 'initial-save-key' })
    expect(retry).toMatchObject({ title: '第一次提交', expectedVersion: 3, idempotencyKey: 'initial-save-key' })
    expect(changed).toMatchObject({ title: '修改后的提交', expectedVersion: 3, idempotencyKey: expect.any(String) })
    expect(changed?.idempotencyKey).not.toBe(first?.idempotencyKey)
  })

  it('does not let an earlier record response replace the record loaded after a switch', async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void
    const firstLoad = () => new Promise<Record<string, unknown>>(resolve => { resolveFirst = resolve })
    const secondLoad = vi.fn().mockResolvedValue({ title: '第二条记录', expectedVersion: 12 })
    const view = mount(firstLoad)

    view.rerender(<QueryClientProvider client={new QueryClient()}><App><IndependentFormPage config={{ ...config, values: { title: '第二条默认值', expectedVersion: 1 } }} loadDetail={secondLoad} /></App></QueryClientProvider>)
    await screen.findByDisplayValue('第二条记录')
    resolveFirst({ title: '第一条记录迟到响应', expectedVersion: 4 })

    await waitFor(() => expect(screen.getByLabelText('标题')).toHaveValue('第二条记录'))
    expect(secondLoad).toHaveBeenCalledOnce()
  })

  it('keeps an in-progress new-record value across ordinary parent rerenders', () => {
    const view = render(<QueryClientProvider client={new QueryClient()}><App><IndependentFormPage config={config} /></App></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新建草稿内容' } })

    view.rerender(<QueryClientProvider client={new QueryClient()}><App><IndependentFormPage config={{ ...config, values: { ...config.values } }} /></App></QueryClientProvider>)

    expect(screen.getByLabelText('标题')).toHaveValue('新建草稿内容')
    expect(state.request).not.toHaveBeenCalled()
  })

  it('refreshes the server version after a conflict so the retry can succeed', async () => {
    const loadDetail = vi.fn()
      .mockResolvedValueOnce({ title: '原标题', expectedVersion: 3 })
      .mockResolvedValueOnce({ title: '别人的新标题', expectedVersion: 7 })
    state.request
      .mockRejectedValueOnce({ code: 'VERSION_CONFLICT' })
      .mockResolvedValueOnce({})
    mount(loadDetail)
    await screen.findByDisplayValue('原标题')

    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(screen.getByText(/已刷新最新版本/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('标题')).toHaveValue('别人的新标题'))

    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2))
    expect(state.request.mock.calls[1]?.[1]).toMatchObject({ title: '别人的新标题', expectedVersion: 7 })
  })
})
