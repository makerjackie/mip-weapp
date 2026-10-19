import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { substituteRichTextCloudImages } from './event-detail-preview.ts'

describe('substituteRichTextCloudImages', () => {
  it('swaps resolvable cloud references for their viewable addresses and keeps other attributes', () => {
    const html = '<p>正文</p><img src="cloud://env-bucket/a.jpg" alt="活动图片"><p>尾</p>'
    assert.equal(
      substituteRichTextCloudImages(html, id => (id === 'cloud://env-bucket/a.jpg' ? 'blob:preview-a' : '')),
      '<p>正文</p><img src="blob:preview-a" alt="活动图片"><p>尾</p>',
    )
  })

  it('replaces unresolvable cloud images with the honest pending placeholder', () => {
    assert.equal(
      substituteRichTextCloudImages('<img src="cloud://env-bucket/gone.jpg" alt="x">', () => ''),
      '<p class="event-mobile-preview__img-pending">插图保存后在活动页显示</p>',
    )
  })

  it('keeps non-cloud image sources untouched', () => {
    const html = '<img src="https://example.com/a.jpg" alt="y"><img src="blob:keep" alt="z">'
    assert.equal(substituteRichTextCloudImages(html, () => 'blob:other'), html)
  })
})
