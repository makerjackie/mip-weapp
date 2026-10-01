import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { CheckinQrcodeButton } from './checkin-qrcode-button'

afterEach(cleanup)
const png = 'data:image/png;base64,iVBORw0KGgo='
const response = { eventId: 'event-1', mode: 'STATIC', validUntil: null, qrCodeDataUrl: png }
function mount(result: unknown = response, capability = 'events.checkin.manage') {
  const request = vi.fn().mockResolvedValue(result)
  render(<App><CheckinQrcodeButton eventId="event-1" request={request} hasCapability={value => value === capability} /></App>)
  return request
}

it('previews and downloads the actual server data URL without opening a blank tab', async () => {
  const open = vi.spyOn(window, 'open')
  const request = mount()
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  const image = await screen.findByRole('img', { name: '本场活动签到二维码' })
  expect(image).toHaveAttribute('src', png)
  expect(request).toHaveBeenCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'event-1' })
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('href', png)
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('download', '活动签到码-event-1.png')
  expect(open).not.toHaveBeenCalled()
  open.mockRestore()
})

it.each([
  { ...response, eventId: 'other-event' },
  { ...response, qrCodeDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
  { downloadUrl: 'https://example.com/unsupported-contract.png' },
])('rejects an incorrect event or unsupported image contract', async result => {
  mount(result)
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  await screen.findByText('签到二维码暂不可用，请稍后重试')
  expect(screen.queryByRole('img', { name: '本场活动签到二维码' })).toBeNull()
})

it('requires checkin capability rather than general event editing permission', () => {
  const request = mount(response, 'events.write')
  expect(screen.queryByRole('button', { name: '签到二维码' })).toBeNull()
  expect(request).not.toHaveBeenCalled()
})
