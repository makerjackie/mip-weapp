import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminEventMutationDefinition, buildEventMutationInput } from '../../modules/admin-event-mutation-forms'
import { normalizeOperationValues } from '../../modules/admin-operation-ui'
import { MutationDialog } from '../../shared/ui/mutation-dialog'
import { DetailDrawer } from '../../shared/ui/detail-drawer'
import { createOperationModel } from './operation-model'
const session = vi.hoisted(() => ({ request: async () => ({ items: [], nextCursor: null }) }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => session, useOptionalSession: () => null }))

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
  })
  it('submits entered event content and converts the date controls into the server draft', async () => {
    const definition = createAdminEventMutationDefinition('mip.admin.events.save', '')
    const values = {
      ...definition.values,
      // 活动介绍是所见即所得编辑器（TipTap contenteditable），无法用 fireEvent.change 注入；
      // 这里以预置值验证「提交管线」，编辑器自身行为由 rich-text-area.react.test.tsx 覆盖。
      description: '一起交流产品想法',
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
      ['活动名称', '活动全流程验证'],
      ['场地地址文案', '交流室'], ['城市', '深圳'],
    ]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
    expect(submitted.mock.calls[0]?.[0]).toMatchObject({ draft: {
      // 摘要已从表单隐藏：留空时由活动介绍自动截取。
      title: '活动全流程验证', summary: '一起交流产品想法', description: '一起交流产品想法',
      venueName: '交流室', cityName: '深圳', capacity: 20, accessType: 'FREE',
      startsAt: '2030-09-20T02:00:00.000Z', endsAt: '2030-09-20T04:00:00.000Z',
      // 报名字段编辑入口已下线：预置的已有配置必须原样保留提交，不被清空
      registrationSchema: values.registrationSchema,
    } })
  })

  it('keeps the stored registration schema when the editor entry is removed', async () => {
    const definition = createAdminEventMutationDefinition('mip.admin.events.save', '')
    const stored = [{ key: 'role', label: '参与身份', type: 'TEXT', required: true }]
    const values = { ...definition.values, title: '活动', summary: '摘要', description: '介绍', startsAt: '2030-09-20T10:00:00+08:00', endsAt: '2030-09-20T12:00:00+08:00', venueName: '交流室', registrationSchema: stored }
    const submitted = vi.fn()
    render(<MutationDialog open title="创建活动" description="" fields={definition.fields}
      values={values} onCancel={() => {}} onSubmit={(form) => submitted(normalizeOperationValues(definition.fields, form, values))} />)
    // 编辑入口已下线：表单上不再出现「添加报名字段」，也看不到编辑器
    expect(screen.queryByRole('button', { name: '添加报名字段' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => {
      const errors = [...document.querySelectorAll('.ant-form-item-explain-error')].map(e => e.textContent)
      if (errors.length) throw new Error(`表单校验未通过: ${errors.join(' | ')}`)
      expect(submitted).toHaveBeenCalledTimes(1)
    })
    expect(submitted.mock.calls[0]?.[0].registrationSchema).toEqual(stored)
  })
})
