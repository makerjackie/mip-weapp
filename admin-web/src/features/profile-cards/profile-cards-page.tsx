import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Alert, App, Avatar, Button, Card, Checkbox, Drawer, Empty, Form, Image, Input, InputNumber, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { cardHistoryFields, cardRequiredFields, cardTemplatePreviews, profileCardsModule, type CardTemplate, type ProfileCard } from '../../modules/admin-profile-cards'

export function ProfileCardsPage() {
  const session = useAdminSession()
  const api = useMemo(() => profileCardsModule(session.request), [session.request])
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const search = useRouterState({ select: state => state.location.search as { tab?: string; q?: string; cursor?: string } })
  const tab = search.tab === 'templates' ? 'templates' : 'profiles'
  const [editing, setEditing] = useState<CardTemplate | null>(null)
  const [moderating, setModerating] = useState<ProfileCard | null>(null)
  const [history, setHistory] = useState<ProfileCard | null>(null)
  const [historyCursor, setHistoryCursor] = useState<string | undefined>()
  const [reason, setReason] = useState('')
  const [form] = Form.useForm()
  const enabled = Boolean(session.session?.enabled) && session.hasCapabilityAtScope('users.read', 'PLATFORM') && !session.demoMode
  const writable = enabled && session.hasCapabilityAtScope('users.fields.edit', 'PLATFORM')
  const key = ['admin', 'profile-cards', session.session?.actor?.id, session.sessionBoundary]
  const cards = useQuery({ queryKey: [...key, tab, search.q, search.cursor], enabled,
    queryFn: () => api.list(search.q || '', search.cursor) })
  const templates = useQuery({ queryKey: [...key, 'templates'], enabled, queryFn: api.templates })
  const versions = useQuery({ queryKey: [...key, 'history', history?.id, historyCursor], enabled: enabled && Boolean(history), queryFn: () => api.history(history!.id, historyCursor) })
  const mutation = useMutation({ mutationFn: (operation: () => Promise<unknown>) => operation(), onSuccess: async () => {
    setEditing(null); setModerating(null)
    await queryClient.invalidateQueries({ queryKey: key })
    void message.success('已保存')
  }, onError: error => { void message.error(error instanceof Error ? error.message : '操作失败，请重试') } })
  const requestKey = () => `web-cards-${crypto.randomUUID()}`
  const update = (values: typeof search) => void navigate({ to: '/cards', search: values })
  if (!enabled) return <Alert type="info" showIcon title="请使用具有平台用户查看权限的账号登录" />
  const error = cards.error || templates.error
  return <section style={{ minWidth: 0 }}>
    <Typography.Title level={2}>名片管理</Typography.Title>
    <Tabs activeKey={tab} onChange={next => update({ tab: next })} items={[{ key: 'profiles', label: '用户名片' }, { key: 'templates', label: '名片模板' }]} />
    {error && <Alert type="error" showIcon title={error.message} action={<Button onClick={() => { void cards.refetch(); void templates.refetch() }}>重试</Button>} />}
    {tab === 'profiles' ? <>
      <Input.Search key={search.q} defaultValue={search.q} placeholder="搜索姓名或昵称" onSearch={q => update({ tab, q })} style={{ maxWidth: 360, marginBottom: 16 }} allowClear />
      {cards.isPending ? <Spin /> : !cards.data?.items.length ? <Empty description="暂无名片" /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
        {cards.data.items.map(item => <Card key={item.id} title={<Space><Avatar src={/^https:\/\//.test(item.avatarUrl) ? item.avatarUrl : undefined}>{item.name.slice(0, 1)}</Avatar><span>{item.name}</span></Space>}>
          <Tag color={item.status === 'ACTIVE' ? 'success' : 'error'}>{item.status === 'ACTIVE' ? '正常' : '已下架'}</Tag>
          <Typography.Paragraph>{item.headline || '未填写职位简介'}</Typography.Paragraph>
          <Typography.Paragraph>{item.companies.map(company => [company.name, company.role].filter(Boolean).join(' · ')).join(' / ') || '未填写公司'}</Typography.Paragraph>
          {item.identityStatus && <Typography.Paragraph>{item.identityStatus}</Typography.Paragraph>}
          {item.reason && <Alert type="warning" title={item.reason} />}
          <Space wrap style={{ marginTop: 12 }}>
            <Button onClick={() => { setHistory(item); setHistoryCursor(undefined) }}>修改记录</Button>
            {writable && <Button danger={item.status === 'ACTIVE'} disabled={mutation.isPending} onClick={() => { setModerating(item); setReason('') }}>{item.status === 'ACTIVE' ? '下架' : '恢复'}</Button>}
          </Space>
        </Card>)}
      </div>}
      <Space style={{ marginTop: 16 }}><Button disabled={!search.cursor} onClick={() => update({ tab, q: search.q })}>返回第一页</Button><Button disabled={!cards.data?.nextCursor} onClick={() => update({ ...search, cursor: cards.data?.nextCursor || undefined })}>下一页</Button></Space>
    </> : templates.isPending ? <Spin /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16 }}>
      {templates.data?.items.map(item => <Card key={item.id} title={item.name}>
        <Image src={cardTemplatePreviews[item.id]} alt={item.name} width="100%" />
        <p><Tag>{item.status === 'ACTIVE' ? '启用' : '停用'}</Tag>排序：{item.sortOrder}</p>
        <p>必填：{item.requiredFields.map(field => cardRequiredFields.find(option => option.value === field)?.label).join('、') || '无'}</p>
        {writable && <Space><Button onClick={() => { setEditing(item); form.setFieldsValue(item) }}>编辑</Button><Button loading={mutation.isPending} onClick={() => { const key = requestKey(); mutation.mutate(() => api.setTemplateStatus(item, key)) }}>{item.status === 'ACTIVE' ? '停用' : '启用'}</Button></Space>}
      </Card>)}
    </div>}
    <Modal title="编辑名片模板" open={Boolean(editing)} onCancel={() => setEditing(null)} confirmLoading={mutation.isPending} onOk={() => void form.validateFields().then(values => { if (editing) { const key = requestKey(); mutation.mutate(() => api.saveTemplate(editing, values, key)) } })}>
      <Form form={form} layout="vertical"><Form.Item name="name" label="名称" rules={[{ required: true }, { max: 60 }]}><Input /></Form.Item><Form.Item name="sortOrder" label="排序（小的在前）" rules={[{ required: true }]}><InputNumber min={0} max={9999} precision={0} /></Form.Item><Form.Item name="requiredFields" label="生成名片必填项"><Checkbox.Group options={cardRequiredFields} /></Form.Item></Form>
    </Modal>
    <Modal title={moderating?.status === 'TAKEN_DOWN' ? '恢复名片' : '下架名片'} open={Boolean(moderating)} onCancel={() => setModerating(null)} confirmLoading={mutation.isPending} okButtonProps={{ disabled: moderating?.status === 'ACTIVE' && !reason.trim() }} onOk={() => { if (moderating) { const key = requestKey(); mutation.mutate(() => api.moderate(moderating, reason.trim(), key)) } }}>
      {moderating?.status === 'ACTIVE' ? <Input.TextArea aria-label="下架原因" value={reason} onChange={event => setReason(event.target.value)} placeholder="请填写原因，用户可见" maxLength={500} /> : <p>恢复后，用户可重新生成名片并通过名片码访问档案。</p>}
    </Modal>
    <Drawer title={`${history?.name || ''} · 修改记录`} open={Boolean(history)} onClose={() => setHistory(null)} size="large">
      {versions.isPending ? <Spin /> : versions.error ? <Alert type="error" title={versions.error.message} /> : versions.data?.items.map(item => <Card key={item.version} size="small" title={`版本 ${item.version}`} style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{item.createdAt}</Typography.Text>
        {cardHistoryFields(item.snapshot).map(field => <Typography.Paragraph key={field.label}><Typography.Text type="secondary">{field.label}：</Typography.Text>{field.value || '未填写'}</Typography.Paragraph>)}
      </Card>)}
      <Button disabled={!versions.data?.nextCursor} onClick={() => setHistoryCursor(versions.data?.nextCursor || undefined)}>更早记录</Button>
    </Drawer>
  </section>
}
