import { Alert, Button, Form, Input, Modal, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminPasswordStatus } from '../../services/admin-api'

interface PasswordValues { password: string; confirmPassword: string; currentPassword?: string }

export function AdminPasswordDialog({ onClose, onRequireLogin }: { onClose: () => void; onRequireLogin: () => void }) {
  const { client, demoMode, requireLogin } = useAdminSession()
  const [status, setStatus] = useState<AdminPasswordStatus | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [revision, setRevision] = useState(0)
  const [form] = Form.useForm<PasswordValues>()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    if (demoMode) return
    void client.getPasswordStatus().then(value => { if (current) setStatus(value) })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : '密码设置暂时不可用') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [client, demoMode, revision])
  const retry = () => { setLoading(true); setError(''); setRevision(value => value + 1) }
  const submit = async (values: PasswordValues) => {
    if (demoMode || submitting || !status) return
    setSubmitting(true)
    setError('')
    setSuccess(false)
    try {
      const result = await client.setPassword(values.password, status.configured && !status.recentWechatAuth ? values.currentPassword : undefined)
      if (alive.current) {
        if (result.requiresLogin) {
          form.resetFields()
          requireLogin()
          onRequireLogin()
        }
        else { setSuccess(true); retry() }
      }
    }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '密码未保存，请重试') }
    finally { if (alive.current) { form.resetFields(); setSubmitting(false) } }
  }
  const needsReauth = status && !status.configured && !status.recentWechatAuth

  return <Modal open title={status?.configured ? '修改登录密码' : '设置登录密码'} footer={null} onCancel={onClose} destroyOnHidden>
    {demoMode ? <Alert type="info" title="演示模式不能修改登录密码" /> : <>
      {success ? <Alert type="success" showIcon title="登录密码已更新" style={{ marginBottom: 16 }} /> : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {loading ? <Spin tip="正在读取密码设置"><div style={{ minHeight: 80 }} /></Spin> : !status ? <Button onClick={retry}>重试</Button> : <>
        <Typography.Paragraph>登录手机号：{status.maskedPhone || '尚未绑定手机号'}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">设置 10–128 个字符的密码。忘记当前密码时，退出后使用小程序重新登录，再回来设置。</Typography.Paragraph>
        {needsReauth ? <Alert type="info" title="首次设置需要近期小程序验证，请退出后使用小程序重新登录" /> : <Form form={form} layout="vertical" preserve={false} onFinish={values => void submit(values)} disabled={submitting}>
          {status.configured && !status.recentWechatAuth ? <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" maxLength={128} /></Form.Item> : null}
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 10, max: 128, message: '密码长度需为 10–128 个字符' }]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={['password']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) } })]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>保存密码</Button>
        </Form>}
      </>}
    </>}
  </Modal>
}
