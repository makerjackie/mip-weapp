import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
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
