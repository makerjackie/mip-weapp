import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MutationDialog } from './mutation-dialog'

afterEach(cleanup)

it('keeps labels associated with their own form when two forms use the same field key', () => {
  render(<>
    <MutationDialog open title="视频" description="" fields={[{ name: 'title', label: '视频标题', kind: 'text' }]}
      values={{ title: '视频草稿' }} onCancel={() => {}} onSubmit={() => {}} />
    <MutationDialog open title="Banner" description="" fields={[{ name: 'title', label: '管理名称', kind: 'text' }]}
      values={{ title: 'Banner 草稿' }} onCancel={() => {}} onSubmit={() => {}} />
  </>)
  const video = screen.getByRole('textbox', { name: '视频标题' })
  const banner = screen.getByRole('textbox', { name: '管理名称' })
  expect(video).toHaveValue('视频草稿')
  expect(banner).toHaveValue('Banner 草稿')
  expect(video.id).not.toEqual(banner.id)
})

it('starts a different operation with its own empty fields instead of the previous resource values', () => {
  const shared = { open: true, description: '', onCancel: () => {}, onSubmit: () => {} }
  const view = render(<MutationDialog {...shared} key="server-edit" title="服务器" fields={[{ name: 'name', label: '服务器名称', kind: 'text' }]} values={{ name: '上海分会' }} />)
  expect(screen.getByRole('textbox', { name: '服务器名称' })).toHaveValue('上海分会')
  view.rerender(<MutationDialog {...shared} key="message-create" title="消息" fields={[{ name: 'name', label: '活动名称', kind: 'text' }]} values={{}} />)
  expect(screen.getByRole('textbox', { name: '活动名称' })).toHaveValue('')
})

import userEvent from '@testing-library/user-event'

it('shows the empty-catalog guidance on static selects and multi-selects', async () => {
  const user = userEvent.setup()
  render(<MutationDialog open title="任务" description="" fields={[
    { name: 'eligibleLevelIds', label: '可参与等级', kind: 'multi-select', options: [], emptyHint: '暂无可选等级。等级在「等级管理」页的等级配置中维护' },
  ]} values={{ eligibleLevelIds: [] }} onCancel={() => {}} onSubmit={() => {}} />)
  await user.click(screen.getByRole('combobox'))
  expect(await screen.findByText('暂无可选等级。等级在「等级管理」页的等级配置中维护')).toBeInTheDocument()
})

it('enforces requiredWhen against the current form values', async () => {
  const user = userEvent.setup()
  const branchAdmin = render(<MutationDialog open title="设置角色" description="" fields={[
    { name: 'roleKey', label: '角色', kind: 'select', options: [{ value: 'BRANCH_ADMIN', label: '服务器管理员' }] },
    { name: 'scopeId', label: '管理范围', kind: 'select', requiredWhen: { path: 'roleKey', values: ['BRANCH_ADMIN'] }, options: [] },
  ]} values={{ roleKey: 'BRANCH_ADMIN', scopeId: '' }} onCancel={() => {}} onSubmit={() => {}} />)
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  expect(await screen.findByText('请选择管理范围')).toBeInTheDocument()
  branchAdmin.unmount()

  const submitted = vi.fn()
  render(<MutationDialog open title="设置角色" description="" fields={[
    { name: 'roleKey', label: '角色', kind: 'select', options: [{ value: 'PLATFORM_OPERATIONS', label: '平台运营' }] },
    { name: 'scopeId', label: '管理范围', kind: 'select', requiredWhen: { path: 'roleKey', values: ['BRANCH_ADMIN'] }, options: [] },
  ]} values={{ roleKey: 'PLATFORM_OPERATIONS', scopeId: '' }} onCancel={() => {}} onSubmit={submitted} />)
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  await waitFor(() => expect(submitted).toHaveBeenCalled())
  expect(screen.queryByText('请选择管理范围')).not.toBeInTheDocument()
})
