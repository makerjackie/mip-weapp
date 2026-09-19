import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, type FormInstance } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import { normalizeOperationValues, operationFieldVisible, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import type { AdminMediaPurpose } from '../../modules/admin-media-upload'
import { RegistrationSchemaEditor } from '../shared/registration-schema-editor'
import { AssetUploader, AssetListUploader, ErrorState, LoadingState, PageHeader, humanizeError } from '../../shared/ui'

function fieldName(field: OperationField) { return String(field.name || field.key || '') }

function controlFor(field: OperationField) {
  const options = (field.options || []).map(option => typeof option === 'string' ? { value: option, label: option } : option)
  if (field.kind === 'checkbox' || field.kind === 'boolean') return <Checkbox>{field.label}</Checkbox>
  if (field.kind === 'select') return <Select options={options} allowClear={!field.required} />
  if (field.kind === 'multi-select') return <Select mode="multiple" options={options} />
  if (field.assetPurpose) {
    const purpose = field.assetPurpose as AdminMediaPurpose
    if (field.kind === 'asset-list' || field.kind === 'id-list') return <AssetListUploader purpose={purpose} maxCount={12} />
    return <AssetUploader purpose={purpose} />
  }
  if (field.kind === 'textarea' || ['asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind)) {
    return <Input.TextArea rows={4} maxLength={field.maxLength} showCount={Boolean(field.maxLength)} />
  }
  if (field.kind === 'datetime' || field.kind === 'datetime-local') return <DatePicker showTime className="field-full-width" />
  if (field.kind === 'date') return <DatePicker className="field-full-width" />
  if (field.kind === 'number' || field.kind === 'integer') return <InputNumber className="field-full-width" />
  if (field.kind === 'registration-schema') return <RegistrationSchemaEditor />
  return <Input maxLength={field.maxLength} type={field.kind === 'url' ? 'url' : 'text'} />
}

function OperationFields({ fields, form, prefix = [] }: { fields: readonly OperationField[]; form: FormInstance<OperationValues>; prefix?: string[] }) {
  const watchedValues = Form.useWatch([], form) || form.getFieldsValue(true)
  return fields.filter(field => !field.hidden && operationFieldVisible(field, watchedValues)).map((field) => {
    const name = fieldName(field)
    if (!name) return null
    const path = [...prefix, name]
    if (field.kind === 'group') {
      return (
        <fieldset className="mutation-fieldset" key={name}>
          <legend>{field.label}</legend>
          <OperationFields fields={field.fields || []} form={form} prefix={path} />
        </fieldset>
      )
    }
    if (field.kind === 'registration-schema') {
      return (
        <Form.Item key={name} name={path} label={field.label} className="mutation-field--wide">
          <RegistrationSchemaEditor />
        </Form.Item>
      )
    }
    const checkbox = field.kind === 'checkbox' || field.kind === 'boolean'
    return (
      <Form.Item
        className={field.wide ? 'mutation-field--wide' : undefined}
        key={name}
        name={path}
        label={checkbox ? undefined : field.label}
        valuePropName={checkbox ? 'checked' : 'value'}
        rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
        extra={['asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind) ? '每行填写一项' : undefined}
      >
        {controlFor(field)}
      </Form.Item>
    )
  })
}

function toFormValues(fields: readonly OperationField[], values: OperationValues): OperationValues {
  const output: OperationValues = { ...values }
  for (const field of fields) {
    const key = fieldName(field)
    if (!key || field.hidden) continue
    const value = values[key]
    if (field.kind === 'group') output[key] = toFormValues(field.fields || [], value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {})
    else if (['datetime', 'datetime-local', 'date'].includes(field.kind) && typeof value === 'string' && value) output[key] = dayjs(value)
    else if (field.kind === 'asset-list' && Array.isArray(value)) output[key] = value.map(item => item && typeof item === 'object' && 'assetId' in item ? String(item.assetId || '') : '').filter(Boolean).join('\n')
    else if (['id-list', 'profile-ref-list', 'tags'].includes(field.kind) && Array.isArray(value)) output[key] = value.map(String).join('\n')
  }
  return output
}

export interface IndependentFormPageConfig {
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
  backTarget: string
  buildInput: (values: OperationValues) => AdminRequestInput | null
  action: AdminOperationAction
  idempotencyKey: string
  capability: string
  preview?: {
    render: (values: OperationValues) => React.ReactNode
    capability?: string
  }
}

export function IndependentFormPage({ config, loadDetail }: {
  config: IndependentFormPageConfig
  loadDetail?: () => Promise<OperationValues | null>
}) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { demoMode, hasCapability, request } = useAdminSession()
  const [form] = Form.useForm<OperationValues>()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(Boolean(loadDetail))
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState('')

  const initialValues = useMemo(() => toFormValues(config.fields, config.values), [config.fields, config.values])

  useEffect(() => {
    if (!loadDetail) return
    void loadDetail().then(detailValues => {
      if (detailValues) {
        form.setFieldsValue(toFormValues(config.fields, { ...config.values, ...detailValues }))
      }
      setDetailLoading(false)
    }).catch(reason => {
      setError(humanizeError(reason))
      setDetailLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load detail once on mount
  }, [])

  if (!hasCapability(config.capability)) {
    return <ErrorState title="权限不足" description="当前运营账号不能执行此操作。" />
  }

  const submit = async () => {
    if (loading) return
    setError('')
    setFieldErrors('')
    try {
      const submitted = await form.validateFields()
      const normalized = normalizeOperationValues(config.fields, submitted, config.values)
      if (demoMode) {
        void message.info('演示模式不会提交写操作')
        return
      }
      const input = config.buildInput(normalized)
      if (!input) {
        setFieldErrors('请检查必填项、标识、版本和字段格式')
        return
      }
      setLoading(true)
      await request(config.action, { ...input, idempotencyKey: config.idempotencyKey })
      void message.success(`${config.title}已提交`)
      void navigate({ to: config.backTarget })
    }
    catch (reason) {
      setError(humanizeError(reason))
    }
    finally {
      setLoading(false)
    }
  }

  if (detailLoading) return <LoadingState label="正在加载记录" />

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
          layout="vertical"
          initialValues={initialValues}
          disabled={loading}
        >
          <div className="mutation-grid"><OperationFields fields={config.fields} form={form} /></div>
        </Form>
        {error ? <Alert type="error" showIcon message={error} description="请求结果不确定时，请先刷新并核对服务端记录。" style={{ marginTop: 16 }} /> : null}
        <Space size={12} style={{ marginTop: 24 }}>
          <Button type="primary" loading={loading} onClick={() => void submit()}>确认提交</Button>
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
