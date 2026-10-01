import { App, Button, Modal, Space, Typography } from 'antd'
import { useState } from 'react'
import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'

interface CheckinQrcodeResult {
  eventId: string
  mode: 'STATIC' | 'ROTATING'
  validUntil: string | null
  qrCodeDataUrl: string
}

export function CheckinQrcodeButton({ eventId, request, hasCapability }: {
  eventId: string
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
  hasCapability: (capability: string) => boolean
}) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [image, setImage] = useState<CheckinQrcodeResult | null>(null)
  if (!hasCapability('events.checkin.manage')) return null
  const load = async () => {
    setLoading(true)
    try {
      const result = await request<CheckinQrcodeResult>('mip.admin.events.checkinQrcode.get', { eventId })
      // The service returns an inline PNG/JPEG. Chrome blocks top-level data URL navigation.
      if (result?.eventId !== eventId || typeof result.qrCodeDataUrl !== 'string'
        || result.qrCodeDataUrl.length > 2_000_000
        || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.qrCodeDataUrl)) {
        throw new Error('签到二维码暂不可用，请稍后重试')
      }
      setImage(result)
    }
    catch (reason) {
      void message.error(reason instanceof Error ? reason.message : '签到二维码获取失败')
    }
    finally { setLoading(false) }
  }
  return <>
    <Button loading={loading} onClick={() => void load()}>签到二维码</Button>
    <Modal title="活动签到二维码" open={Boolean(image)} onCancel={() => setImage(null)} footer={null} destroyOnHidden>
      {image && <Space direction="vertical" align="center" className="field-full-width">
        <img className="event-checkin-qr" src={image.qrCodeDataUrl} alt="本场活动签到二维码" />
        <Typography.Text type="secondary">请使用微信扫码签到，报名资格由服务端核验。</Typography.Text>
        {image.validUntil && <Typography.Text type="secondary">有效期至 {new Date(image.validUntil).toLocaleString('zh-CN')}</Typography.Text>}
        <Button type="primary" href={image.qrCodeDataUrl} download={`活动签到码-${eventId}.${image.qrCodeDataUrl.startsWith('data:image/png;') ? 'png' : 'jpg'}`}>下载签到码</Button>
      </Space>}
    </Modal>
  </>
}
