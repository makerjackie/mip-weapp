import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Form, Modal, Space } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import { profileCardFromUser, profileFormValues, profileCardsModule, type EditableProfileFields, type ProfileCard } from '../../modules/admin-profile-cards'
import { rebaseEdit } from '../../modules/edit-conflict'
import { ProfileFields } from './profile-fields'

export function ProfileEditorDialog({ item, onClose, onSaved }: { item: ProfileCard | null; onClose: () => void; onSaved?: () => void }) {
  return item ? <ProfileEditorForm key={item.id} item={item} onClose={onClose} onSaved={onSaved} /> : null
}
function ProfileEditorForm({ item, onClose, onSaved }: { item: ProfileCard; onClose: () => void; onSaved?: () => void }) {
  const { request } = useAdminSession()
  const api = useMemo(() => profileCardsModule(request), [request])
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<EditableProfileFields>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<{ latest: ProfileCard; local: EditableProfileFields } | null>(null)
  const baseline = useRef<ProfileCard>(item)
  const submitting = useRef(false)
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    form.setFieldsValue(profileFormValues(baseline.current))
    return () => { mounted.current = false }
  }, [form])
  const submit = async () => {
    if (submitting.current || conflict) return
    submitting.current = true
    const current = baseline.current
    try {
      const fields = await form.validateFields()
      if (!mounted.current) return
      const payload = JSON.stringify({ id: current.id, version: current.profileVersion, fields })
      if (submission.current?.payload !== payload) submission.current = { payload, key: `web-profile-${crypto.randomUUID()}` }
      setSaving(true); setError('')
      try { await api.saveProfile(current, fields, submission.current.key) }
      catch (reason) {
        if (reason && typeof reason === 'object' && 'code' in reason && ['CONFLICT', 'VERSION_CONFLICT'].includes(String(reason.code))) {
          const latest = profileCardFromUser(await request('mip.admin.users.get', { userId: current.id }))
          if (mounted.current) setConflict({ latest, local: fields })
        }
        throw reason
      }
      if (!mounted.current) return
      await queryClient.invalidateQueries()
      void message.success('资料已保存'); onSaved?.(); onClose()
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '保存失败，输入已保留。')
    } finally { if (mounted.current) setSaving(false); submitting.current = false }
  }
  const resolve = (local: boolean) => {
    if (!conflict) return
    const fields = local ? rebaseEdit(profileFormValues(baseline.current), conflict.local, profileFormValues(conflict.latest)) : profileFormValues(conflict.latest)
    baseline.current = conflict.latest
    submission.current = null
    form.resetFields(); form.setFieldsValue(fields)
    setConflict(null); setError('已读取最新版本，请核对后保存。')
  }
  return <Modal title="编辑名片资料" centered open={Boolean(item)} onCancel={() => { if (!saving) onClose() }} onOk={() => void submit()}
    confirmLoading={saving} okButtonProps={{ disabled: Boolean(conflict) }} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}
    styles={{ body: { maxHeight: 'calc(100dvh - 200px)', overflowY: 'auto', paddingRight: 4 } }}>
    {error ? <Alert type={conflict ? 'warning' : 'error'} showIcon title={error} /> : null}
    {conflict ? <Space wrap><Button onClick={() => resolve(true)}>保留我的修改并核对</Button><Button onClick={() => resolve(false)}>采用服务端最新内容</Button></Space> : null}
    <Form form={form} layout="vertical" disabled={saving || Boolean(conflict)}><ProfileFields disabled={saving || Boolean(conflict)} /></Form>
  </Modal>
}
