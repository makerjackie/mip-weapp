import { describe, expect, it } from 'vitest'
import { eventRichTextNodes, extractRichTextCloudImageIds } from '../src/modules/mip-events'

describe('MIP event rich content', () => {
  it('renders headings, lists and approved HTTPS images as structured nodes', () => {
    const nodes = eventRichTextNodes('# 活动介绍\n- 自带水杯\n- 准时到场\n![路线图](https://cdn.example.com/map.png)')
    expect(nodes.map(node => node.name)).toEqual(['h2', 'ul', 'img', 'p'])
    expect(nodes[1].children).toHaveLength(2)
    expect(nodes[2].attrs?.src).toBe('https://cdn.example.com/map.png')
  })

  it('keeps unsupported markup as text and never emits unsafe image sources', () => {
    const nodes = eventRichTextNodes('<script>alert(1)</script>\n![图片](javascript:alert(1))')
    expect(nodes.every(node => node.name !== 'img')).toBe(true)
    expect(nodes[0].children?.[0].text).toBe('<script>alert(1)</script>')
  })

  it('accepts locally resolved temp image paths after cloud file hydration', () => {
    const nodes = eventRichTextNodes('![图片](wxfile://tmp_event-content-1.png)\n![图](http://tmp/preview.jpeg)')
    expect(nodes.filter(node => node.name === 'img').map(node => node.attrs?.src)).toEqual([
      'wxfile://tmp_event-content-1.png',
      'http://tmp/preview.jpeg',
    ])
  })

  it('still hides raw cloud file ids until the page hydrates them', () => {
    const nodes = eventRichTextNodes('前文\n![图片](cloud://cloud1-env.636c-prefix/mip/staging/app/event-content/user/asset.png)\n后文')
    expect(nodes.every(node => node.name !== 'img')).toBe(true)
    // 未水合的 cloud:// 图片行整行跳过：既不出 img，也不把 cloud:// 原文带进节点文本。
    expect(nodes.map(node => node.children?.[0]?.text)).toEqual(['前文', '后文'])
    expect(JSON.stringify(nodes)).not.toContain('cloud://')
  })

  it('collects unique cloud image ids in order for batch resolution', () => {
    const markdown = [
      '# 介绍',
      '![图片](cloud://cloud1-env.636c-prefix/mip/a.png)',
      '![图片](cloud://cloud1-env.636c-prefix/mip/b.png)',
      '![重复](cloud://cloud1-env.636c-prefix/mip/a.png)',
      '![https 图](https://cdn.example.com/keep.png)',
    ].join('\n')
    expect(extractRichTextCloudImageIds(markdown)).toEqual([
      'cloud://cloud1-env.636c-prefix/mip/a.png',
      'cloud://cloud1-env.636c-prefix/mip/b.png',
    ])
    expect(extractRichTextCloudImageIds('没有插图')).toEqual([])
  })
})
