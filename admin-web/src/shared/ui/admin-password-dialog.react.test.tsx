import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../../app/session-provider'
import { AdminApiClient } from '../../services/admin-api'
import { AdminPasswordDialog } from './admin-password-dialog'

afterEach(cleanup)

function setup(configured: boolean, recentWechatAuth: boolean, demoMode = false) {
  const client = new AdminApiClient()
  if (demoMode) Object.defineProperty(client, 'demoMode', { value: true })
  vi.spyOn(client, 'getSession').mockResolvedValue({ enabled: true, actor: { id: 'actor-test', name: '测试运营账号' }, capabilities: [] })
  const status = vi.spyOn(client, 'getPasswordStatus').mockResolvedValue({ configured, recentWechatAuth, maskedPhone: '138****0000' })
  const save = vi.spyOn(client, 'setPassword').mockResolvedValue({ configured: true, requiresLogin: false })
  render(<QueryClientProvider client={new QueryClient()}><ConfigProvider theme={{ token: { motion: false } }}><SessionProvider client={client}>
    <AdminPasswordDialog onClose={vi.fn()} onRequireLogin={vi.fn()} />
  </SessionProvider></ConfigProvider></QueryClientProvider>)
  return { status, save }
}

describe('password settings', () => {
  it('requires the existing password outside the recent WeChat verification window', async () => {
    const { save } = setup(true, false)
    await screen.findByLabelText('当前密码')
    await userEvent.type(screen.getByLabelText('新密码'), 'fictional-new-password')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'fictional-new-password')
    await userEvent.click(screen.getByRole('button', { name: '保存密码' }))
    await screen.findByText('请输入当前密码')
    expect(save).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('当前密码'), 'fictional-current-password')
    await userEvent.click(screen.getByRole('button', { name: '保存密码' }))
    await screen.findByText('登录密码已更新')
    expect(save).toHaveBeenCalledWith('fictional-new-password', 'fictional-current-password')
    await waitFor(() => expect(screen.getByLabelText('新密码')).toHaveValue(''))
  })

  it('allows a recently WeChat-verified session to set a password without an old password', async () => {
    const { save } = setup(false, true)
    await screen.findByLabelText('新密码')
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('新密码'), 'fictional-new-password')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'fictional-new-password')
    await userEvent.click(screen.getByRole('button', { name: '保存密码' }))
    await screen.findByText('登录密码已更新')
    expect(save).toHaveBeenCalledWith('fictional-new-password', undefined)
  })

  it('does not fetch or submit password changes in demo mode', async () => {
    const { status, save } = setup(false, false, true)
    await screen.findByText('演示模式不能修改登录密码')
    expect(screen.queryByRole('button', { name: '保存密码' })).not.toBeInTheDocument()
    expect(status).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
