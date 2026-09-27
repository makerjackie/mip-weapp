import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Modal, Space } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import { normalizeOperationValues, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import { ErrorState, LoadingState, OperationFields, PageHeader, toFormValues, humanizeError } from '../../shared/ui'

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
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(Boolean(loadDetail))
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState('')
  const [loadedValues, setLoadedValues] = useState<OperationValues>(config.values)
  const [detailFailed, setDetailFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const submitting = useRef(false)

  const initialValues = useMemo(() => toFormValues(config.fields, config.values), [config.fields, config.values])
  const formContext = useRef({ config, initialValues })
  useEffect(() => {
    formContext.current = { config, initialValues }
  }, [config, initialValues])

  useEffect(() => {
    let active = true
    const current = formContext.current
    submission.current = null
    setLoadedValues(current.config.values)
    setDetailFailed(false)
    setError('')
    setFieldErrors('')
    form.resetFields()
    form.setFieldsValue(current.initialValues)

    if (!loadDetail) {
      setDetailLoading(false)
      return () => { active = false }
    }

    setDetailLoading(true)
    void loadDetail().then(detailValues => {
      if (!active) return
      if (!detailValues) throw new Error('记录不存在或无法读取')
      const latest = formContext.current
      const values = { ...latest.config.values, ...detailValues }
      setLoadedValues(values)
      form.setFieldsValue(toFormValues(latest.config.fields, values))
      setDetailLoading(false)
    }).catch(reason => {
      if (!active) return
      setError(humanizeError(reason))
      setDetailFailed(true)
      setDetailLoading(false)
    })
    return () => { active = false }
  }, [form, loadAttempt, loadDetail])

  if (!hasCapability(config.capability)) {
    return <ErrorState title="权限不足" description="当前运营账号不能执行此操作。" />
  }

  const reloadDetail = async () => {
    if (!loadDetail) return
    const detailValues = await loadDetail()
    if (!detailValues) return
    const values = { ...config.values, ...detailValues }
    setLoadedValues(values)
    form.setFieldsValue(toFormValues(config.fields, values))
  }

  const submit = async () => {
    if (submitting.current || detailLoading || detailFailed) return
    submitting.current = true
    setError('')
    setFieldErrors('')
    try {
      const submitted = await form.validateFields()
      const normalized = normalizeOperationValues(config.fields, submitted, loadedValues)
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
      await queryClient.invalidateQueries()
      void message.success(`${config.title}已提交`)
      void navigate({ to: config.backTarget })
    }
    catch (reason) {
      if (isVersionConflict(reason)) {
        submission.current = null
        try { await reloadDetail() } catch { /* keep the conflict message even if reload fails */ }
        await queryClient.invalidateQueries()
        setError('记录已被其他人更新，已刷新最新版本，请核对后重新提交。')
      }
      else setError(humanizeError(reason))
    }
    finally {
      submitting.current = false
      setLoading(false)
    }
  }

  if (detailLoading) return <LoadingState label="正在加载记录" />
  if (detailFailed) return <Card><Alert type="error" showIcon title="记录加载失败" description={error} /><Space style={{ marginTop: 16 }}><Button onClick={() => setLoadAttempt(value => value + 1)}>重新加载</Button><Button onClick={() => void navigate({ to: config.backTarget })}>返回列表</Button></Space></Card>

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            {config.preview && (!config.preview.capability || hasCapability(config.preview.capability)) ? (
              <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>预览</Button>
            ) : null}
            <Button icon={<ArrowLeftOutlined />} onClick={() => void navigate({ to: config.backTarget })}>
              返回列表
            </Button>
          </>
        }
      />
      <Card className="independent-form-card">
        {fieldErrors ? <Alert type="error" showIcon message={fieldErrors} style={{ marginBottom: 16 }} /> : null}
        <Form
          form={form}
          id="independent-form"
          layout="vertical"
          initialValues={initialValues}
          disabled={loading}
          onFinish={() => void submit()}
        >
          <div className="mutation-grid"><OperationFields fields={config.fields} form={form} /></div>
        </Form>
        {error ? <Alert type="error" showIcon message={error} description="请求结果不确定时，请先刷新并核对服务端记录。" style={{ marginTop: 16 }} /> : null}
        <Space size={12} style={{ marginTop: 24 }}>
          <Button type="primary" htmlType="submit" form="independent-form" loading={loading}>确认提交</Button>
          <Button disabled={loading} onClick={() => void navigate({ to: config.backTarget })}>取消</Button>
        </Space>
      </Card>
      {config.preview ? (
        <Modal
          title="手机端预览"
          open={previewOpen}
          onCancel={() => setPreviewOpen(false)}
          footer={null}
          width={420}
        >
          {config.preview.render(form.getFieldsValue())}
        </Modal>
      ) : null}
    </>
  )
}
