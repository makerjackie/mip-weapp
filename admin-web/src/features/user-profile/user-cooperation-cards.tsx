import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, Input, Rate, Select, Space, Typography } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { cooperationTextFields, emptyCooperationCard, loadUserCooperationCards, rebaseCooperationCard, saveUserCooperationCard, type CooperationCard, type CooperationSchema } from '../../modules/user-cooperation-cards'
import { formatUserDateTime, label } from '../../modules/admin-read-formatters'
import { ErrorState, LoadingState, StatusTag } from '../../shared/ui'

export function UserCooperationCards({ userId, onEditingChange }: { userId: string; onEditingChange: (editing: boolean) => void }) {
  const { request, session, sessionBoundary, hasCapability } = useAdminSession()
  const [editingType, setEditingType] = useState('')
  useEffect(() => { onEditingChange(Boolean(editingType)); return () => onEditingChange(false) }, [editingType, onEditingChange])
  const query = useQuery({ queryKey: ['admin', 'user-cooperation-cards', session?.actor?.id, sessionBoundary, userId], enabled: Boolean(session?.enabled && hasCapability('userContent.moderate')), queryFn: () => loadUserCooperationCards(userId, request) })
  if (!hasCapability('userContent.moderate')) return <Alert type="info" title="当前账号没有查看合作卡的权限。" />
  if (query.isPending) return <LoadingState />
  if (query.error) return <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
  return <Space orientation="vertical" size={16} className="user-content-list">
    {query.data.schemas.map(schema => <CooperationCardPanel key={`${userId}:${schema.key}`} schema={schema}
      item={query.data.cards.find(item => item.cardType === schema.key) || emptyCooperationCard(userId, schema)}
      editing={editingType === schema.key} anotherEditing={Boolean(editingType && editingType !== schema.key)}
      onEdit={() => setEditingType(schema.key)} onClose={() => setEditingType('')} />)}
  </Space>
}

