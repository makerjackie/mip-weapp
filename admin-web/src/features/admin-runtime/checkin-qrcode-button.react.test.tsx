import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { CheckinQrcodeButton } from './checkin-qrcode-button'

afterEach(cleanup)
const png = 'data:image/png;base64,iVBORw0KGgo='
const staticResponse = { eventId: 'event-1', mode: 'STATIC', validUntil: null, qrCodeDataUrl: png }
const rotatingPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgROTATING='
const rotatingResponse = { eventId: 'event-1', mode: 'ROTATING', validUntil: '2026-10-14T03:05:00.000Z', qrCodeDataUrl: rotatingPng }
const refreshedPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgREFRESHED='
function mount(...results: unknown[]) {
  const request = vi.fn()
  for (const result of results.length ? results : [staticResponse]) {
    if (result instanceof Error) request.mockRejectedValueOnce(result)
    else request.mockResolvedValueOnce(result)
  }
  render(<App><CheckinQrcodeButton eventId="event-1" request={request} hasCapability={value => value === 'events.checkin.manage'} /></App>)
  return request
}

it('previews and downloads the actual server data URL without opening a blank tab', async () => {
  const open = vi.spyOn(window, 'open')
  const request = mount()
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  const image = await screen.findByRole('img', { name: '本场活动签到二维码' })
  expect(image).toHaveAttribute('src', png)
  expect(request).toHaveBeenCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'event-1', mode: 'STATIC' })
  expect(screen.getByRole('radio', { name: '静态码' })).toBeChecked()
  expect(screen.queryByText('短时码 5 分钟内有效，刷新将使旧码立即失效。')).toBeNull()
  expect(screen.queryByRole('button', { name: '刷新短时码' })).toBeNull()
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('href', png)
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('download', '活动签到码-event-1.png')
  expect(open).not.toHaveBeenCalled()
  open.mockRestore()
})

it('switches to a 5-minute rotating code and refreshes it with a brand-new image', async () => {
  const request = mount(staticResponse, rotatingResponse, { ...rotatingResponse, qrCodeDataUrl: refreshedPng })
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  await screen.findByRole('img', { name: '本场活动签到二维码' })
  fireEvent.click(screen.getByRole('radio', { name: '短时码' }))
  expect(await screen.findByText('短时码 5 分钟内有效，刷新将使旧码立即失效。')).toBeInTheDocument()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request).toHaveBeenLastCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'event-1', mode: 'ROTATING' })
  expect(screen.getByRole('radio', { name: '短时码' })).toBeChecked()
  expect(screen.getByRole('img', { name: '本场活动签到二维码' })).toHaveAttribute('src', rotatingPng)
  expect(screen.getByText(/有效期至/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '刷新短时码' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '刷新短时码' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  expect(request).toHaveBeenLastCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'event-1', mode: 'ROTATING' })
  expect(screen.getByRole('img', { name: '本场活动签到二维码' })).toHaveAttribute('src', refreshedPng)
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('href', refreshedPng)
})

it('keeps the previous static code when switching to the rotating mode fails', async () => {
  const request = mount(staticResponse, new Error('生成失败'))
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  await screen.findByRole('img', { name: '本场活动签到二维码' })
  fireEvent.click(screen.getByRole('radio', { name: '短时码' }))
  await screen.findByText('生成失败')
  expect(request).toHaveBeenCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'event-1', mode: 'ROTATING' })
  expect(screen.getByRole('radio', { name: '静态码' })).toBeChecked()
  expect(screen.getByRole('img', { name: '本场活动签到二维码' })).toHaveAttribute('src', png)
  expect(screen.getByRole('link', { name: '下载签到码' })).toHaveAttribute('href', png)
  expect(screen.queryByText('短时码 5 分钟内有效，刷新将使旧码立即失效。')).toBeNull()
})

it.each([
  { ...staticResponse, eventId: 'other-event' },
  { ...staticResponse, qrCodeDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
  { downloadUrl: 'https://example.com/unsupported-contract.png' },
])('rejects an incorrect event or unsupported image contract', async result => {
  mount(result)
  fireEvent.click(screen.getByRole('button', { name: '签到二维码' }))
  await screen.findByText('签到二维码暂不可用，请稍后重试')
  expect(screen.queryByRole('img', { name: '本场活动签到二维码' })).toBeNull()
})

it('requires checkin capability rather than general event editing permission', () => {
  const request = vi.fn().mockResolvedValue(staticResponse)
  render(<App><CheckinQrcodeButton eventId="event-1" request={request} hasCapability={value => value === 'events.write'} /></App>)
  expect(screen.queryByRole('button', { name: '签到二维码' })).toBeNull()
  expect(request).not.toHaveBeenCalled()
})
