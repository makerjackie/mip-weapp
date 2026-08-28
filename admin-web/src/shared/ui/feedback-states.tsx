import { InboxOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Result, Skeleton } from 'antd'
import type { ReactNode } from 'react'

export function LoadingState({ rows = 5, label = '正在加载' }: { rows?: number; label?: string }) {
  return <section className="state-panel" aria-label={label} aria-busy="true"><Skeleton active paragraph={{ rows }} /></section>
}

export function EmptyState({ title = '暂无数据', description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <section className="state-panel">
      <Empty image={<InboxOutlined className="empty-state-icon" />} description={<><strong>{title}</strong>{description ? <span>{description}</span> : null}</>}>
        {action}
      </Empty>
    </section>
  )
}

export function ErrorState({ title = '数据暂时无法加载', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <Alert
      className="state-panel"
      type="error"
      showIcon
      icon={<WarningOutlined />}
      message={title}
      description={description || '请检查网络后重试。'}
      action={onRetry ? <Button icon={<ReloadOutlined />} onClick={onRetry}>重试</Button> : undefined}
    />
  )
}

export function ForbiddenState() {
  return <Result status="403" title="权限不足" subTitle="当前运营账号不能访问此页面。" />
}
