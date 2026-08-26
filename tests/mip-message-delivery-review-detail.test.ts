import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const pageRoot = path.join(root, 'src/packages/admin/message-delivery-review')

function read(file: string) {
  return fs.readFileSync(path.join(pageRoot, file), 'utf8')
}

describe('MIP message delivery review detail', () => {
  it('loads a single record through the existing safe get contract and renders required facts', () => {
    const script = read('index.ts')
    const template = read('index.wxml')

    expect(script).toContain('getDeliveryReview')
    expect(script).toContain('messages.delivery.review')
    expect(template).toContain('来源标识')
    expect(template).toContain('当前业务状态')
    expect(template).toContain('证据版本')
    expect(template).toContain('认领租约')
    expect(template).toContain('可执行动作')
    expect(template).toContain('确认未知结果，不重放')
    expect(template).not.toMatch(/正文|openid|OpenID|手机号|provider 原始响应|密钥/u)
    expect(script).not.toMatch(/replayDelivery|retryDelivery|sendDelivery/u)
  })

  it('registers a query-backed route and preserves every supported page state', () => {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'src/app.json'), 'utf8'))
    const admin = app.subPackages.find((item: { root: string }) => item.root === 'packages/admin')
    expect(admin.pages).toContain('message-delivery-review/index')

    const runtime = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-pages.json'), 'utf8'))
    const route = runtime.routes.find((item: { path: string }) => item.path === 'packages/admin/message-delivery-review/index')
    expect(route).toMatchObject({
      selector: '#admin-message-delivery-review-page',
      states: ['loading', 'ready', 'error', 'forbidden', 'conflict'],
      query: ['sourceType', 'sourceId'],
      queryFixture: {
        sourceRoute: 'packages/admin/exceptions/index',
        dataPath: 'reviewItems',
      },
    })
  })
})
