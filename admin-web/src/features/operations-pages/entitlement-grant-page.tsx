import { Alert, App, Button, Card, Form, Input, InputNumber, Radio, Select, Space, Spin, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { humanizeError, PageHeader, SessionUserSelect } from '../../shared/ui'
import { demo } from '../../services/demo-data'

// MIW-129 H2：独立发放页。经验值/贡献值复用 mip.admin.growth.adjust，
// 玩家会籍复用与「用户档案 → 开通玩家权益」相同的 mip.admin.memberships.grant。
type GrantType = 'EXPERIENCE' | 'CONTRIBUTION' | 'MEMBERSHIP'

const GRANT_TYPES: Array<{ value: GrantType; label: string; capability: string }> = [
  { value: 'EXPERIENCE', label: '经验值', capability: 'growth.adjust' },
  { value: 'CONTRIBUTION', label: '贡献值', capability: 'growth.adjust' },
  { value: 'MEMBERSHIP', label: '玩家权益', capability: 'memberships.adjust' },
]

const DURATION_OPTIONS = [1, 3, 6, 12].map(months => ({ value: months, label: `${months} 个月` }))

interface GrantFormValues {
  userId: string
  type: GrantType
  amount?: number
  durationMonths?: number
  reason: string
}

export function EntitlementGrantPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { request, demoMode, hasCapability } = useAdminSession()
  const [form] = Form.useForm<GrantFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const userId = Form.useWatch('userId', form)
  const type = (Form.useWatch('type', form) || 'EXPERIENCE') as GrantType
  const isMembership = type === 'MEMBERSHIP'

  // 会员链版本是服务端事实：选择用户后读取，提交时原样回传；
  // 读取失败（如尚未建立会员链）时阻止提交，不猜版本号。
  const membership = useQuery({
    queryKey: ['admin', 'entitlement-grant-chain', userId],
    enabled: !demoMode && isMembership && Boolean(userId),
    queryFn: () => request<{ chainVersion?: number }>('mip.admin.memberships.get', { userId: String(userId) }),
    retry: false,
  })
  const chainVersion = typeof membership.data?.chainVersion === 'number' ? membership.data.chainVersion : undefined
  const membershipBlocked = isMembership && !demoMode && Boolean(userId) && (membership.isPending || membership.isError || chainVersion === undefined)

  const submit = async (values: GrantFormValues) => {
    if (demoMode) { void message.info('演示模式不会提交写操作'); return }
    setSubmitting(true)
    try {
      const idempotencyKey = `web-entitlement-grant-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
      if (values.type === 'MEMBERSHIP') {
        if (chainVersion === undefined) { void message.error('尚未取得该用户的会员链版本，不能发放会籍'); return }
        await request('mip.admin.memberships.grant', {
          userId: values.userId,
          durationMonths: Number(values.durationMonths),
          expectedChainVersion: chainVersion,
          reason: values.reason.trim(),
          idempotencyKey,
        })
      }
      else {
        await request('mip.admin.growth.adjust', {
          userId: values.userId,
          metric: values.type,
          deltaValue: Number(values.amount),
          reason: values.reason.trim(),
          idempotencyKey,
        })
      }
      await queryClient.invalidateQueries()
      void message.success('权益已发放，可在权益流水中核对')
      void navigate({ to: '/entitlements' })
    }
    catch (reason) {
      void message.error(humanizeError(reason))
    }
    finally {
      setSubmitting(false)
    }
  }

  const typeOptions = GRANT_TYPES.map(item => ({
    value: item.value,
    label: item.label,
    disabled: !demoMode && !hasCapability(item.capability),
  }))

  return (
    <>
      <PageHeader
        title="发放权益"
        description="为用户发放经验值、贡献值或玩家权益"
        actions={<Button icon={<ArrowLeftOutlined />} disabled={submitting} onClick={() => void navigate({ to: '/entitlements' })}>返回权益流水</Button>}
      />
      <Card style={{ maxWidth: 720 }}>
        <Alert
          type="info"
          showIcon
          title="手动发放规则"
          description="经验值与贡献值按正整数发放，服务端入账后立即生效。玩家会籍在现有有效期内追加时长：仅追加、不绑定订单、提交后不可撤销，请核对线下凭据后再发放。"
          style={{ marginBottom: 24 }}
        />
        <Form form={form} layout="vertical" initialValues={{ type: 'EXPERIENCE' }} onFinish={values => void submit(values)} onValuesChange={changed => {
          // 切换权益类型后，上一类型的数值输入不再具有含义，清空防止误提交。
          if (changed.type) { form.setFieldsValue({ amount: undefined, durationMonths: undefined }) }
        }}>
          <Form.Item name="userId" label="用户" rules={[{ required: true, message: '请选择用户' }]}>
            {demoMode ? (
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择演示用户"
                options={demo.users.map(user => ({ value: user.id, label: `${user.name}（${user.id}）` }))}
              />
            ) : (
              <SessionUserSelect placeholder="搜索姓名或简介" />
            )}
          </Form.Item>
          <Form.Item name="type" label="权益类型" rules={[{ required: true }]}>
            <Radio.Group options={typeOptions} optionType="button" buttonStyle="solid" />
          </Form.Item>
          {isMembership ? <Form.Item name="durationMonths" label="会员时长" rules={[{ required: true, message: '请选择会员时长' }]}>
            <Radio.Group options={DURATION_OPTIONS} optionType="button" />
          </Form.Item> : <Form.Item name="amount" label="发放数值" rules={[{ required: true, message: '请输入正整数' }]}>
            <InputNumber min={1} precision={0} style={{ width: 200 }} placeholder="正整数" aria-label="发放数值" />
          </Form.Item>}
          <Form.Item name="reason" label="发放原因" rules={[{ required: true, max: 300, message: '请填写发放原因（不超过 300 字）' }]}>
            <Input.TextArea rows={3} maxLength={300} placeholder="记录本次发放的线下依据，会随权益流水一并留痕" />
          </Form.Item>
          {isMembership && !demoMode && Boolean(userId) ? (
            membership.isPending ? <Space><Spin size="small" /><Typography.Text type="secondary">正在读取会员链版本</Typography.Text></Space>
              : membership.isError || chainVersion === undefined ? <Alert type="warning" showIcon title="未能读取该用户的会员链版本（可能尚未建立会员链），请从用户档案确认后再试。" style={{ marginBottom: 16 }} />
                : <Typography.Text type="secondary">会员链版本：{chainVersion}（提交后由服务端校验）</Typography.Text>
          ) : null}
          <Space size={12} style={{ marginTop: 24 }}>
            <Button type="primary" htmlType="submit" loading={submitting} disabled={membershipBlocked}>确认发放</Button>
            <Button disabled={submitting} onClick={() => void navigate({ to: '/entitlements' })}>取消</Button>
          </Space>
        </Form>
      </Card>
    </>
  )
}
