import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Modal, Space } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import { normalizeOperationValues, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import { rebaseEdit } from '../../modules/edit-conflict'
import { ErrorState, LoadingState, OperationFields, PageHeader, toFormValues, humanizeError } from '../../shared/ui'
import { MediaPreviewProvider } from '../../shared/ui/media-preview-provider'

export type IndependentFormBuildResult =
  | { ok: true; input: AdminRequestInput }
  | { ok: false; errors: Record<string, string> }

export interface IndependentFormPageConfig {
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
  backTarget: string
  buildInput: (values: OperationValues) => IndependentFormBuildResult
  action: AdminOperationAction
  idempotencyKey: string
  capability: string
  textAssist?: { suggest: (text: string) => OperationValues }
  privateDraft?: { load: () => Promise<OperationValues | null>; save: (values: OperationValues) => Promise<OperationValues> }
  preview?: {
    render: (values: OperationValues) => React.ReactNode
    capability?: string
  }
}

function isVersionConflict(reason: unknown): boolean {
  return Boolean(reason && typeof reason === 'object' && 'code' in reason
    && (reason.code === 'CONFLICT' || reason.code === 'VERSION_CONFLICT'))
}

export function IndependentFormPage({ config, loadDetail }: {
  config: IndependentFormPageConfig
  loadDetail?: () => Promise<OperationValues | null>
}) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { demoMode, hasCapability, request } = useAdminSession()
  const [form] = Form.useForm<OperationValues>()
  const formName = useId()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(Boolean(loadDetail))
  const [previewOpen, setPreviewOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistText, setAssistText] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState('')
  const [loadedValues, setLoadedValues] = useState<OperationValues>(config.values)
  const [detailFailed, setDetailFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [conflict, setConflict] = useState<{ original: OperationValues; local: OperationValues; latest: OperationValues | null; draft?: boolean } | null>(null)
  const [privateDraft, setPrivateDraft] = useState<OperationValues | null>(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const recordEpoch = useRef(0)
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const submitting = useRef(false)
  const savingDraft = useRef(false)
  const dirty = useRef(false)
  const blocker = useBlocker({ shouldBlockFn: () => dirty.current || submitting.current || savingDraft.current,
    enableBeforeUnload: () => dirty.current || submitting.current || savingDraft.current, withResolver: true })

  const initialValues = useMemo(() => toFormValues(config.fields, config.values), [config.fields, config.values])
  const formContext = useRef({ config, initialValues })
  const fields = config.fields.map(field => Array.isArray(loadedValues._readOnlyFields) && loadedValues._readOnlyFields.includes(field.key || field.name)
    ? { ...field, readOnly: true, readOnlyReason: '活动已发布，此项影响资格或收费方式，暂不能修改。' } : field)
  useEffect(() => {
    formContext.current = { config, initialValues }
  }, [config, initialValues])

  useEffect(() => {
    let active = true
    recordEpoch.current += 1
    const current = formContext.current
    submission.current = null
    submitting.current = false
    savingDraft.current = false
    dirty.current = false
    form.resetFields()
    form.setFieldsValue(current.initialValues)
    const initialize = Promise.resolve().then(() => {
      if (!active) return
      setLoading(false)
      setLoadedValues(current.config.values)
      setDetailFailed(false); setError(''); setFieldErrors(''); setConflict(null)
      setDetailLoading(Boolean(loadDetail))
      setPrivateDraft(null); setDraftSaving(false)
    })
    let read: Promise<OperationValues | null>
    try { read = loadDetail ? loadDetail() : Promise.resolve(null) }
    catch (reason) { read = Promise.reject(reason) }
    void Promise.all([initialize, read]).then(([, detailValues]) => {
      if (!active || !loadDetail) return
      if (!detailValues) throw new Error('记录不存在或无法读取')
      const latest = formContext.current
      const values = { ...latest.config.values, ...detailValues }
      setLoadedValues(values)
      form.setFieldsValue(toFormValues(latest.config.fields, values))
      setDetailLoading(false)
    }).catch(reason => {
      if (!active) return
      setError(humanizeError(reason)); setDetailFailed(true); setDetailLoading(false)
    })
    if (current.config.privateDraft) void initialize.then(() => current.config.privateDraft?.load()).then(draft => {
      if (active && draft) setPrivateDraft(draft)
    }).catch(() => { if (active) setError('暂时无法读取保存的草稿，可继续编辑，稍后重试。') })
    return () => { active = false; recordEpoch.current += 1 }
  }, [form, loadAttempt, loadDetail])

  if (!hasCapability(config.capability)) {
    return <ErrorState title="权限不足" description="当前运营账号不能执行此操作。" />
  }

  const readLatest = async () => {
    if (!loadDetail) return
    const detailValues = await loadDetail()
    if (!detailValues) throw new Error('无法读取最新记录')
    return { ...config.values, ...detailValues }
  }

  const submit = async () => {
    if (submitting.current || savingDraft.current || detailLoading || detailFailed || conflict) return
    const epoch = recordEpoch.current
    let local: OperationValues = loadedValues
    submitting.current = true
    setError('')
    setFieldErrors('')
    try {
      const submitted = await form.validateFields()
      if (epoch !== recordEpoch.current) return
      const normalized = normalizeOperationValues(fields, submitted, loadedValues)
      local = normalized
      if (demoMode) {
        void message.info('演示模式不会提交写操作')
        return
      }
      const built = config.buildInput(normalized)
      if (!built.ok) {
        const fieldEntries = Object.entries(built.errors).filter(([name]) => name !== 'form')
        if (fieldEntries.length) {
          form.setFields(fieldEntries.map(([name, message]) => ({ name, errors: [message] })))
        }
        setFieldErrors(built.errors.form || '请检查表单中标出的字段')
        return
      }
      const input = built.input
      setLoading(true)
      const payload = JSON.stringify(input)
      if (!submission.current || submission.current.payload !== payload) {
        submission.current = { payload, key: submission.current ? `web-form-${crypto.randomUUID()}` : config.idempotencyKey }
      }
      await request(config.action, { ...input, idempotencyKey: submission.current.key })
      if (epoch !== recordEpoch.current) return
      await queryClient.invalidateQueries()
      dirty.current = false
      submitting.current = false
      void message.success(`${config.title}已提交`)
      void navigate({ to: config.backTarget })
    }
    catch (reason) {
      if (epoch !== recordEpoch.current) return
      if (isVersionConflict(reason)) {
        submission.current = null
        let latest: OperationValues | null = null
        try { latest = await readLatest() ?? null } catch { /* keep the local draft until the latest version can be read */ }
        if (epoch !== recordEpoch.current) return
        setConflict({ original: loadedValues, local, latest })
        await queryClient.invalidateQueries()
        setError('记录已被其他人更新。你的输入已保留，请选择如何核对最新内容。')
      }
      else setError(humanizeError(reason))
    }
    finally {
      if (epoch === recordEpoch.current) { submitting.current = false; setLoading(false) }
    }
  }

  if (detailLoading) return <LoadingState label="正在加载记录" />
  if (loadedValues._canSave === false) return <Card><Alert type="info" showIcon title="当前状态或权限不允许编辑" /><Button style={{ marginTop: 16 }} onClick={() => void navigate({ to: config.backTarget })}>返回列表</Button></Card>
  if (detailFailed) return <Card><Alert type="error" showIcon title="记录加载失败" description={error} /><Space style={{ marginTop: 16 }}><Button onClick={() => setLoadAttempt(value => value + 1)}>重新加载</Button><Button onClick={() => void navigate({ to: config.backTarget })}>返回列表</Button></Space></Card>

  const resolveConflict = (keepLocal: boolean) => {
    if (!conflict?.latest) return
    const next = keepLocal ? rebaseEdit(conflict.original, conflict.local, conflict.latest) : conflict.latest
    setLoadedValues(conflict.latest)
    dirty.current = keepLocal
    if (conflict.latest._draftId) setPrivateDraft(null)
    form.resetFields()
    form.setFieldsValue(toFormValues(config.fields, next))
    setConflict(null)
    setError('')
    void message.info('已载入最新版本，请核对表单后确认提交。')
  }

  return (
    <MediaPreviewProvider existingUrls={loadedValues._mediaUrls && typeof loadedValues._mediaUrls === 'object' ? loadedValues._mediaUrls as Record<string, string> : {}}>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            {config.textAssist ? <Button disabled={loading || draftSaving || Boolean(conflict)} onClick={() => setAssistOpen(true)}>整段文本辅助填充</Button> : null}
            {config.preview && (!config.preview.capability || hasCapability(config.preview.capability)) ? (
              <Button icon={<EyeOutlined />} disabled={loading || draftSaving} onClick={() => setPreviewOpen(true)}>预览</Button>
            ) : null}
            <Button icon={<ArrowLeftOutlined />} disabled={loading || draftSaving} onClick={() => void navigate({ to: config.backTarget })}>
              返回列表
            </Button>
          </>
        }
      />
      <Card className="independent-form-card">
        {privateDraft ? <Alert type="info" showIcon title="有一份已保存的编辑草稿" action={<Button disabled={loading || draftSaving || Boolean(conflict)} onClick={() => {
          setLoadedValues(current => ({ ...current, ...privateDraft })); form.setFieldsValue(toFormValues(config.fields, privateDraft))
          dirty.current = true
          setPrivateDraft(null)
          setError('')
          void message.info('草稿已恢复，请核对后提交。')
        }}>恢复草稿</Button>} style={{ marginBottom: 16 }} /> : null}
        {fieldErrors ? <Alert type="error" showIcon message={fieldErrors} style={{ marginBottom: 16 }} /> : null}
        <Form
          form={form}
          id="independent-form"
          name={`editor-${formName}`}
          layout="vertical"
          initialValues={initialValues}
          disabled={loading || draftSaving || Boolean(conflict)}
          onFinish={() => void submit()}
          onValuesChange={() => { dirty.current = true }}
        >
          <div className="mutation-grid"><OperationFields fields={fields} form={form} /></div>
        </Form>
        {error ? <Alert type="error" showIcon message={error} description="请求结果不确定时，请先刷新并核对服务端记录。" style={{ marginTop: 16 }} /> : null}
        {conflict ? <Space wrap style={{ marginTop: 16 }}>
          {conflict.latest ? <>
            <Button onClick={() => resolveConflict(true)}>保留我的修改并核对</Button>
            <Button onClick={() => resolveConflict(false)}>采用服务端最新内容</Button>
          </> : <Button onClick={async () => {
            const epoch = recordEpoch.current
            try {
              const latest = conflict.draft ? await config.privateDraft?.load() : await readLatest()
              if (epoch === recordEpoch.current && latest) setConflict(current => current ? { ...current, latest: conflict.draft ? { ...loadedValues, ...latest } : latest } : null)
            } catch (reason) { if (epoch === recordEpoch.current) setError(humanizeError(reason)) }
          }}>重新读取冲突版本</Button>}
        </Space> : null}
        <Space size={12} style={{ marginTop: 24 }}>
          <Button type="primary" htmlType="submit" form="independent-form" loading={loading} disabled={draftSaving || Boolean(conflict)}>确认提交</Button>
          {config.privateDraft ? <Button loading={draftSaving} disabled={loading || Boolean(conflict)} onClick={async () => {
            if (savingDraft.current || submitting.current) return
            savingDraft.current = true
            const epoch = recordEpoch.current
            setDraftSaving(true)
            setError('')
            try {
              const values = normalizeOperationValues(fields, form.getFieldsValue(true), { ...loadedValues,
                ...(!loadedValues._draftId && privateDraft ? { _draftId: privateDraft._draftId, _draftVersion: privateDraft._draftVersion } : {}) })
              const saved = await config.privateDraft!.save(values)
              if (epoch === recordEpoch.current) {
                setPrivateDraft(null); setLoadedValues(current => ({ ...current, _draftId: saved._draftId, _draftVersion: saved._draftVersion }))
                dirty.current = false
                void message.success('草稿已保存，可退出后恢复')
              }
            } catch (reason) {
              if (epoch !== recordEpoch.current) return
              setError(humanizeError(reason))
              if (isVersionConflict(reason)) {
                const local = normalizeOperationValues(fields, form.getFieldsValue(true), loadedValues)
                let latest: OperationValues | null = null
                try {
                  const draft = await config.privateDraft!.load()
                  if (draft) latest = { ...loadedValues, ...draft }
                } catch { /* preserve input and keep the write blocked until a current draft can be read */ }
                if (epoch === recordEpoch.current) setConflict({ original: privateDraft || loadedValues, local, latest, draft: true })
              }
            }
            finally { if (epoch === recordEpoch.current) { savingDraft.current = false; setDraftSaving(false) } }
          }}>保存草稿</Button> : null}
          <Button disabled={loading || draftSaving} onClick={() => void navigate({ to: config.backTarget })}>取消</Button>
        </Space>
      </Card>
      {config.textAssist ? <Modal title="整段文本辅助填充" open={assistOpen} onCancel={() => setAssistOpen(false)} okText="填入表单后逐项核对" onOk={() => {
        try {
          const suggestions = config.textAssist!.suggest(assistText)
          form.setFieldsValue(toFormValues(fields, suggestions))
          dirty.current = true
          setAssistOpen(false)
          void message.info('已填入明确标注的文字，请核对后保存；金额、发布人及范围需手动填写。')
        } catch (reason) { void message.error(reason instanceof Error ? reason.message : '文本无法解析') }
      }}>
        <p>可用“标题：”“简介：”“合作需求：”“详情：”标注。未标注的全文填入详情，只有明确提取的文字会替换对应字段。</p>
        <Input.TextArea aria-label="待整理机会全文" value={assistText} onChange={event => setAssistText(event.target.value)} rows={10} maxLength={8000} />
      </Modal> : null}
      {config.preview ? (
        <Modal
          title="手机端预览"
          open={previewOpen}
          onCancel={() => setPreviewOpen(false)}
          footer={null}
          width={420}
        >
          {config.preview.render(normalizeOperationValues(fields, form.getFieldsValue(), loadedValues))}
        </Modal>
      ) : null}
      <Modal title="还有未保存的修改" open={blocker.status === 'blocked'} okText="放弃修改并离开" cancelText="继续编辑"
        onCancel={() => blocker.status === 'blocked' && blocker.reset()} onOk={() => {
          if (blocker.status === 'blocked' && !submitting.current && !savingDraft.current) { dirty.current = false; blocker.proceed() }
        }} okButtonProps={{ disabled: loading || draftSaving }}>
        {config.privateDraft ? '可以先返回表单保存草稿，再退出。直接离开会丢失本次尚未保存的修改。' : '直接离开会丢失本次尚未保存的修改。'}
      </Modal>
    </MediaPreviewProvider>
  )
}