function CooperationCardPanel({ item, schema, editing, anotherEditing, onEdit, onClose }: { item: CooperationCard; schema: CooperationSchema; editing: boolean; anotherEditing: boolean; onEdit: () => void; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [form] = Form.useForm<CooperationCard>()
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const baseline = useRef(item), submitting = useRef(false), submission = useRef<{ body: string; key: string } | null>(null)
  const { request, demoMode } = useAdminSession()
  const cache = useQueryClient(), { message, modal } = App.useApp()
  const begin = () => { baseline.current = item; submission.current = null; form.resetFields(); form.setFieldsValue(item); setError(''); setConflict(false); setExpanded(true); onEdit() }
  const readLatest = async () => {
    try {
      const latest = (await loadUserCooperationCards(item.userId, request)).cards.find(card => card.cardType === item.cardType) || emptyCooperationCard(item.userId, schema)
      form.setFieldsValue(rebaseCooperationCard(baseline.current, form.getFieldsValue(true), latest, schema))
      baseline.current = latest; submission.current = null; setConflict(false); setError('已保留你的修改并读取最新版本，请核对各项后再次保存。')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取失败，输入已保留。') }
  }
  const cancel = () => {
    if (!form.isFieldsTouched()) { onClose(); return }
    modal.confirm({ title: '放弃尚未保存的合作卡修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
  }
  const save = async () => {
    if (submitting.current || conflict) return
    submitting.current = true
    try {
      const values = await form.validateFields()
      if (demoMode) throw new Error('演示模式不能保存合作卡。')
      const body = JSON.stringify({ version: baseline.current.expectedVersion, values })
      if (submission.current?.body !== body) submission.current = { body, key: `web-cooperation-${crypto.randomUUID()}` }
      setSaving(true); setError('')
      await saveUserCooperationCard(baseline.current, values, schema, submission.current.key, request)
      // Read the saved object afresh before closing. No success based solely on mutation response.
      const saved = await loadUserCooperationCards(item.userId, request)
      if (!saved.cards.some(card => card.cardType === item.cardType && card.expectedVersion > baseline.current.expectedVersion)) throw new Error('保存结果尚未确认，请刷新合作卡核对；输入已保留。')
      await cache.invalidateQueries()
      void message.success('合作卡已保存并回读'); onClose()
    } catch (failure) {
      if (failure && typeof failure === 'object' && 'code' in failure && ['CONFLICT', 'VERSION_CONFLICT'].includes(String(failure.code))) setConflict(true)
      if (failure instanceof Error) setError(failure.message)
      else if (failure && typeof failure === 'object' && 'errorFields' in failure) setError('请完成必填项和六项 1–5 星评分。')
      else setError('保存失败，输入已保留。')
    } finally { submitting.current = false; setSaving(false) }
  }
  return <Card title={schema.label} extra={<Space wrap><StatusTag value={label(item.status)} />
    {!editing ? <><Button onClick={() => setExpanded(!expanded)}>{expanded ? '收起详情' : '查看详情'}</Button><Button disabled={anotherEditing} onClick={begin}>{item.id ? '编辑' : '填写合作卡'}</Button></> : null}</Space>}>
    <Typography.Paragraph><strong>我的目标：</strong>{item.targetSummary || '尚未填写'}</Typography.Paragraph>
    <Typography.Paragraph><strong>需要引荐：</strong>{item.referralNeeded || '尚未填写'}</Typography.Paragraph>
    {editing ? <Form form={form} layout="vertical" disabled={saving} preserve>
      {cooperationTextFields.map(([key, title]) => <Form.Item key={key} name={key} label={title} rules={[{ required: ['cardSummary', 'targetSummary'].includes(key), whitespace: true, message: `请填写${title}` }, { max: ['realName', 'gameName'].includes(key) ? 64 : 500 }]}><Input.TextArea rows={['realName', 'gameName'].includes(key) ? 1 : 3} maxLength={['realName', 'gameName'].includes(key) ? 64 : 500} showCount /></Form.Item>)}
      <Typography.Title level={4}>特征打分</Typography.Title>
      <div className="user-cooperation-scores">{schema.scores.map((key, index) => <Form.Item key={key} name={['abilityScores', index, 'score']} label={key} rules={[{ required: true, type: 'number', min: 1, max: 5, message: '请选择 1–5 星' }]}><Rate allowClear={false} aria-label={key} /></Form.Item>)}</div>
      <Typography.Title level={4}>{schema.key === 'PIMP' ? '常混迹的圈子' : '本人的菜单'}</Typography.Title>
      {schema.menu.map(key => <Form.Item key={key} name={['menuFields', key]} label={key} rules={[{ required: true, whitespace: true, message: `请填写${key}` }, { max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>)}
      <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'DRAFT', label: '草稿' }, { value: 'PUBLISHED', label: '正常' }, { value: 'UNPUBLISHED', label: '已停用' }]} /></Form.Item>
      {error ? <Alert type="error" title={error} showIcon /> : null}
      {conflict ? <Button onClick={() => void readLatest()}>读取最新版本并保留我的修改</Button> : null}
      <Space className="user-content-save-actions"><Button type="primary" disabled={conflict} loading={saving} onClick={() => void save()}>保存合作卡</Button><Button disabled={saving} onClick={cancel}>取消</Button></Space>
    </Form> : expanded ? <>
      <dl className="detail-fields">{cooperationTextFields.map(([key, title]) => <div key={key}><dt>{title}</dt><dd>{item[key] || '—'}</dd></div>)}</dl>
      <Typography.Title level={4}>特征打分</Typography.Title>
      <div className="user-cooperation-scores">{schema.scores.map(key => <div key={key}><Typography.Text>{key}</Typography.Text><br /><Rate disabled value={item.abilityScores.find(score => score.key === key)?.score || 0} aria-label={`${key}评分`} /></div>)}</div>
      <Typography.Title level={4}>{schema.key === 'PIMP' ? '常混迹的圈子' : '本人的菜单'}</Typography.Title>
      <dl className="detail-fields">{schema.menu.map(key => <div key={key}><dt>{key}</dt><dd>{item.menuFields[key] || '—'}</dd></div>)}</dl>
      <Typography.Text type="secondary">最近修改：{item.modifiedBy || '—'} · {item.modifiedAt ? formatUserDateTime(item.modifiedAt) : '—'}</Typography.Text>
    </> : null}
  </Card>
}
