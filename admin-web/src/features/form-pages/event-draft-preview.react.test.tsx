import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { eventPrivateDrafts } from '../../modules/event-private-drafts'
import { EventMobilePreview } from './event-mobile-preview'
import { IndependentFormPage, type IndependentFormPageConfig } from './independent-form-page'

const state = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate, useSearch: () => ({}), useBlocker: () => ({ status: 'idle' }) }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  request: state.request, demoMode: false, hasCapability: () => true,
}) }))
afterEach(cleanup)

it('restores the cover after saving and leaving a private draft, both before and after saving the event', async () => {
  const cover = '20000000-0000-4000-8000-000000000001'
  let stored: Record<string, unknown> | undefined
  state.request.mockImplementation(async (action: string, input: Record<string, unknown>) => {
    if (action === 'mip.admin.events.drafts.save') {
      stored = structuredClone(input.draftData as Record<string, unknown>)
      return { draftId: '7', version: 1 }
    }
    if (action === 'mip.admin.events.drafts.get') return stored ? {
      draftId: '7', eventId: null, version: 1, draftData: stored,
      mediaPreviews: [{ assetId: cover, imageUrl: 'https://media.example/cover.png?fresh=1' }],
    } : null
    if (action === 'mip.admin.events.save') return { id: 'event-created', version: 1, status: 'DRAFT' }
    throw new Error(`Unexpected action: ${action}`)
  })
  const config: IndependentFormPageConfig = {
    title: '新建活动', description: '',
    fields: [{ name: 'title', label: '标题', kind: 'text' }, { name: 'coverAssetId', label: '封面', kind: 'text', hidden: true }],
    values: { title: '封面恢复验收', coverAssetId: cover, _mediaUrls: { [cover]: 'blob:upload-session-only' } },
    action: 'mip.admin.events.save', capability: 'events.write', backTarget: '/events',
    idempotencyKey: 'create-after-restore', submitLabel: '保存并预览',
    buildInput: values => ({ ok: true, input: { title: values.title, coverAssetId: values.coverAssetId } }),
    privateDraft: eventPrivateDrafts(state.request, ''),
    preview: { render: values => <EventMobilePreview values={values} /> },
    publish: { action: 'mip.admin.events.changeStatus', doneMessage: '已发布', buildInput: () => null },
  }
  const mount = (current: IndependentFormPageConfig) => render(<QueryClientProvider client={new QueryClient()}><App><IndependentFormPage config={current} /></App></QueryClientProvider>)
  const first = mount(config)
  await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.events.drafts.get', { eventId: null }))
  fireEvent.click(screen.getByText('保存草稿'))
  await screen.findByText('草稿已保存，可退出后恢复')
  expect(stored).toEqual({ title: '封面恢复验收', coverAssetId: cover })
  first.unmount()

  // A fresh route instance has neither the old upload blob nor a cached URL map.
  mount({ ...config, values: { title: '', coverAssetId: '' } })
  fireEvent.click(await screen.findByText('恢复草稿'))
  expect(screen.getByLabelText('标题')).toHaveValue('封面恢复验收')
  fireEvent.click(screen.getByText('预览'))
  expect(await screen.findByRole('img', { name: '活动封面' })).toHaveAttribute('src', 'https://media.example/cover.png?fresh=1')
  expect(screen.queryByText('封面图片暂不可预览')).not.toBeInTheDocument()
  fireEvent.click(document.querySelector<HTMLButtonElement>('.ant-modal-close')!)
  fireEvent.click(screen.getByText('保存并预览'))
  await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.events.save', {
    title: '封面恢复验收', coverAssetId: cover, idempotencyKey: 'create-after-restore',
  }))
  expect(await screen.findByRole('img', { name: '活动封面' })).toHaveAttribute('src', 'https://media.example/cover.png?fresh=1')
  expect(screen.queryByText('封面图片暂不可预览')).not.toBeInTheDocument()
  expect(JSON.stringify(stored)).not.toContain('https:')
})
