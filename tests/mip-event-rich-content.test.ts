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

  it('parses restricted HTML with inline emphasis and alignment', () => {
    const nodes = eventRichTextNodes('<p style="text-align:center">居中 <strong>加粗</strong> <em>斜体</em> <u>下划线</u></p>')
    expect(nodes).toHaveLength(1)
    const [paragraph] = nodes
    expect(paragraph.name).toBe('p')
    expect(paragraph.attrs?.style).toContain('text-align:center')
    const names = paragraph.children?.map(child => child.name).filter(Boolean)
    expect(names).toEqual(['strong', 'em', 'u'])
    expect(paragraph.children?.[1].children?.[0].text).toBe('加粗')
    expect(paragraph.children?.[3].children?.[0].text).toBe('斜体')
  })

  it('parses restricted HTML headings, lists and approved images', () => {
    const nodes = eventRichTextNodes('<h1>标题</h1><ul><li>第一项</li><li>第二项</li></ul><img src="https://cdn.example.com/x.png" alt="图">')
    expect(nodes.map(node => node.name)).toEqual(['h2', 'ul', 'img'])
    expect(nodes[1].children).toHaveLength(2)
    expect(nodes[2].attrs?.src).toBe('https://cdn.example.com/x.png')
  })

  it('drops unsafe HTML tags, attributes and image sources', () => {
    const nodes = eventRichTextNodes('<p onclick="alert(1)">安全<script>alert(1)</script><img src="javascript:alert(1)"></p>')
    const json = JSON.stringify(nodes)
    expect(json).not.toContain('onclick')
    expect(json).not.toContain('<script>')
    expect(nodes.every(node => node.name !== 'img')).toBe(true)
  })

  it('collects cloud image ids from HTML img sources', () => {
    const html = '<p>介绍</p><img src="cloud://cloud1-env.636c-prefix/mip/a.png"><img src="cloud://cloud1-env.636c-prefix/mip/b.png"><img src="cloud://cloud1-env.636c-prefix/mip/a.png">'
    expect(extractRichTextCloudImageIds(html)).toEqual([
      'cloud://cloud1-env.636c-prefix/mip/a.png',
      'cloud://cloud1-env.636c-prefix/mip/b.png',
    ])
  })

  it('hides raw cloud:// HTML images until hydration', () => {
    const nodes = eventRichTextNodes('<p>前文</p><img src="cloud://cloud1-env.636c-prefix/mip/a.png"><p>后文</p>')
    expect(nodes.every(node => node.name !== 'img')).toBe(true)
    expect(JSON.stringify(nodes)).not.toContain('cloud://')
  })
})
