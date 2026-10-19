import { Button, Card, Image, Tag, Typography } from 'antd'
import { CalendarOutlined, EnvironmentOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons'
import { useAdminSession } from '../../app/session-provider'
import { useMediaPreview } from '../../shared/ui/media-preview-context'
import { useCloudImageTempUrls } from '../../shared/ui/cloud-image-temp-urls'
import { sanitizeRichTextHtml } from '../../shared/ui/rich-text-sanitize'
import { normalizeRichTextToHtml, richTextIsEmpty } from '../../modules/rich-text-html'
import { substituteRichTextCloudImages } from '../../modules/admin-media-temp-urls'
import { formatDateTime } from '../../modules/admin-read-formatters'

/** 安全会话访问：单元测试在无 SessionProvider 的树里直接渲染预览。 */
function useOptionalAdminSession() {
  try {
    return useAdminSession()
  }
  catch {
    return null
  }
}

function RichHtml({ value, empty, resolved = {} }: { value: unknown, empty: string, resolved?: Record<string, string> }) {
  const raw = String(value || '')
  if (richTextIsEmpty(raw)) return <p className="event-mobile-preview__empty">{empty}</p>
  // 先替换存量 cloud:// 插图（真图/诚实占位），再按受限 HTML 白名单净化，无脚本/事件/危险协议。
  const html = sanitizeRichTextHtml(substituteRichTextCloudImages(normalizeRichTextToHtml(raw), resolved))
  return <div className="event-mobile-preview__rich" dangerouslySetInnerHTML={{ __html: html }} />
}

export function EventMobilePreview({ values }: { values: Record<string, unknown> }) {
  const session = useOptionalAdminSession()
  // 编辑会话之外的存量 cloud:// 引用批量解析；失败保持占位，不阻断预览。
  const resolvedImages = useCloudImageTempUrls(
    [values.description, values.organizerIntroduction, values.notices].map(item => String(item || '')).join('\n'),
    session?.client,
    session?.demoMode ?? false,
  )
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
      {['ONLINE', 'HYBRID'].includes(String(values.eventMode)) && typeof values.onlineUrl === 'string' && /^https:\/\//.test(values.onlineUrl) ? <p><a href={values.onlineUrl} target="_blank" rel="noopener noreferrer">线上活动链接</a></p> : null}
      <Card size="small" title="参与人" style={{ marginTop: 12 }}>
        {/* 预览时活动尚未创建，没有可展示的报名数据；这里如实说明，不伪造参与人。 */}
        <p className="event-mobile-preview__empty">报名开放后，这里会显示已报名成员。</p>
      </Card>
      <Card size="small" title="活动介绍" style={{ marginTop: 12 }}>
        <RichHtml value={values.description} empty="暂无活动介绍" resolved={resolvedImages} />
        {media.map((item, index) => {
          const asset = item && typeof item === 'object' ? item as Record<string, unknown> : {}
          const url = urls[String(asset.assetId || '')]
          return <figure key={String(asset.assetId || index)} style={{ margin: '12px 0' }}>{url ? <Image src={url} width="100%" alt={String(asset.caption || '活动正文图片')} /> : <p className="event-mobile-preview__empty">图片暂不可预览</p>}{asset.caption ? <figcaption>{String(asset.caption)}</figcaption> : null}</figure>
        })}
      </Card>
      <Card size="small" title="主办方介绍" style={{ marginTop: 12 }}>
        <RichHtml value={values.organizerIntroduction} empty="暂无主办方介绍" resolved={resolvedImages} />
      </Card>
      <Card size="small" title="报名须知" style={{ marginTop: 12 }}>
        <RichHtml value={values.notices} empty="暂无报名须知" resolved={resolvedImages} />
      </Card>
      {fields.length ? <Card size="small" title="报名需填写" style={{ marginTop: 12 }}>{fields.map((item, index) => {
        const field = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return <p key={String(field.key || index)}>{String(field.label || '')} {field.required ? <Tag>必填</Tag> : null}{Array.isArray(field.options) ? <small>{field.options.join(' / ')}</small> : null}</p>
      })}</Card> : null}
      <Button block disabled style={{ marginTop: 16 }}>预览模式不可报名</Button>
    </div>
  </div>
}
