import { Card, Tag, Typography } from 'antd'

export function EventMobilePreview({ values }: { values: Record<string, unknown> }) {
  const title = String(values.title || '活动名称')
  const summary = String(values.summary || '')
  const startsAt = String(values.startsAt || '')
  const endsAt = String(values.endsAt || '')
  const venueName = String(values.venueName || '')
  const address = String(values.address || '')
  const accessType = String(values.accessType || 'FREE')
  const priceCents = Number(values.priceCents || 0)
  const capacity = Number(values.capacity || 0)
  const description = String(values.description || '')
  const notices = String(values.notices || '')
  const eventTypeKey = String(values.eventTypeKey || '')
  const coverAssetId = String(values.coverAssetId || '')

  return (
    <div style={{ width: 375, margin: '0 auto', background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e8e8e8' }}>
      {coverAssetId ? (
        <div style={{ height: 200, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={`/api/media/${coverAssetId}`} alt="封面" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
      ) : (
        <div style={{ height: 200, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>活动封面预览</div>
      )}
      <div style={{ padding: '16px' }}>
        {eventTypeKey ? <Tag color="blue" style={{ marginBottom: 8 }}>{eventTypeKey}</Tag> : null}
        <Typography.Title level={4} style={{ marginBottom: 8 }}>{title}</Typography.Title>
        {summary ? <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>{summary}</Typography.Paragraph> : null}
        <div style={{ marginBottom: 8, color: '#666', fontSize: 14 }}>
          <div>📅 {startsAt}{endsAt ? ` ~ ${endsAt}` : ''}</div>
          {venueName ? <div>📍 {venueName}{address ? ` · ${address}` : ''}</div> : null}
          <div>🎫 {accessType === 'FREE' ? '免费' : accessType === 'MEMBER_INCLUDED' ? '会员权益' : `¥${(priceCents / 100).toFixed(2)}`}</div>
          {capacity > 0 ? <div>👥 名额 {capacity}</div> : null}
        </div>
        {description ? (
          <Card size="small" title="活动介绍" style={{ marginBottom: 12 }}>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{description}</Typography.Paragraph>
          </Card>
        ) : null}
        {notices ? (
          <Card size="small" title="报名须知" style={{ marginBottom: 12 }}>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{notices}</Typography.Paragraph>
          </Card>
        ) : null}
        <button disabled style={{ width: '100%', padding: '12px', background: '#ccc', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'not-allowed' }}>
          预览模式不可报名
        </button>
      </div>
    </div>
  )
}
