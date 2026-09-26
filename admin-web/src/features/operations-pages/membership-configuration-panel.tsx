import { useMemo, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { configurationDraft, demoMembershipAgreement, demoUserAgreement, membershipConfiguration, type ConfigurationItem, type ConfigurationKind } from '../../modules/membership-configuration'
const labels: Record<ConfigurationKind, string> = { levels: '等级门槛', benefits: '等级权益', rules: '成长奖励规则', badges: '勋章定义' }
const statuses = [{ value: 'DRAFT', label: '草稿' }, { value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }]
export function MembershipConfigurationPanel({ onSaved }: { onSaved: () => void }) {
  const session = useAdminSession()
  const api = useMemo(() => membershipConfiguration(session.request), [session.request])
  const cache = useQueryClient()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const search = useRouterState({ select: state => state.location.search as Record<string, unknown> })
  const tab = typeof search.tab === 'string' && (search.tab in labels || search.tab === 'agreement' || search.tab === 'user-agreement') ? search.tab : 'levels'
  const isAgreement = tab === 'agreement' || tab === 'user-agreement'
  const document = tab === 'user-agreement' ? 'user' : 'membership'
  const demoAgreement = document === 'user' ? demoUserAgreement : demoMembershipAgreement
  const setTab = (tab: string) => void navigate({ to: '/growth', search: { ...search, tab } })
  const [editing, setEditing] = useState<{ kind: ConfigurationKind; item: ConfigurationItem | null; draft: Record<string, unknown> } | null>(null)
  const [form] = Form.useForm()
  const [agreementForm] = Form.useForm()
  const key = ['admin', 'membership-configuration', session.session?.actor?.id, session.sessionBoundary]
  const readable = !session.demoMode && session.hasCapabilityAtScope('growth.read', 'PLATFORM')
  const configurable = readable && session.hasCapabilityAtScope('growth.configure', 'PLATFORM')
  const badgeWritable = readable && session.hasCapabilityAtScope('badges.manage', 'PLATFORM')
  const kind = tab in labels ? tab as ConfigurationKind : 'levels'
  const items = useQuery({ queryKey: [...key, kind], enabled: readable && !isAgreement && (kind !== 'badges' || badgeWritable), queryFn: () => api.list(kind) })
  const benefits = useQuery({ queryKey: [...key, 'benefit-options'], enabled: configurable && tab === 'levels', queryFn: () => api.list('benefits') })
  const agreement = useQuery({ queryKey: [...key, 'agreement', document], enabled: readable && isAgreement, queryFn: () => api.agreement(document) })
  const mutation = useMutation({ mutationFn: (operation: () => Promise<unknown>) => operation(), onSuccess: async () => {
    setEditing(null); await cache.invalidateQueries({ queryKey: key }); onSaved(); void message.success('已保存，用户端下次加载时生效')
  }, onError: error => { void message.error(error instanceof Error ? error.message : '保存失败') } })
  const edit = (item: ConfigurationItem | null, demo = false) => {
    const draft = configurationDraft(kind, item, demo)
    if (!item && kind === 'levels') draft.minimumExperience = Math.max(0, ...(items.data?.items.map(level => Number(level.minimumExperience)) || [])) + 500
    setEditing({ kind, item, draft }); form.resetFields(); form.setFieldsValue(draft)
  }
  if (!readable) return null
  return <Card style={{ marginBottom: 24 }} title="会员内容配置">
    <Typography.Paragraph type="secondary">等级、权益和勋章由管理员维护。任务的奖励金额、经验值和贡献值请在“任务管理”中编辑；下方“成长奖励规则”管理已有行为事件的奖励。修改不追溯改写已发放记录。</Typography.Paragraph>
    <Tabs activeKey={tab} onChange={setTab} items={[...Object.entries(labels).filter(([key]) => key !== 'badges' || badgeWritable).map(([key, label]) => ({ key, label })), { key: 'agreement', label: '会员服务协议' }, { key: 'user-agreement', label: '用户使用协议' }]} />
    {isAgreement ? agreement.isPending ? <Spin /> : agreement.error ? <Alert type="error" title={agreement.error.message} action={<Button onClick={() => void agreement.refetch()}>重试</Button>} /> : <Form key={`${document}-${agreement.data?.version}`} form={agreementForm} clearOnDestroy layout="vertical" initialValues={agreement.data?.body ? agreement.data : demoAgreement} onFinish={values => {
      const version = agreement.data?.version
      if (version === undefined || !configurable) return
      mutation.mutate(() => api.saveAgreement(version, values, crypto.randomUUID(), document))
    }}>
      <Alert type="info" showIcon title="正文支持换行，按纯文本展示；取消演示标记前请替换为实际服务条款。保存后小程序设置中的对应协议同步读取。" style={{ marginBottom: 16 }} />
      <Form.Item name="title" label="标题" rules={[{ required: true, max: 100 }]}><Input disabled={!configurable} /></Form.Item>
      <Form.Item name="body" label="正文" rules={[{ required: true, max: 8000 }, { validator: (_, value) => new TextEncoder().encode(JSON.stringify(value || '')).length <= 27000 ? Promise.resolve() : Promise.reject(new Error('正文过长，请精简后重试')) }]}><Input.TextArea rows={12} disabled={!configurable} /></Form.Item>
      <Form.Item name="isDemo" valuePropName="checked"><Checkbox disabled={!configurable}>标记为演示内容</Checkbox></Form.Item>
      {configurable && <Space wrap><Button type="primary" htmlType="submit" loading={mutation.isPending}>保存并生效</Button><Button onClick={() => agreementForm.setFieldsValue(demoAgreement)}>填入演示正文</Button></Space>}
    </Form> : <>
      {(kind === 'badges' ? badgeWritable : configurable) && kind !== 'rules' && <Space wrap style={{ marginBottom: 16 }}><Button type="primary" onClick={() => edit(null)}>新建{labels[kind]}</Button><Button onClick={() => edit(null, true)}>填写演示示例</Button></Space>}
      {items.error && <Alert type="error" title={items.error.message} action={<Button onClick={() => void items.refetch()}>重试</Button>} />}
      {items.isPending ? <Spin /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
        {items.data?.items.map(item => <Card size="small" key={item.id} title={item.name}>
          <Tag>{statuses.find(status => status.value === item.status)?.label || item.status}</Tag>
          {kind === 'levels' && <p>门槛：{String(item.minimumExperience)} 经验值</p>}
          {kind === 'rules' && <p>奖励：{String(item.deltaValue)} {item.metric === 'EXPERIENCE' ? '经验值' : '贡献值'}</p>}
          {typeof item.description === 'string' && <Typography.Paragraph>{item.description}</Typography.Paragraph>}
          {(kind === 'badges' ? badgeWritable : configurable) && <Button onClick={() => edit(item)}>编辑</Button>}
        </Card>)}
        {!items.error && !items.isPending && !items.data?.items.length && <Typography.Text type="secondary">暂无配置，可新建或填写演示示例。</Typography.Text>}
      </div>}
    </>}
    <Modal title={editing ? `编辑${labels[editing.kind]}` : ''} open={Boolean(editing)} onCancel={() => setEditing(null)} confirmLoading={mutation.isPending} onOk={() => void form.validateFields().then(values => {
      if (!editing) return
      const { kind, item, draft } = editing
      mutation.mutate(() => api.save(kind, item, { ...draft, ...values }, crypto.randomUUID()))
    }, () => undefined)}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, max: 80 }]}><Input /></Form.Item>
        {editing?.kind === 'levels' && <><Form.Item name="minimumExperience" label="最低经验值" extra="不同等级的门槛不能重复；必须保留一个启用的 0 经验等级。" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item><Form.Item name="benefitIds" label="包含权益"><Select mode="multiple" loading={benefits.isPending} options={benefits.data?.items.map(item => ({ value: item.id, label: `${item.name}${item.status !== 'ACTIVE' ? '（未启用）' : ''}` }))} /></Form.Item></>}
        {editing?.kind === 'rules' ? <><Form.Item name="deltaValue" label="每次奖励" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="dailyLimitValue" label="每日上限（留空不限）"><InputNumber min={0} precision={0} /></Form.Item></> : <Form.Item name="sortOrder" label="排序（小的在前）"><InputNumber min={0} max={1000000} precision={0} /></Form.Item>}
        {(editing?.kind === 'benefits' || editing?.kind === 'badges') && <Form.Item name="description" label="说明" rules={[{ max: 500 }]}><Input.TextArea rows={3} /></Form.Item>}
        {editing?.kind === 'badges' && <Form.Item name="imageUrl" label="勋章图片 HTTPS 地址" rules={[{ pattern: /^https:\/\//, message: '请填写 HTTPS 图片地址或留空' }]}><Input placeholder="可使用素材上传后的 HTTPS 图片地址" /></Form.Item>}
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={statuses} /></Form.Item>
      </Form>
    </Modal>
  </Card>
}
