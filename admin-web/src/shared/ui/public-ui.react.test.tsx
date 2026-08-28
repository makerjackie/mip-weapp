import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './feedback-states'
import { FilterBar } from './filter-bar'
import { StatusTag } from './status-tag'

describe('shared admin UI', () => {
  it('keeps status meaning in visible text', () => {
    render(<StatusTag value="已发布" />)
    expect(screen.getByText('已发布')).toBeVisible()
  })

  it('renders a factual empty state', () => {
    render(<EmptyState title="暂无订单" description="当前筛选条件下没有订单。" />)
    expect(screen.getByText('暂无订单')).toBeVisible()
    expect(screen.getByText('当前筛选条件下没有订单。')).toBeVisible()
  })

  it('submits search and status as one filter value', async () => {
    const onChange = vi.fn()
    render(
      <FilterBar
        value={{ q: '', status: '' }}
        placeholder="搜索姓名"
        statusOptions={[{ value: '', label: '全部状态' }, { value: 'ACTIVE', label: '启用' }]}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText('搜索姓名'), '林晓')
    await userEvent.click(screen.getByRole('button', { name: /筛\s*选/ }))
    expect(onChange).toHaveBeenCalledWith({ q: '林晓', status: '' })
  })
})
