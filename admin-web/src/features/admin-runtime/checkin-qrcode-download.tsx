import { App, Button } from 'antd'
import { useState } from 'react'
import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'

export type CheckinQrcodeMode = 'STATIC' | 'ROTATING'

export interface CheckinQrcodeResult {
  eventId: string
  mode: CheckinQrcodeMode
  validUntil: string | null
  qrCodeDataUrl: string
}

/**
 * 校验服务端返回的签到码：必须是本活动的内联 PNG/JPEG data URL 且体积受限。
 * Chrome 禁止顶层 data URL 导航，二维码只能经 <img> 预览或下载锚点使用。
 */
export function isCheckinQrcodeResult(result: unknown, eventId: string): result is CheckinQrcodeResult {
  if (!result || typeof result !== 'object') return false
  const value = result as Partial<CheckinQrcodeResult>
  return value.eventId === eventId
    && typeof value.qrCodeDataUrl === 'string'
    && value.qrCodeDataUrl.length <= 2_000_000
    && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.qrCodeDataUrl)
}

export async function fetchCheckinQrcode(
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>,
  eventId: string,
  mode: CheckinQrcodeMode,
): Promise<CheckinQrcodeResult> {
  const result = await request<CheckinQrcodeResult>('mip.admin.events.checkinQrcode.get', { eventId, mode })
  if (!isCheckinQrcodeResult(result, eventId)) throw new Error('签到二维码暂不可用，请稍后重试')
  return result
}

export function checkinQrcodeFileName(result: CheckinQrcodeResult) {
  return `活动签到码-${result.eventId}.${result.qrCodeDataUrl.startsWith('data:image/png;') ? 'png' : 'jpg'}`
}

/** 用一次性锚点触发浏览器下载；数据 URL 不能走顶层导航。 */
export function downloadCheckinQrcodeImage(result: CheckinQrcodeResult) {
  const anchor = document.createElement('a')
  anchor.href = result.qrCodeDataUrl
  anchor.download = checkinQrcodeFileName(result)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 活动列表行内的快捷下载入口：固定取静态码并立即下载。
 * 短时码 5 分钟失效且刷新即作废，不适合离线下载，需要短时码时走详情抽屉。
 */
export function CheckinQrcodeDownloadLink({ eventId, request }: {
  eventId: string
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
}) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const download = async () => {
    setLoading(true)
    try {
      downloadCheckinQrcodeImage(await fetchCheckinQrcode(request, eventId, 'STATIC'))
    }
    catch (reason) {
      void message.error(reason instanceof Error ? reason.message : '签到二维码获取失败')
    }
    finally {
      setLoading(false)
    }
  }
  return (
    <Button type="link" size="small" loading={loading} onClick={() => void download()}>下载签到二维码</Button>
  )
}
