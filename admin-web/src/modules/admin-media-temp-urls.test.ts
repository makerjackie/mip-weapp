import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_MEDIA_TEMP_URLS_ACTION,
  ADMIN_MEDIA_TEMP_URLS_MAX_FILE_IDS,
  batchRichTextCloudImageIds,
  extractRichTextCloudImageIds,
  isHttpsTempUrl,
  substituteRichTextCloudImages,
} from './admin-media-temp-urls.ts'

describe('admin media temp urls contract', () => {
  it('keeps the read-only action and cap aligned with the server contract', () => {
    assert.equal(ADMIN_MEDIA_TEMP_URLS_ACTION, 'mip.admin.media.tempUrls')
    assert.equal(ADMIN_MEDIA_TEMP_URLS_MAX_FILE_IDS, 30)
  })

  it('extracts legacy cloud:// image ids in order without duplicates', () => {
    const html = '<p>前文</p><img src="cloud://a.png"><img src="https://plain.example/b.png"><img src="cloud://a.png"><img src="cloud://c.png">'
    assert.deepEqual(extractRichTextCloudImageIds(html), ['cloud://a.png', 'cloud://c.png'])
    assert.deepEqual(extractRichTextCloudImageIds(''), [])
  })

  it('accepts only https temp urls', () => {
    assert.equal(isHttpsTempUrl('https://tmp.example/a.png?sign=x'), true)
    assert.equal(isHttpsTempUrl('http://tmp.example/a.png'), false)
    assert.equal(isHttpsTempUrl('javascript:alert(1)'), false)
    assert.equal(isHttpsTempUrl(42), false)
  })

  it('substitutes resolved images, keeps an honest placeholder for failures, and leaves other markup alone', () => {
    const html = '<p>介绍</p><img src="cloud://ok.png" alt="现场"><img src="cloud://broken.png"><p>结尾</p>'
    const result = substituteRichTextCloudImages(html, { 'cloud://ok.png': 'https://tmp/ok.png?sign=x&v=1' })
    assert.match(result, /<p>介绍<\/p>/)
    assert.match(result, /<img src="https:\/\/tmp\/ok\.png\?sign=x&amp;v=1" alt="现场">/)
    assert.match(result, /event-mobile-preview__image-placeholder/)
    assert.match(result, /插图暂不可预览/)
    assert.doesNotMatch(result, /cloud:\/\/broken\.png/)
    assert.match(result, /<p>结尾<\/p>/)
    // 未提供解析结果时全部占位，且不残留 cloud:// src。
    const unresolved = substituteRichTextCloudImages('<img src="cloud://a.png">', {})
    assert.match(unresolved, /插图暂不可预览/)
    assert.doesNotMatch(unresolved, /cloud:\/\//)
  })

  it('batches file ids within the contract cap', () => {
    const ids = Array.from({ length: 45 }, (_, index) => `cloud://a${index}.png`)
    const batches = batchRichTextCloudImageIds(ids)
    assert.deepEqual(batches.map(batch => batch.length), [30, 15])
    assert.deepEqual(batchRichTextCloudImageIds([]), [])
  })
})
