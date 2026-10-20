import { useEffect, useState } from 'react'
import {
  CalendarOutlined,
  CompassOutlined,
  CustomerServiceOutlined,
  DownOutlined,
  EnvironmentOutlined,
  ShareAltOutlined,
} from '@ant-design/icons'
import { useAdminSession } from '../../app/session-provider'
import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'
import { useMediaPreview } from '../../shared/ui/media-preview-context'
import { useCloudImageTempUrls } from '../../shared/ui/cloud-image-temp-urls'
import { sanitizeRichTextHtml } from '../../shared/ui/rich-text-sanitize'
import { normalizeRichTextToHtml, richTextIsEmpty } from '../../modules/rich-text-html'
import {
  eventAccessChipLabel,
  eventDetailLocationText,
  eventDetailTimeText,
  eventPriceText,
  miniEventTypeLabel,
  substituteRichTextCloudImages,
} from '../../modules/event-detail-preview'

type PreviewSection = 'INTRO' | 'ORGANIZER' | 'NOTICE'

const SECTION_LABELS: Record<PreviewSection, string> = {
  INTRO: '活动介绍',
  ORGANIZER: '主办方',
  NOTICE: '报名须知',
}

/** 安全会话访问：单元测试在无 SessionProvider 的树里直接渲染预览。 */
function useOptionalAdminSession() {
  try {
    return useAdminSession()
  }
  catch {
    return null
  }
}

/**
 * 已按受限 HTML 白名单净化（富文本规范化 + DOMPurify），无脚本/事件/危险协议。
 * 插图的 cloud:// 稳定引用在渲染前换成可显示地址：本会话上传的素材走 mediaUrls
 * （media-preview 临时地址），存量引用走 mip.admin.media.tempUrls 只读解析
 * （600s https 直链，MIW-125）；两者都换不到的出诚实占位。
 */
