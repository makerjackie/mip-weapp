import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Tag } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { loadRoleTemplates, roleTemplateLabels, type RoleTemplate, type RoleTemplateCatalog } from '../../modules/admin-role-templates'
import { capabilityLabels } from '../../modules/admin-read-formatters'
import type { AdminOperationAction } from '../../domain/contracts'
import { humanizeError } from '../../shared/ui'
import { rebaseEdit } from '../../modules/edit-conflict'

export function RoleTemplatesPanel() {
  const { request, sessionBoundary, demoMode, hasCapability, hasCapabilityAtScope } = useAdminSession()
  const canRead = hasCapability('roles.change'), canEdit = hasCapabilityAtScope('roles.change', 'PLATFORM')
  const query = useQuery({ queryKey: ['admin', sessionBoundary, 'role-templates'], queryFn: () => loadRoleTemplates(request), enabled: canRead && !demoMode })
  const [editing, setEditing] = useState<{ item: RoleTemplate | null; copy: boolean } | null>(null)
  if (!canRead || demoMode) return null
  return <Card title="岗位模板" className="admin-content-card" extra={canEdit ? <Button disabled={!query.data} onClick={() => setEditing({ item: null, copy: false })}>新增岗位</Button> : null}>
    {query.error ? <Alert type="error" title={humanizeError(query.error)} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
    {query.data && !query.data.bindingWritesEnabled ? <Alert type="info" title="岗位可维护，账号绑定暂未开放" style={{ marginBottom: 16 }} /> : null}
    <div className="table-scroll"><Table rowKey="id" loading={query.isPending} dataSource={query.data?.items || []} pagination={false} scroll={{ x: 720 }} columns={[
      { title: '岗位名称', dataIndex: 'name' }, { title: '基础权限类型', dataIndex: 'baseRoleKey', render: value => roleTemplateLabels[value] },
      { title: '权限数量', render: (_, item) => item.capabilities.length }, { title: '关联账号', dataIndex: 'bindingCount' },
      { title: '状态', render: (_, item) => <Tag color={item.status === 'ACTIVE' ? 'green' : 'default'}>{item.status === 'ACTIVE' ? '启用' : '停用'}</Tag> },
      { title: '操作', render: (_, item) => canEdit ? <Space wrap><Button onClick={() => setEditing({ item, copy: false })}>编辑</Button><Button onClick={() => setEditing({ item, copy: true })}>复制</Button></Space> : '只读' },
    ]} /></div>
    {editing && query.data ? <TemplateEditor key={`${editing.item?.id || 'new'}-${editing.copy}`} item={editing.item} copy={editing.copy} catalog={query.data} onClose={() => setEditing(null)} /> : null}
  </Card>
}
function TemplateEditor({ item, copy, catalog, onClose }: { item: RoleTemplate | null; copy: boolean; catalog: RoleTemplateCatalog; onClose: () => void }) {
  const { request } = useAdminSession(), client = useQueryClient(), { message } = App.useApp()
  const [form] = Form.useForm()
  const role = Form.useWatch('baseRoleKey', form) || item?.baseRoleKey || catalog.baseRoles[0]?.key
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const submission = useRef<{ payload: string; key: string } | null>(null), submitting = useRef(false), mounted = useRef(true)
  const [baseline, setBaseline] = useState(item)
  const [conflict, setConflict] = useState<{ latest: RoleTemplate; local: Record<string, unknown> } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async (statusOnly = false) => {
    if (submitting.current || conflict) return
    submitting.current = true; setSaving(true)
    try {
      const values = await form.validateFields()
      if (!mounted.current) return
      const action: AdminOperationAction = statusOnly ? 'mip.admin.roles.changeStatus' : item ? copy ? 'mip.admin.roles.copy' : 'mip.admin.roles.update' : 'mip.admin.roles.create'
      const input = { reason: values.reason, ...(baseline ? { templateId: baseline.id, expectedVersion: baseline.version } : {}),
        ...(statusOnly ? { status: baseline?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : { name: values.name, description: values.description || '', baseRoleKey: values.baseRoleKey, capabilities: values.capabilities || [] }) }
      const payload = JSON.stringify([action, input])
      const next = submission.current?.payload === payload ? submission.current : { payload, key: `web-role-template-${crypto.randomUUID()}` }
      submission.current = next; setError('')
      await request(action, { ...input, idempotencyKey: next.key })
      if (!mounted.current) return
      await client.invalidateQueries(); void message.success('岗位模板已保存'); onClose()
    } catch (reason) {
      if (!mounted.current) return
      setError(humanizeError(reason))
      if (baseline && reason && typeof reason === 'object' && 'code' in reason && reason.code === 'CONFLICT') {
        try {
          const latest = (await loadRoleTemplates(request)).items.find(role => role.id === baseline.id)
          if (mounted.current && latest) setConflict({ latest, local: form.getFieldsValue(true) })
        } catch { if (mounted.current) setError('最新岗位暂时无法读取，输入已保留，请稍后重试。') }
      }
    } finally { submitting.current = false; if (mounted.current) setSaving(false) }
  }
  return <Modal title={item ? copy ? '复制岗位' : '编辑岗位' : '新增岗位'} okText="保存" cancelText="取消" open centered onCancel={() => { if (!saving) onClose() }} confirmLoading={saving} onOk={() => void submit()}
    cancelButtonProps={{ disabled: saving }} okButtonProps={{ disabled: Boolean(conflict) }} closable={!saving} mask={{ closable: !saving }} styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } }}>
    {error ? <Alert type="error" title={error} description="输入已保留；记录冲突时请先核对岗位的最新配置。" /> : null}
    {conflict && baseline ? <Space wrap><Button onClick={() => {
      form.setFieldsValue(rebaseEdit({ ...baseline }, conflict.local, { ...conflict.latest })); setBaseline(conflict.latest); setConflict(null); submission.current = null
    }}>保留我的修改并核对</Button><Button onClick={() => { form.setFieldsValue(conflict.latest); setBaseline(conflict.latest); setConflict(null); submission.current = null }}>采用最新配置</Button></Space> : null}
    <Form form={form} layout="vertical" disabled={saving || Boolean(conflict)} initialValues={{ name: copy ? `${item?.name}（副本）` : item?.name || '', description: item?.description || '', baseRoleKey: item?.baseRoleKey || role, capabilities: item?.capabilities || [] }}>
      <Form.Item name="name" label="岗位名称" rules={[{ required: true }, { max: 128 }]}><Input /></Form.Item>
      <Form.Item name="description" label="说明"><Input.TextArea maxLength={500} /></Form.Item>
      <Form.Item name="reason" label="变更原因" rules={[{ required: true, message: '请填写本次变更原因' }, { max: 300 }]}><Input.TextArea maxLength={300} /></Form.Item>
      <Form.Item name="baseRoleKey" label="基础权限类型"><Select disabled={Boolean(item)} options={catalog.baseRoles.map(base => ({ value: base.key, label: roleTemplateLabels[base.key] }))} onChange={() => form.setFieldValue('capabilities', [])} /></Form.Item>
      <Form.Item name="capabilities" label="菜单与操作权限"><Checkbox.Group className="capability-grid" options={(catalog.baseRoles.find(base => base.key === role)?.allowedCapabilities || []).map(value => ({ value, label: capabilityLabels[value] || value }))} /></Form.Item>
    </Form>
    {baseline && !copy ? <Button danger={baseline.status === 'ACTIVE'} disabled={saving || Boolean(conflict)} onClick={() => void submit(true)}>{baseline.status === 'ACTIVE' ? '停用岗位（关联权限立即失效）' : '启用岗位'}</Button> : null}
  </Modal>
}
