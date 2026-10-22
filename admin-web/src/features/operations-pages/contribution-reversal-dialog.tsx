import { useMemo, useState } from 'react'
import { Alert, Form, Input, InputNumber, Modal } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { contributionManagement } from '../../modules/contribution-management'
import type { AdminTableRow } from '../../modules/admin-read-pages'

export function ContributionReversalDialog({ row, onClose, onSaved }: { row: AdminTableRow; onClose: () => void; onSaved: () => void }) {
  const session = useAdminSession()
  const api = useMemo(() => contributionManagement(session.request), [session.request])
  const [form] = Form.useForm<{ reversalValue: number; reason: string }>()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const maximum = Number(row.reversibleValue)
  const submit = async () => {
    if (pending || session.demoMode || !session.hasCapabilityAtScope('growth.adjust', 'PLATFORM')) return
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setPending(true); setError('')
    try { await api.reverse(String(row.txnNo), values.reversalValue, values.reason, idempotencyKey); onSaved(); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '冲正失败') }
    finally { setPending(false) }
  }
  return <Modal open title="冲正贡献值" okText="确认冲正" cancelText="取消" confirmLoading={pending} onOk={() => void submit()} onCancel={() => { if (!pending) onClose() }} mask={{ closable: !pending }}>
    <Alert type="warning" showIcon title={`为「${String(row.user)}」扣回错误贡献值`} description={`本条流水剩余可冲正 ${maximum}；服务端还会核对当前余额。原流水保留，另记冲正流水。`} style={{ marginBottom: 16 }} />
    <Form form={form} layout="vertical">
      <Form.Item name="reversalValue" label="冲正贡献值" rules={[{ required: true }]}><InputNumber min={1} max={maximum} precision={0} /></Form.Item>
      <Form.Item name="reason" label="冲正原因" rules={[{ required: true, whitespace: true, max: 300 }]}><Input.TextArea rows={3} maxLength={300} /></Form.Item>
      {error ? <Alert type="error" title={error} description="结果不确定时，请先刷新并核对服务端记录。" /> : null}
    </Form>
  </Modal>
}