function RichHtml({ value, mediaUrls }: { value: unknown, mediaUrls: Record<string, string> }) {
  const raw = String(value || '')
  if (richTextIsEmpty(raw)) return null
  const html = substituteRichTextCloudImages(
    sanitizeRichTextHtml(normalizeRichTextToHtml(raw)),
    fileId => mediaUrls[fileId] || '',
  )
  return <div className="event-mobile-preview__rich" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * 高保真手机预览：按小程序「活动详情」页（figma 1861_17860 / 1818_17142）逐段还原
 * 深色版式——封面、信息卡（角标/标题/时间/地点 + 指引与价格位）、参与人数卡、
 * 内容分区页签、进入线上活动与吸底玻璃操作条。样式值全部换算自小程序 rpx（1rpx=0.5px）。
 */
export function EventMobilePreview({
  values,
  tagLabels = [],
  branchName = '',
  typeLabel = '',
}: {
  values: Record<string, unknown>
  /** 已解析的活动标签名称（目录 id → 名称）；解析失败的 id 不展示。 */
  tagLabels?: string[]
  /** 已解析的分会名称；解析失败不展示角标。 */
  branchName?: string
  /** 目录 TYPE 解析出的活动类型名；空值回落到内置映射。 */
  typeLabel?: string
}) {
  const { urls } = useMediaPreview()
  const session = useOptionalAdminSession()
  // 编辑会话之外的存量 cloud:// 引用批量解析；失败保持占位，不阻断预览。
  const cloudImages = useCloudImageTempUrls(
    [values.description, values.organizerIntroduction, values.notices].map(item => String(item || '')).join('\n'),
    session?.client,
    session?.demoMode ?? false,
  )
  const [section, setSection] = useState<PreviewSection>('INTRO')

  const title = String(values.title || '')
  const coverUrl = urls[String(values.coverAssetId || '')]
  const media = Array.isArray(values.contentMedia) ? values.contentMedia : []
  const accessType = String(values.accessType || 'FREE')
  const isPaid = accessType === 'PAID'
  const timeText = eventDetailTimeText(values.startsAt, values.endsAt) || '时间待填写'
  const locationText = eventDetailLocationText(values)
  const priceText = eventPriceText(values.priceCents)
  const capacity = Number(values.capacity)
  const hasCapacity = Number.isInteger(capacity) && capacity > 0
  const eventMode = String(values.eventMode || '')
  const onlineUrl = /^https:\/\//.test(String(values.onlineUrl || '')) ? String(values.onlineUrl) : ''
  const guideUrl = /^https:\/\//.test(String(values.guideUrl || '')) ? String(values.guideUrl) : ''
  const descriptionRaw = String(values.description || '')
  const descriptionEmpty = richTextIsEmpty(descriptionRaw)
  const organizerEmpty = richTextIsEmpty(String(values.organizerIntroduction || ''))
  const noticesEmpty = richTextIsEmpty(String(values.notices || ''))
  const schemaFields = Array.isArray(values.registrationSchema) ? values.registrationSchema : []
  const richMediaUrls = { ...urls, ...cloudImages }

  return (
    <div className="event-mobile-preview-wrap">
      <div className="event-mobile-preview">
        <div className="event-mobile-preview__screen">
          {coverUrl
            ? <img className="event-mobile-preview__cover" src={coverUrl} alt="活动封面" />
            : (
              <div className="event-mobile-preview__cover-fallback">
                <CalendarOutlined className="event-mobile-preview__cover-icon" aria-hidden="true" />
                {/* 素材已选但临时地址未取到时如实说明，不装作没有封面。 */}
                {values.coverAssetId ? <span className="event-mobile-preview__cover-note">封面图片暂不可预览</span> : null}
              </div>
            )}

          <div className="event-mobile-preview__body">
            <div className="event-mobile-preview__card event-mobile-preview__info">
              <div className="event-mobile-preview__info-main">
                <div className="event-mobile-preview__chips">
                  <span className="event-mobile-preview__chip event-mobile-preview__chip--type">{typeLabel || miniEventTypeLabel(values.eventTypeKey)}</span>
                  <span className="event-mobile-preview__chip event-mobile-preview__chip--access">{eventAccessChipLabel(accessType, values.memberFree === true)}</span>
                  {branchName ? <span className="event-mobile-preview__chip">{branchName}</span> : null}
                  {tagLabels.map(label => <span key={label} className="event-mobile-preview__chip">{label}</span>)}
                </div>
                <div className="event-mobile-preview__title" title={title}>{title || '（未填写活动名称）'}</div>
                <div className="event-mobile-preview__meta-row">
                  <CalendarOutlined className="event-mobile-preview__meta-icon" aria-hidden="true" />
                  <span className="event-mobile-preview__meta-text">{timeText}</span>
                </div>
                <div className="event-mobile-preview__meta-row event-mobile-preview__meta-row--location">
                  <EnvironmentOutlined className="event-mobile-preview__meta-icon" aria-hidden="true" />
                  <span className="event-mobile-preview__meta-text">{locationText}</span>
                </div>
              </div>
              <div className="event-mobile-preview__info-aside">
                {guideUrl ? (
                  <a className="event-mobile-preview__guide" href={guideUrl} target="_blank" rel="noopener noreferrer">
                    <CompassOutlined className="event-mobile-preview__guide-icon" aria-hidden="true" />
                    <span className="event-mobile-preview__guide-label">指引</span>
                  </a>
                ) : null}
                {isPaid && priceText ? (
                  <div className="event-mobile-preview__price">
                    <span className="event-mobile-preview__price-symbol">¥</span>
                    <span className="event-mobile-preview__price-amount">{priceText}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* 预览时活动尚未创建，没有真实报名数据；按详情页空态如实展示，不伪造参与人。 */}
            <div className="event-mobile-preview__card event-mobile-preview__participants">
              <div className="event-mobile-preview__participants-header">
                <span className="event-mobile-preview__participants-count">
                  参与人数0{hasCapacity ? <span className="event-mobile-preview__participants-capacity">/{capacity}</span> : null}
                </span>
                <span className="event-mobile-preview__participants-more">
                  查看更多
                  <DownOutlined className="event-mobile-preview__participants-chevron" aria-hidden="true" />
                </span>
              </div>
              <p className="event-mobile-preview__participants-empty">暂无公开参与者资料</p>
            </div>

            <div className="event-mobile-preview__tabs" role="tablist" aria-label="详情内容分区">
              {(Object.keys(SECTION_LABELS) as PreviewSection[]).map(key => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={section === key}
                  className={`event-mobile-preview__tab${section === key ? ' is-active' : ''}`}
                  onClick={() => setSection(key)}
                >
                  {SECTION_LABELS[key]}
                </button>
              ))}
            </div>

            {section === 'INTRO' ? (
              <div className="event-mobile-preview__card event-mobile-preview__section">
                <RichHtml value={values.description} mediaUrls={richMediaUrls} />
                {media.length ? (
                  <div className={`event-mobile-preview__media${descriptionEmpty ? '' : ' event-mobile-preview__media--after-text'}`}>
                    {media.map((item, index) => {
                      const asset = item && typeof item === 'object' ? item as Record<string, unknown> : {}
                      const url = urls[String(asset.assetId || '')]
                      return (
                        <figure key={String(asset.assetId || index)} className="event-mobile-preview__media-item">
                          {url
                            ? <img src={url} alt={String(asset.caption || '活动正文图片')} />
                            : <div className="event-mobile-preview__media-missing">图片暂不可预览</div>}
                          {asset.caption ? <figcaption className="event-mobile-preview__media-caption">{String(asset.caption)}</figcaption> : null}
                        </figure>
                      )
                    })}
                  </div>
                ) : null}
                {descriptionEmpty && !media.length ? <p className="event-mobile-preview__empty-block">暂无活动介绍。</p> : null}
              </div>
            ) : (
              <div className="event-mobile-preview__card event-mobile-preview__section event-mobile-preview__section--padded">
                {section === 'ORGANIZER'
                  ? (organizerEmpty ? <p className="event-mobile-preview__empty-block">暂无主办方介绍。</p> : <RichHtml value={values.organizerIntroduction} mediaUrls={richMediaUrls} />)
                  : (noticesEmpty ? <p className="event-mobile-preview__empty-block">暂无报名须知。</p> : <RichHtml value={values.notices} mediaUrls={richMediaUrls} />)}
              </div>
            )}

            {['ONLINE', 'HYBRID'].includes(eventMode) && onlineUrl ? (
              <a className="event-mobile-preview__online" href={onlineUrl} target="_blank" rel="noopener noreferrer">进入线上活动</a>
            ) : null}
          </div>

          {/* 吸底操作条：预览不可交互（aria-hidden），只还原样式；真实报名在小程序内完成。 */}
          <div className="event-mobile-preview__bottombar" aria-hidden="true">
            <span className="event-mobile-preview__dock-action" title="联系客服（样式示意）">
              <span className="event-mobile-preview__dock-surface"><CustomerServiceOutlined className="event-mobile-preview__dock-icon" /></span>
            </span>
            <span className="event-mobile-preview__dock-action" title="分享活动（样式示意）">
              <span className="event-mobile-preview__dock-surface"><ShareAltOutlined className="event-mobile-preview__dock-icon" /></span>
            </span>
            <span className="event-mobile-preview__dock-primary" title="立刻报名（预览不可交互）">
              <span className="event-mobile-preview__dock-primary-surface">立刻报名</span>
            </span>
          </div>
        </div>
      </div>

      {schemaFields.length ? (
        <div className="event-mobile-preview__schema-note">
          <div className="event-mobile-preview__schema-title">报名页收集字段（详情页不展示）</div>
          <ul className="event-mobile-preview__schema-list">
            {schemaFields.map((item, index) => {
              const field = item && typeof item === 'object' ? item as Record<string, unknown> : {}
              const options = Array.isArray(field.options) ? field.options.join(' / ') : ''
              return (
                <li key={String(field.key || index)}>
                  {String(field.label || '')}
                  {field.required ? '（必填）' : ''}
                  {options ? `：${options}` : ''}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

interface CatalogNames { tagLabels: Record<string, string>, branchNames: Record<string, string>, typeNames: Record<string, string> }

const EMPTY_CATALOG_NAMES: CatalogNames = { tagLabels: {}, branchNames: {}, typeNames: {} }

/** 与表单目录控件同一批只读动作；全量翻页（封顶 100）后归约为 id/key → 名称。 */
async function loadCatalogNames(
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>,
  action: AdminOperationAction,
  input: AdminRequestInput,
  valueKey: string,
): Promise<Record<string, string>> {
  let payload = await request<Record<string, unknown>>(action, input)
  const items: unknown[] = Array.isArray(payload?.items) ? [...payload.items] : []
  const seen = new Set<string>()
  while (payload && typeof payload === 'object' && payload.nextCursor && seen.size < 100) {
    const cursor = String(payload.nextCursor)
    if (seen.has(cursor)) break
    seen.add(cursor)
    payload = await request<Record<string, unknown>>(action, { ...input, cursor })
    if (Array.isArray(payload?.items)) items.push(...payload.items)
  }
  const names: Record<string, string> = {}
  for (const item of items) {
    if (!item || typeof item === 'object') continue
    const entry = item as Record<string, unknown>
    const key = String(entry[valueKey] || entry.id || '')
    const name = String(entry.name || entry.label || '')
    if (key && name) names[key] = name
  }
  return names
}

/**
 * 预览容器：解析角标所需的目录名称（标签 / 活动类型 / 分会），失败时静默降级
 * （少一枚角标），不阻断预览。演示模式目录值本身就是名称，跳过解析。
 */
export function EventMobilePreviewWithData({ values }: { values: Record<string, unknown> }) {
  const { request, demoMode } = useAdminSession()
  const tagIds = Array.isArray(values.tagIds) ? values.tagIds.map(id => String(id || '').trim()).filter(Boolean) : []
  const eventTypeKey = String(values.eventTypeKey || '').trim()
  const branchId = String(values.scopeType) === 'BRANCH' ? String(values.branchId || '').trim() : ''
  const tagKey = tagIds.join(',')
  const [names, setNames] = useState<CatalogNames>(EMPTY_CATALOG_NAMES)

  useEffect(() => {
    if (demoMode) return
    let active = true
    const timer = setTimeout(() => {
      if (tagKey) {
        void loadCatalogNames(request, 'mip.admin.events.catalog.list', { kind: 'TAG', selectable: true }, 'id')
          .then(tagLabels => { if (active) setNames(current => ({ ...current, tagLabels })) }).catch(() => {})
      }
      if (branchId) {
        void loadCatalogNames(request, 'mip.admin.branches.list', { purpose: 'EVENT_EDIT' }, 'id')
          .then(branchNames => { if (active) setNames(current => ({ ...current, branchNames })) }).catch(() => {})
      }
      if (eventTypeKey) {
        void loadCatalogNames(request, 'mip.admin.events.catalog.list', { kind: 'TYPE', selectable: true }, 'key')
          .then(typeNames => { if (active) setNames(current => ({ ...current, typeNames })) }).catch(() => {})
      }
    }, 0)
    return () => { active = false; clearTimeout(timer) }
  }, [request, demoMode, tagKey, branchId, eventTypeKey])

  const branchName = branchId ? names.branchNames[branchId] || (demoMode ? branchId : '') : ''
  return (
    <EventMobilePreview
      values={values}
      branchName={branchName}
      tagLabels={tagIds.map(id => names.tagLabels[id] || (demoMode ? id : '')).filter(Boolean)}
      typeLabel={demoMode ? '' : names.typeNames[eventTypeKey] || ''}
    />
  )
}
