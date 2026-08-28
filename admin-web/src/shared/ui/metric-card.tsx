import { Card } from 'antd'
import type { ReactNode } from 'react'

export function MetricCard({ label, value, detail, icon, trend }: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  trend?: 'up' | 'down' | 'neutral'
}) {
  return (
    <Card className="metric-card" variant="borderless">
      <div className="metric-card__top">
        <span>{label}</span>
        {icon ? <i aria-hidden="true">{icon}</i> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <small data-trend={trend ?? 'neutral'}>{detail}</small> : null}
    </Card>
  )
}
