import { Alert, Button, Form, Input, Modal, Space, Tabs, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'

export function AdminLoginDialog({ onClose, notice }: { onClose: () => void; notice?: string }) {
  const { challenge, loginError, loginConfirmed, demoMode, beginLogin, loginWithPassword, retryConfirmedLogin, closeLogin } = useAdminSession()
  const [mode, setMode] = useState('password')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ phone: string; password: string }>()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; closeLogin() }
  }, [closeLogin])

  const changeMode = (next: string) => {
    closeLogin()
    form.resetFields(['password'])
    setMode(next)
    if (next === 'wechat') void beginLogin()
  }
  const submit = async ({ phone, password }: { phone: string; password: string }) => {
    if (submitting || demoMode) return
    setSubmitting(true)
    await loginWithPassword(phone.trim(), password)
    if (alive.current) {
      form.resetFields(['password'])
      setSubmitting(false)
    }
  }

  return <Modal open title="运营登录" footer={null} onCancel={onClose} destroyOnHidden>
    {notice ? <Alert type="success" showIcon title={notice} style={{ marginBottom: 16 }} /> : null}
    <Tabs activeKey={mode} onChange={changeMode} items={[
      { key: 'password', label: '手机号密码登录', disabled: submitting },
      { key: 'wechat', label: '小程序登录', disabled: submitting },
    ]} />
    {mode === 'password' ? <>
      <Typography.Paragraph type="secondary">使用已绑定的手机号和登录密码。首次登录或忘记密码，请使用小程序登录后在账号菜单设置。</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={values => void submit(values)} disabled={submitting || demoMode} preserve={false}>
        <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]}>
          <Input type="tel" inputMode="tel" autoComplete="username" maxLength={32} placeholder="请输入已绑定的手机号" />
        </Form.Item>
        <Form.Item name="password" label="登录密码" rules={[{ required: true, message: '请输入登录密码' }]}>
          <Input.Password autoComplete="current-password" maxLength={128} />
        </Form.Item>
        {loginError ? <Alert type="error" showIcon title={loginError} style={{ marginBottom: 16 }} /> : null}
        {loginConfirmed
          ? <Button block onClick={() => void retryConfirmedLogin()}>重新加载会话</Button>
          : <Button type="primary" htmlType="submit" block loading={submitting}>登录</Button>}
      </Form>
    </> : <>
      <Typography.Paragraph>打开 MIP 小程序，进入“我的 → 现场工作台 → 确认网页登录”，输入下方 6 位登录码并确认。</Typography.Paragraph>
      <Typography.Paragraph type="secondary">可使用已获得访问权限的开发版或体验版，请登录具有运营权限的账号。</Typography.Paragraph>
      {challenge ? <div className="login-challenge" aria-live="polite">
        <small>登录码</small><strong aria-label={`登录码 ${challenge.code}`}>{challenge.code}</strong>
        <small>有效期至 {new Date(challenge.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}</small>
        <span>等待小程序确认，完成后网页将自动登录</span>
      </div> : loginError ? <Space orientation="vertical">
        <Typography.Text type="danger">{loginError}</Typography.Text>
        <Button onClick={() => void (loginConfirmed ? retryConfirmedLogin() : beginLogin())}>{loginConfirmed ? '重新加载会话' : '重新获取登录请求'}</Button>
      </Space> : <Typography.Text type="secondary" role="status">{loginConfirmed ? '登录已确认，正在加载运营会话…' : '正在获取登录码…'}</Typography.Text>}
    </>}
  </Modal>
}
