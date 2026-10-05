import { useId, useMemo, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { configurationDraft, demoExperienceRules, demoMembershipAgreement, demoUserAgreement, membershipConfiguration, planPriceCents, planPriceYuan, type AgreementDocument, type ConfigurationItem, type ConfigurationKind, type MembershipPlan } from '../../modules/membership-configuration'
import { AssetUploader } from '../../shared/ui/asset-uploader'
import { MediaPreviewProvider } from '../../shared/ui/media-preview-provider'
const labels: Record<ConfigurationKind, string> = { levels: '等级门槛', benefits: '等级权益', rules: '成长奖励规则', badges: '勋章定义' }
const statuses = [{ value: 'DRAFT', label: '草稿' }, { value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }]
const badgeCategories = [{ value: 'IDENTITY', label: '身份勋章' }, { value: 'HONOR', label: '荣誉勋章' }]
// MIW-35：会员方案页签——只改价格；名称、时长、状态由服务端展示为只读事实。
const planStageLabels: Record<MembershipPlan['catalogStage'], string> = { TEST: '测试', LIVE: '正式' }
// 文档页签：两份协议 + 经验值规则说明（MIW-27），共用同一份带版本的后台表单。
const documentTabs: Array<{ key: string; label: string; document: AgreementDocument; demo: { title: string; body: string; isDemo: boolean } }> = [
  { key: 'agreement', label: '会员服务协议', document: 'membership', demo: demoMembershipAgreement },
  { key: 'user-agreement', label: '用户使用协议', document: 'user', demo: demoUserAgreement },
  { key: 'experience-rules', label: '经验值规则说明', document: 'experience-rules', demo: demoExperienceRules },
]
export function MembershipConfigurationPanel({ onSaved }: { onSaved: () => void }) {
  const session = useAdminSession()
  const api = useMemo(() => membershipConfiguration(session.request), [session.request])
  const cache = useQueryClient()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const search = useRouterState({ select: state => state.location.search as Record<string, unknown> })
  const tab = typeof search.tab === 'string' && (search.tab in labels || search.tab === 'plans' || documentTabs.some(item => item.key === search.tab)) ? search.tab : 'levels'
  const documentTab = documentTabs.find(item => item.key === tab)
  const isAgreement = Boolean(documentTab)
  const document = documentTab?.document ?? 'membership'
  const demoAgreement = documentTab?.demo ?? demoMembershipAgreement
  const setTab = (tab: string) => void navigate({ to: '/growth', search: { ...search, tab } })
  const [editing, setEditing] = useState<{ kind: ConfigurationKind; item: ConfigurationItem | null; draft: Record<string, unknown> } | null>(null)
  const formName = useId()
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
  const plans = useQuery({ queryKey: [...key, 'plans'], enabled: readable && tab === 'plans', queryFn: () => api.plans() })
  const [priceEdits, setPriceEdits] = useState<Record<string, number | null>>({})
  const planPriceValue = (plan: MembershipPlan) => {
    const edit = priceEdits[plan.id]
    return edit === undefined ? planPriceYuan(plan.priceCents) : edit
  }
  const mutation = useMutation({ mutationFn: (operation: () => Promise<unknown>) => operation(), onSuccess: async () => {
    setEditing(null); await cache.invalidateQueries({ queryKey: key }); onSaved(); void message.success('已保存，用户端下次加载时生效')
  }, onError: error => { void message.error(error instanceof Error ? error.message : '保存失败') } })
  // 改价即时生效但只影响之后的新订单（下单时金额已快照），所以提示语与内容配置区分开。
  const planMutation = useMutation({
    mutationFn: (operation: { planId: string; run: () => Promise<unknown> }) => operation.run().then(() => operation.planId),
    onSuccess: async planId => {
      setPriceEdits(current => { const next = { ...current }; delete next[planId]; return next })
      await cache.invalidateQueries({ queryKey: key }); onSaved(); void message.success('已保存，仅新订单按新价格下单')
    },
    onError: error => { void message.error(error instanceof Error ? error.message : '保存失败') },
  })
  const savePlanPrice = (plan: MembershipPlan) => {
    const cents = planPriceCents(planPriceValue(plan))
    if (cents === null) { void message.error('请输入 0.01 元至 100 万元之间的价格'); return }
    planMutation.mutate({ planId: plan.id, run: () => api.savePlanPrice(plan.id, plan.version, cents, crypto.randomUUID()) })
  }
  const edit = (item: ConfigurationItem | null, demo = false) => {
    const draft = configurationDraft(kind, item, demo)
    if (!item && kind === 'levels') draft.minimumExperience = Math.max(0, ...(items.data?.items.map(level => Number(level.minimumExperience)) || [])) + 500
    setEditing({ kind, item, draft }); form.resetFields(); form.setFieldsValue(draft)
  }
  if (!readable) return null
  // 服务端把已保存素材的 cloud:// 文件 id 解析为可预览的临时地址，供编辑时回显。
  const mediaUrls = Object.fromEntries((items.data?.items || [])
    .filter(item => item.imageAssetId && typeof item.imagePreviewUrl === 'string' && item.imagePreviewUrl)
    .map(item => [String(item.imageAssetId), String(item.imagePreviewUrl)]))
  return <Card style={{ marginBottom: 24 }} title="会员内容配置">
    <MediaPreviewProvider existingUrls={mediaUrls}>
    <Typography.Paragraph type="secondary">等级、权益和勋章由管理员维护。任务的奖励金额、经验值和贡献值请在“任务管理”中编辑；下方“成长奖励规则”管理已有行为事件的奖励。修改不追溯改写已发放记录。</Typography.Paragraph>
    <Tabs activeKey={tab} onChange={setTab} items={[...Object.entries(labels).filter(([key]) => key !== 'badges' || badgeWritable).map(([key, label]) => ({ key, label })), { key: 'plans', label: '会员方案' }, ...documentTabs.map(({ key, label }) => ({ key, label }))]} />
    {tab === 'plans' ? plans.isPending ? <Spin /> : plans.error ? <Alert type="error" title={plans.error.message} action={<Button onClick={() => void plans.refetch()}>重试</Button>} /> : <>
      <Alert type="info" showIcon title="价格保存后立即对之后的新订单生效；已支付订单的金额与快照不变。测试与正式方案相互独立，修改测试方案不影响正式下单。" style={{ marginBottom: 16 }} />
      <div style={{ display: 'grid', gap: 12 }}>
        {plans.data?.items.map(plan => <Card size="small" key={plan.id}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Typography.Text strong>{plan.name}</Typography.Text>
              <Tag>{planStageLabels[plan.catalogStage] || plan.catalogStage}</Tag>
              <Tag>{statuses.find(status => status.value === plan.status)?.label || plan.status}</Tag>
              <Typography.Text type="secondary">时长 {plan.durationDays} 天</Typography.Text>
            </Space>
            <Space wrap>
              <InputNumber min={0.01} max={1000000} precision={2} addonBefore="¥" aria-label={`价格-${plan.name}`}
                disabled={!configurable} value={planPriceValue(plan)}
                onChange={value => setPriceEdits(current => ({ ...current, [plan.id]: value }))} />
              {configurable && <Button type="primary" loading={planMutation.isPending && planMutation.variables?.planId === plan.id} onClick={() => savePlanPrice(plan)}>保存</Button>}
            </Space>
          </Space>
        </Card>)}
        {!plans.error && !plans.isPending && !plans.data?.items.length && <Typography.Text type="secondary">暂无会员方案。</Typography.Text>}
      </div>
    </> : isAgreement ? agreement.isPending ? <Spin /> : agreement.error ? <Alert type="error" title={agreement.error.message} action={<Button onClick={() => void agreement.refetch()}>重试</Button>} /> : <Form key={`${document}-${agreement.data?.version}`} name={`agreement-${formName}`} form={agreementForm} clearOnDestroy layout="vertical" initialValues={agreement.data?.body ? agreement.data : demoAgreement} onFinish={values => {
      const version = agreement.data?.version
      if (version === undefined || !configurable) return
      mutation.mutate(() => api.saveAgreement(version, values, crypto.randomUUID(), document))
    }}>
      <Alert type="info" showIcon title={tab === 'experience-rules' ? '正文支持换行，按纯文本展示；取消演示标记前请替换为实际规则说明。保存后小程序「经验值详情-规则详情」页签同步读取整段文本。' : '正文支持换行，按纯文本展示；取消演示标记前请替换为实际服务条款。保存后小程序设置中的对应协议同步读取。'} style={{ marginBottom: 16 }} />
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
          {kind === 'badges' && <Tag>{badgeCategories.find(category => category.value === item.category)?.label || String(item.category)}</Tag>}
          {kind === 'levels' && <p>门槛：{String(item.minimumExperience)} 经验值</p>}
          {kind === 'rules' && <p>奖励：{String(item.deltaValue)} {item.metric === 'EXPERIENCE' ? '经验值' : '贡献值'}</p>}
          {typeof item.description === 'string' && <Typography.Paragraph>{item.description}</Typography.Paragraph>}
          {kind === 'badges' && typeof item.acquireCondition === 'string' && item.acquireCondition ? <p>获得条件：{item.acquireCondition}</p> : null}
          {(kind === 'badges' ? badgeWritable : configurable) && <Button onClick={() => edit(item)}>编辑</Button>}
        </Card>)}
        {!items.error && !items.isPending && !items.data?.items.length && <Typography.Text type="secondary">暂无配置，可新建或填写演示示例。</Typography.Text>}
      </div>}
    </>}
    <Modal title={editing ? `${editing.item ? '编辑' : '新建'}${labels[editing.kind]}` : ''} open={Boolean(editing)} onCancel={() => setEditing(null)} confirmLoading={mutation.isPending} onOk={() => void form.validateFields().then(values => {
      if (!editing) return
      const { kind, item, draft } = editing
      mutation.mutate(() => api.save(kind, item, { ...draft, ...values }, crypto.randomUUID()))
    }, () => undefined)}>
      <Form name={`membership-config-${formName}`} form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, max: 80 }]}><Input /></Form.Item>
        {editing?.kind === 'levels' && <><Form.Item name="minimumExperience" label="最低经验值" extra="不同等级的门槛不能重复；必须保留一个启用的 0 经验等级。" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item><Form.Item name="benefitIds" label="包含权益"><Select mode="multiple" loading={benefits.isPending} options={benefits.data?.items.map(item => ({ value: item.id, label: `${item.name}${item.status !== 'ACTIVE' ? '（未启用）' : ''}` }))} /></Form.Item></>}
        {editing?.kind === 'rules' ? <><Form.Item name="deltaValue" label="每次奖励" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="dailyLimitValue" label="每日上限（留空不限）"><InputNumber min={0} precision={0} /></Form.Item><Alert type="info" showIcon title="规则详情页签的展示文本请在「经验值规则说明」页签中整段配置；此处仅维护奖励数值。" style={{ marginBottom: 16 }} /></> : <Form.Item name="sortOrder" label="排序（小的在前）"><InputNumber min={0} max={1000000} precision={0} /></Form.Item>}
        {(editing?.kind === 'benefits' || editing?.kind === 'badges') && <Form.Item name="description" label="说明" rules={[{ max: 500 }]}><Input.TextArea rows={3} /></Form.Item>}
        {editing?.kind === 'badges' && <Form.Item name="category" label="分类" rules={[{ required: true }]}><Select options={badgeCategories} /></Form.Item>}
        {editing?.kind === 'badges' && <Form.Item name="acquireCondition" label="获得条件" extra="仅作为说明展示给用户；勋章当前均由管理员人工发放" rules={[{ max: 300 }]}><Input.TextArea rows={2} /></Form.Item>}
        {editing?.kind === 'badges' && <Form.Item name="imageAssetId" label="勋章形象" extra="上传 PNG/JPEG（≤1MB）后自动保存素材；小程序优先展示该形象"><AssetUploader purpose="BADGE_IMAGE" disabled={!badgeWritable} placeholder="上传勋章图片后自动填入" /></Form.Item>}
        {editing?.kind === 'badges' && <Form.Item name="imageUrl" label="勋章图片 HTTPS 地址" extra="未上传素材时的兜底；已上传素材时以素材为准" rules={[{ pattern: /^https:\/\//, message: '请填写 HTTPS 图片地址或留空' }]}><Input /></Form.Item>}
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={statuses} /></Form.Item>
      </Form>
    </Modal>
    </MediaPreviewProvider>
  </Card>
}
