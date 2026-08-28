import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP order detail copy action', () => {
  it('copies the server order id and keeps a retryable failure message', () => {
    const page = read('src/packages/member/order-detail/index.ts')
    const view = read('src/packages/member/order-detail/index.wxml')

    expect(page).toContain('copyOrderId()')
    expect(page).toContain('wx.setClipboardData')
    expect(page).toContain('message: \'订单号复制失败，请点击订单号重试。\'')
    expect(view).toContain('bind:tap="copyOrderId"')
    expect(view).toContain('>复制</text>')
  })
})
