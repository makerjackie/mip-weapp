import { DownloadOutlined } from '@ant-design/icons'
import { App, Button, Checkbox, Descriptions, Modal, Progress, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import {
  continueSensitiveExport,
  createSensitiveExportWorkflow,
  disposeSensitiveExportSecrets,
  type SensitiveExportKind,
  type SensitiveExportProgress,
  type SensitiveExportWorkflow,
} from '../../modules/admin-sensitive-export'

const progressText: Record<SensitiveExportProgress, string> = {
  creating: '正在创建导出票据',
  preparing: '正在生成导出文件',
  checking: '正在检查导出状态',
  downloading: '正在下载并校验文件',
  completing: '正在完成一次性下载',
  saving: '正在保存文件',
}

const progressPercent: Record<SensitiveExportProgress, number> = {
  creating: 12,
  preparing: 30,
  checking: 46,
  downloading: 66,
  completing: 84,
  saving: 96,
}

export function SensitiveExportButton({ kind, query, status, open: controlledOpen, hideTrigger = false, onOpenChange }: {
  kind: SensitiveExportKind
  query: string
  status: string
  open?: boolean
  hideTrigger?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { message } = App.useApp()
  const { demoMode, hasCapability, request } = useAdminSession()
  const [internalOpen, setInternalOpen] = useState(false)
  const [includesPhone, setIncludesPhone] = useState(false)
  const [progress, setProgress] = useState<SensitiveExportProgress | null>(null)
  const [workflow, setWorkflow] = useState<SensitiveExportWorkflow | null>(null)
  const [error, setError] = useState('')
  const loading = Boolean(progress)
  const open = controlledOpen ?? internalOpen

  useEffect(() => () => { if (workflow) disposeSensitiveExportSecrets(workflow) }, [workflow])
  if (!hasCapability('exports.create')) return null

  const close = () => {
    if (loading) return
    if (workflow) disposeSensitiveExportSecrets(workflow)
    setInternalOpen(false)
    onOpenChange?.(false)
    setWorkflow(null)
    setProgress(null)
    setError('')
  }

  const submit = async () => {
    if (demoMode) {
      void message.info('演示模式不会创建或下载敏感数据导出')
      close()
      return
    }
    const next = workflow || createSensitiveExportWorkflow({
      kind,
      filters: { query: query || undefined, status: status || undefined },
      includesPhone: kind === 'users' && includesPhone,
    })
    setWorkflow(next)
    setError('')
    try {
      const result = await continueSensitiveExport(next, request, { onProgress: setProgress })
      setProgress(null)
      void message.success(`已保存 ${result.fileName}，共 ${result.rowCount} 条`)
      close()
    }
    catch (reason) {
      setProgress(null)
      setError(reason instanceof Error ? reason.message : '导出结果暂时无法确认')
    }
  }

  return (
    <>
      {!hideTrigger ? (
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => { setInternalOpen(true); onOpenChange?.(true) }}>
          {kind === 'users' ? '导出用户' : '导出订单'}
        </Button>
      ) : null}
      <Modal
        open={open}
        title="敏感数据导出"
        okText={workflow ? '继续导出' : '创建导出'}
        cancelText="取消"
        confirmLoading={loading}
        mask={{ closable: !loading }}
        keyboard={!loading}
        onOk={() => void submit()}
        onCancel={close}
      >
        <Space orientation="vertical" size={16} className="field-full-width">
          <Typography.Paragraph type="secondary">
            导出范围与当前列表筛选一致，服务端会再次校验运营权限和数据范围。
          </Typography.Paragraph>
          <Descriptions size="small" column={1} bordered items={[
            { key: 'query', label: '筛选关键词', children: query || '全部' },
            { key: 'status', label: '状态', children: status || '全部' },
          ]} />
          {kind === 'users' ? (
            <Checkbox checked={includesPhone} disabled={Boolean(workflow)} onChange={event => setIncludesPhone(event.target.checked)}>
              包含手机号（仅导出当前账号有权查看的手机号）
            </Checkbox>
          ) : null}
          {progress ? <Progress percent={progressPercent[progress]} status="active" format={() => progressText[progress]} /> : null}
          {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
        </Space>
      </Modal>
    </>
  )
}
