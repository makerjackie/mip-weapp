import { theme } from 'antd'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdminOverviewPurchasePoint } from './overview-model'

export default function OverviewPurchaseChart({ points, mode }: { points: AdminOverviewPurchasePoint[]; mode: 'count' | 'amount' }) {
  const { token } = theme.useToken()
  const money = mode === 'amount'
  return <div className="overview-chart" role="region" aria-label={money ? '会籍实付金额趋势图（元）' : '会籍购买次数趋势图'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={points} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke={token.colorBorderSecondary} />
        <XAxis dataKey="date" tickFormatter={value => String(value).slice(5).replace('-', '/')} minTickGap={24} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis width={48} allowDecimals={money} tickFormatter={money ? value => Number(value).toFixed(2) : undefined} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value, name) => [value === null || value === undefined ? '暂无数据' : money ? `¥${Number(value).toFixed(2)}` : `${value} 次`, name]} contentStyle={{ borderRadius: token.borderRadius, borderColor: token.colorBorderSecondary }} />
        <Legend iconType="circle" itemSorter={item => ['initial', 'firstRenewal', 'repeatRenewal'].indexOf(String(item.dataKey))} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {money ? <Bar dataKey="paidAmount" name="实付金额（元）" fill={token.colorPrimary} maxBarSize={28} isAnimationActive={false} /> : <>
          <Bar dataKey="initial" name="首次购买" stackId="purchases" fill={token.colorPrimary} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="firstRenewal" name="首次续费" stackId="purchases" fill={token.colorSuccess} isAnimationActive={false} />
          <Bar dataKey="repeatRenewal" name="再次续费" stackId="purchases" fill={token.colorWarning} isAnimationActive={false} />
        </>}
      </BarChart>
    </ResponsiveContainer>
  </div>
}
