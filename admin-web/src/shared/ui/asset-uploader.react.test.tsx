import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetUploader } from './asset-uploader'
import { MediaPreviewProvider } from './media-preview-provider'

const state = vi.hoisted(() => ({ session: { client: { uploadImage: vi.fn() } } }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => state.session }))

describe('asset uploader', () => {
  beforeEach(() => {
    state.session.client.uploadImage.mockReset()
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:preview'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  })
  afterEach(cleanup)

  it('previews the freshly uploaded file locally instead of the cloud:// file id', async () => {
    state.session.client.uploadImage.mockResolvedValue({ assetId: 'asset-9', imageUrl: 'cloud://env.mip/badge-images/a.png' })
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState('')
      return <AssetUploader purpose="BADGE_IMAGE" value={value} onChange={next => { setValue(next); onChange(next) }} />
    }
    render(<Harness />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'badge.png', { type: 'image/png' })] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('asset-9'))
    expect(state.session.client.uploadImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'badge.png', type: 'image/png' }), 'BADGE_IMAGE')
    expect(screen.getByAltText('预览')).toHaveAttribute('src', 'blob:preview')
  })

  it('falls back to the server-resolved preview for a saved asset and clears on request', async () => {
    const onChange = vi.fn()
    render(
      <MediaPreviewProvider existingUrls={{ 'asset-1': 'https://tmp.example/badge.png' }}>
        <AssetUploader purpose="BADGE_IMAGE" value="asset-1" onChange={onChange} />
      </MediaPreviewProvider>,
    )
    expect(screen.getByAltText('预览')).toHaveAttribute('src', 'https://tmp.example/badge.png')
    await userEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
