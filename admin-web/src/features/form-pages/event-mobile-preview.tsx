import { Button, Card, Image, Tag, Typography } from 'antd'
import { CalendarOutlined, EnvironmentOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons'
import { useMediaPreview } from '../../shared/ui/media-preview-context'
import { formatDateTime } from '../../modules/admin-read-formatters'

export function EventMobilePreview({ values }: { values: Record<string, unknown> }) {
  const { urls } = useMediaPreview()
  const title = String(values.title || '活动名称')
  const coverUrl = urls[String(values.coverAssetId || '')]
  const media = Array.isArray(values.contentMedia) ? values.contentMedia : []
  const fields = Array.isArray(values.registrationSchema) ? values.registrationSchema : []
  const accessType = String(values.accessType || 'FREE')
  return <div className="event-mobile-preview">
    {coverUrl ? <Image src={coverUrl} alt="活动封面" width="100%" /> : <div className="event-mobile-preview__cover">{values.coverAssetId ? '封面暂不可预览' : '尚未选择活动封面'}</div>}
    <div style={{ padding: 16 }}>
      <Typography.Title level={4}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">{String(values.summary || '')}</Typography.Paragraph>
      <p><CalendarOutlined /> {formatDateTime(values.startsAt)} ～ {formatDateTime(values.endsAt)}</p>
      <p><EnvironmentOutlined /> {[values.cityName, values.venueName, values.address].filter(Boolean).join(' · ') || '地点待填写'}</p>
      <p><WalletOutlined /> {accessType === 'FREE' ? '免费' : accessType === 'MEMBER_INCLUDED' ? '会员权益' : `¥${(Number(values.priceCents || 0) / 100).toFixed(2)}`}</p>
      {values.capacity ? <p><TeamOutlined /> 名额 {String(values.capacity)}</p> : null}
      {values.registrationDeadline ? <p>报名截止：{formatDateTime(values.registrationDeadline)}</p> : null}
      {values.cancellationDeadline ? <p>取消截止：{formatDateTime(values.cancellationDeadline)}</p> : null}
      {typeof values.onlineUrl === 'string' && /^https:\/\//.test(values.onlineUrl) ? <p><a href={values.onlineUrl} target="_blank" rel="noopener noreferrer">线上活动 / 场地链接</a></p> : null}
      <Card size="small" title="活动介绍"><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{String(values.description || '')}</Typography.Paragraph>
        {media.map((item, index) => {
          const asset = item && typeof item === 'object' ? item as Record<string, unknown> : {}
          const url = urls[String(asset.assetId || '')]
          return <figure key={String(asset.assetId || index)} style={{ margin: '12px 0' }}>{url ? <Image src={url} width="100%" alt={String(asset.caption || '活动正文图片')} /> : <p>图片暂不可预览</p>}{asset.caption ? <figcaption>{String(asset.caption)}</figcaption> : null}</figure>
        })}
      </Card>
      {values.notices ? <Card size="small" title="报名须知" style={{ marginTop: 12 }}><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{String(values.notices)}</Typography.Paragraph></Card> : null}
      {fields.length ? <Card size="small" title="报名需填写" style={{ marginTop: 12 }}>{fields.map((item, index) => {
        const field = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return <p key={String(field.key || index)}>{String(field.label || '')} {field.required ? <Tag>必填</Tag> : null}{Array.isArray(field.options) ? <small>{field.options.join(' / ')}</small> : null}</p>
      })}</Card> : null}
      <Button block disabled style={{ marginTop: 16 }}>预览模式不可报名</Button>
    </div>
  </div>
}
