import { describe, expect, it } from 'vitest'
import { eventRichTextNodes } from '../src/modules/mip-events'

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
})
