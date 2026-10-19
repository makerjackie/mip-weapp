/**
 * 小程序活动详情页的展示推导（高保真预览用）。
 *
 * 逐条对齐小程序端会员区活动详情页脚本与日期工具的展示口径
 * （时间折叠、地点拼接、费用角标、价格显示）。这里只做纯函数推导，
 * 不发请求、不依赖 React；目录/分会名称解析由预览容器组件负责。
 */

const MINI_EVENT_TYPE_LABELS: Record<string, string> = {
  community: '社区活动',
  mip_morning_meeting: 'MIP 早会',
  // 后台未选类型时服务端落库的默认 key；对用户展示为普通「活动」。
  general: '活动',
}

const technicalKeyPattern = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/

/** 与小程序 publicEventTypeLabel 同口径：目录 key 不直出，回落为「活动」。 */
export function miniEventTypeLabel(value: unknown): string {
  const key = String(value || '').trim()
  if (!key) return '活动'
  return MINI_EVENT_TYPE_LABELS[key] || (technicalKeyPattern.test(key) ? '活动' : key)
}

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalTime(date: Date) {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

function formatChineseMonthDay(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatChineseMonthDayTime(value: unknown) {
  const date = validDate(value)
  return date ? `${formatChineseMonthDay(date)} ${formatLocalTime(date)}` : ''
}

/** 与小程序 compactEventTime 同口径：同日折叠为「M月D日 HH:mm-HH:mm」。 */
export function compactEventTime(startsAt: unknown, endsAt: unknown): string {
  const start = validDate(startsAt)
  const end = validDate(endsAt)
  if (!start || !end) return ''
  const startDay = formatChineseMonthDay(start)
  const endDay = formatChineseMonthDay(end)
  return startDay === endDay
    ? `${startDay} ${formatLocalTime(start)}-${formatLocalTime(end)}`
    : `${formatChineseMonthDayTime(startsAt)} 至 ${formatChineseMonthDayTime(endsAt)}`
}

/** 详情页日期行文案：折叠区间优先，缺失时回落「Y年M月D日 HH:mm」。 */
export function eventDetailTimeText(startsAt: unknown, endsAt: unknown): string {
  const compact = compactEventTime(startsAt, endsAt)
  if (compact) return compact
  const start = validDate(startsAt)
  return start
    ? `${start.getFullYear()}年${formatChineseMonthDay(start)} ${formatLocalTime(start)}`
    : ''
}

/** 详情页地点行：城市 · 场地 · 详细地址；全空时线上活动/地点待公布兜底。 */
export function eventDetailLocationText(values: Record<string, unknown>): string {
  const parts = [values.cityName, values.venueName, values.address]
    .map(part => String(part || '').trim())
    .filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return String(values.eventMode || '') === 'ONLINE' ? '线上活动' : '地点待公布'
}

/**
 * 费用角标（figma 1861_17860）：角标说明「谁能参加」，付费金额单独展示在右上价格位。
 */
export function eventAccessChipLabel(accessType: unknown): string {
  if (accessType === 'MEMBER_INCLUDED') return '玩家活动'
  if (accessType === 'PAID') return '仅玩家'
  return '免费活动'
}

/** 价格数值：整数元不带小数（figma ¥589），非 PAID 不展示价格位。 */
export function eventPriceText(priceCents: unknown): string {
  const cents = Number(priceCents)
  if (!Number.isFinite(cents)) return ''
  const value = cents / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * 富文本插图是 cloud:// 稳定引用（浏览器无法直接显示）。渲染前把已拿到可看地址的
 * 引用换成该地址；解析不到的整块换成诚实占位，不让浏览器渲染必然裂图的直链。
 * 输入必须是已净化（sanitizeRichTextHtml 之后）的受限 HTML，占位是固定字面量。
 */
export function substituteRichTextCloudImages(html: string, resolve: (fileId: string) => string): string {
  return String(html || '').replace(/<img\b[^>]*>/gi, tag => {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ''
    if (!/^cloud:\/\//i.test(src)) return tag
    const resolved = resolve(src)
    if (!resolved) return '<p class="event-mobile-preview__img-pending">插图保存后在活动页显示</p>'
    return tag.replace(/\bsrc\s*=\s*"[^"]*"/i, `src="${resolved.replace(/"/g, '%22')}"`)
  })
}
