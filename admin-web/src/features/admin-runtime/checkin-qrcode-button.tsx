import { App, Button, Modal, Segmented, Space, Typography } from 'antd'
import { useState } from 'react'
import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'
import {
  checkinQrcodeFileName,
  fetchCheckinQrcode,
  type CheckinQrcodeMode,
  type CheckinQrcodeResult,
} from './checkin-qrcode-download'

export function CheckinQrcodeButton({ eventId, request, hasCapability }: {
  eventId: string
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
  hasCapability: (capability: string) => boolean
}) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<CheckinQrcodeMode>('STATIC')
  const [image, setImage] = useState<CheckinQrcodeResult | null>(null)
  if (!hasCapability('events.checkin.manage')) return null
  const load = async (nextMode: CheckinQrcodeMode) => {
    setLoading(true)
    try {
      // 成功才整体替换，过期或被撤销的码不会留在下载入口上。
      const result = await fetchCheckinQrcode(request, eventId, nextMode)
      setMode(nextMode)
      setImage(result)
    }
    catch (reason) {
      void message.error(reason instanceof Error ? reason.message : '签到二维码获取失败')
    }
    finally { setLoading(false) }
  }
  return <>
    <Button loading={loading} onClick={() => void load(mode)}>签到二维码</Button>
    <Modal title="活动签到二维码" open={Boolean(image)} onCancel={() => setImage(null)} footer={null} destroyOnHidden>
      {image && <Space direction="vertical" align="center" className="field-full-width">
        <Segmented
          aria-label="签到码类型"
          disabled={loading}
          value={mode}
          onChange={value => void load(value as CheckinQrcodeMode)}
          options={[{ value: 'STATIC', label: '静态码' }, { value: 'ROTATING', label: '短时码' }]}
        />
        <img className="event-checkin-qr" src={image.qrCodeDataUrl} alt="本场活动签到二维码" />
        <Typography.Text type="secondary">请使用微信扫码签到，报名资格由服务端核验。</Typography.Text>
        {mode === 'ROTATING' && <Typography.Text type="warning">短时码 5 分钟内有效，刷新将使旧码立即失效。</Typography.Text>}
        {image.validUntil && <Typography.Text type="secondary">有效期至 {new Date(image.validUntil).toLocaleString('zh-CN')}</Typography.Text>}
        {mode === 'ROTATING' && <Button loading={loading} onClick={() => void load('ROTATING')}>刷新短时码</Button>}
        <Button type="primary" disabled={loading} href={image.qrCodeDataUrl} download={checkinQrcodeFileName(image)}>下载签到码</Button>
      </Space>}
    </Modal>
  </>
}
