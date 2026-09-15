import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminEventMutationDefinition, buildEventMutationInput } from '../../modules/admin-event-mutation-forms'
import { normalizeOperationValues } from '../../modules/admin-operation-ui'
import { MutationDialog } from '../../shared/ui/mutation-dialog'
import { DetailDrawer } from '../../shared/ui/detail-drawer'
import { createOperationModel } from './operation-model'

afterEach(cleanup)

describe('event form submission through the actual dialog', () => {
  it('keeps a mutation dialog above an open detail Drawer', async () => {
    render(<>
      <DetailDrawer open view={{ route: 'events', title: '活动', subtitle: '', status: '草稿', sections: [] }} onClose={() => {}} />
      <MutationDialog open title="发布活动" description="" fields={[]}
        values={{}} onCancel={() => {}} onSubmit={() => {}} />
    </>)
    const drawer = document.querySelector('.ant-drawer')
    const modal = document.querySelector('.ant-modal-wrap')
    expect(drawer).toBeTruthy()
    expect(modal).toBeTruthy()
    expect(Number((modal as HTMLElement).style.zIndex)).toBeGreaterThan(Number((drawer as HTMLElement).style.zIndex))
    expect(screen.getByRole('button', { name: '确认提交' })).toBeEnabled()
  })
  it('preserves the authoritative version when the publish dialog has no visible fields', async () => {
    const model = await createOperationModel('mip.admin.events.changeStatus', 'event-1', {
      route: 'events', title: '活动', subtitle: '', status: 'DRAFT',
      sections: [{ title: '活动信息', fields: [{ label: '版本', value: '4' }] }],
    }, { targetStatus: 'PUBLISHED' }, async <T,>() => ({} as T))
    const submitted = vi.fn()
    render(<MutationDialog open title={model.title} description="" fields={model.fields}
      values={model.values} onCancel={() => {}} onSubmit={(form) => {
        submitted(model.buildInput(normalizeOperationValues(model.fields, form, model.values)))
      }} />)
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(submitted).toHaveBeenCalledWith({ eventId: 'event-1', expectedVersion: 4, status: 'PUBLISHED' }))
  })
  it('shows required field errors without submitting an empty event', async () => {
    const definition = createAdminEventMutationDefinition('mip.admin.events.save', '')
    const submitted = vi.fn()
    render(<MutationDialog open title="创建活动" description="" fields={definition.fields}
      values={definition.values} onCancel={() => {}} onSubmit={submitted} />)
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await screen.findByText('请填写活动名称')
    expect(submitted).not.toHaveBeenCalled()
  }, 15000)
  it('submits entered event content and converts the date controls into the server draft', async () => {
    const definition = createAdminEventMutationDefinition('mip.admin.events.save', '')
    const values = {
      ...definition.values,
      startsAt: '2030-09-20T10:00:00+08:00',
      endsAt: '2030-09-20T12:00:00+08:00',
      capacity: 20,
      registrationSchema: [{ key: 'role', label: '参与身份', type: 'TEXT', required: true }],
    }
    const submitted = vi.fn()
    render(<MutationDialog open title="创建活动" description="" fields={definition.fields}
      values={values} onCancel={() => {}} onSubmit={(form) => {
        const normalized = normalizeOperationValues(definition.fields, form, values)
        submitted(buildEventMutationInput('mip.admin.events.save', normalized))
      }} />)
    for (const [label, value] of [
      ['活动名称', '活动全流程验证'], ['活动摘要', '现场交流'], ['活动介绍', '一起交流产品想法'],
      ['活动地点', '交流室'], ['城市', '深圳'],
    ]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
    expect(submitted.mock.calls[0]?.[0]).toMatchObject({ draft: {
      title: '活动全流程验证', summary: '现场交流', description: '一起交流产品想法',
      venueName: '交流室', cityName: '深圳', capacity: 20, accessType: 'FREE',
      startsAt: '2030-09-20T02:00:00.000Z', endsAt: '2030-09-20T04:00:00.000Z',
      registrationSchema: [{ ...values.registrationSchema[0], maxLength: 120 }],
    } })
  }, 15000)

  it('edits registration fields without exposing raw JSON', async () => {
    const definition = createAdminEventMutationDefinition('mip.admin.events.save', '')
    const values = { ...definition.values, title: '活动全流程验证', summary: '现场交流', description: '一起交流产品想法', venueName: '交流室', cityName: '深圳', startsAt: '2030-09-20T10:00:00+08:00', endsAt: '2030-09-20T12:00:00+08:00' }
    const submitted = vi.fn()
    render(<MutationDialog open title="创建活动" description="" fields={definition.fields}
      values={values} onCancel={() => {}} onSubmit={(form) => submitted(normalizeOperationValues(definition.fields, form, values))} />)
    fireEvent.click(screen.getByRole('button', { name: '添加报名字段' }))
    fireEvent.change(screen.getByLabelText('字段 1 名称'), { target: { value: '参与身份' } })
    fireEvent.mouseDown(screen.getByLabelText('字段 1 类型'))
    fireEvent.click(await screen.findByText('单选', { selector: '.ant-select-item-option-content' }))
    await userEvent.type(screen.getByLabelText('字段 1 选项'), '成员,嘉宾')
    fireEvent.click(screen.getByRole('checkbox', { name: '必填' }))
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
    expect(submitted.mock.calls[0]?.[0].registrationSchema).toEqual([
      { key: expect.stringMatching(/^field_[a-f0-9]{32}$/), label: '参与身份', type: 'SELECT', required: true, options: ['成员', '嘉宾'] },
    ])
  }, 15000)
})
