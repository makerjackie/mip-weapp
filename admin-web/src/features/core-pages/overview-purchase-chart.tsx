import { theme } from 'antd'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdminOverviewPlayerTrendMonth } from '../../domain/contracts'

const GRADIENT_ID = 'overview-player-trend-fill'

function formatMonth(value: unknown) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''))
  return match ? `${Number(match[2])}月` : String(value || '')
}

export default function OverviewPurchaseChart({ months }: { months: AdminOverviewPlayerTrendMonth[] }) {
  const { token } = theme.useToken()
  return <div className="overview-chart" role="region" aria-label="会籍购买与续费按月趋势图">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart data={months} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={token.colorPrimary} stopOpacity={0.24} />
            <stop offset="100%" stopColor={token.colorPrimary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={token.colorBorderSecondary} />
        <XAxis dataKey="month" tickFormatter={formatMonth} minTickGap={24} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis width={48} allowDecimals={false} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip labelFormatter={formatMonth} formatter={value => `${value} 人`} contentStyle={{ borderRadius: token.borderRadius, borderColor: token.colorBorderSecondary }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Area dataKey="newPlayers" name="本月新增玩家（首次购买）" stroke={token.colorPrimary} strokeWidth={2} fill={`url(#${GRADIENT_ID})`} isAnimationActive={false} />
        <Line dataKey="firstRenewal" name="首年续费" stroke={token.colorSuccess} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="nextRenewal" name="次年续费" stroke={token.colorWarning} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
}
