import { BellOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { Badge, Button, Empty, Popover } from 'antd'
import { useState } from 'react'
import type { AdminRoutePath } from '../../app/navigation'

export interface AdminNotificationItem {
  key: string
  title: string
  description?: string
  target: AdminRoutePath
}

// 聚合运营待办的服务端契约尚未落地（待联调）：入口先以类型化条目承接，
// 后续由概览待办同源数据或新的待办契约注入 items，结构不变。
const sampleNotificationItems: AdminNotificationItem[] = [
  { key: 'task-approval', title: 'NPC 任务待审批', description: '任务管理 · 待审批', target: '/tasks' },
  { key: 'growth-expiring', title: '权益即将到期', description: '成长与勋章 · 30 日内到期', target: '/growth' },
  { key: 'event-payment-exception', title: '活动支付异常', description: '订单管理 · 支付异常', target: '/orders' },
]

export function AdminNotificationBell({ items = sampleNotificationItems }: { items?: AdminNotificationItem[] }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="运营通知"
      open={open}
      onOpenChange={setOpen}
      content={items.length ? (
        <div className="admin-bell__list">
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              className="admin-bell__item"
              onClick={() => { setOpen(false); void navigate({ to: item.target }) }}
            >
              <span className="admin-bell__item-title">{item.title}</span>
              {item.description ? <span className="admin-bell__item-meta">{item.description}</span> : null}
            </button>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />}
    >
      <Badge count={items.length} size="small">
        <Button type="text" aria-label="运营通知" icon={<BellOutlined />} />
      </Badge>
    </Popover>
  )
}
