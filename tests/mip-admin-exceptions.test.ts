import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOperationalExceptionPage } from '../src/modules/mip-admin/operational-exceptions'
import { MipAdminError } from '../src/modules/mip-admin/types'

const eventId = '22222222-2222-4222-8222-222222222222'

function page(target: unknown = null) {
  return {
    items: [{
      id: 'OUTBOX:11111111-1111-4111-8111-111111111111',
      source: 'OUTBOX',
      status: 'FAILED',
      title: '业务事件处理失败',
      summary: '一项业务事件未完成后续处理。',
      occurredAt: '2026-08-24T12:00:00.000Z',
      reasonCode: null,
      target,
    }],
    nextCursor: null,
    availableTypes: ['OUTBOX', 'REFUND', 'PAYMENT'],
  }
}

describe('MIP admin operational exceptions', () => {
  it('accepts only a sanitized response and allowlisted business target', () => {
    const parsed = parseOperationalExceptionPage(page({
      type: 'EVENT',
      id: eventId,
      route: `/packages/admin/event-console/index?eventId=${eventId}`,
    }))
    expect(parsed.items[0].target?.id).toBe(eventId)

    expect(() => parseOperationalExceptionPage({
      ...page(),
      openid: 'must-not-be-accepted',
    })).toThrow(MipAdminError)
    expect(() => parseOperationalExceptionPage(page({
      type: 'EVENT',
      id: eventId,
      route: '/packages/admin/roles/index',
    }))).toThrow(MipAdminError)
  })

  it('keeps the page read-only and renders all required public states', () => {
    const root = path.resolve(import.meta.dirname, '../src/packages/admin/exceptions')
    const script = fs.readFileSync(path.join(root, 'index.ts'), 'utf8')
    const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8')
    expect(script).toContain('\'operations.exceptions.read\'')
    expect(script).not.toMatch(/retryOperational|submitRefund|changeStatus|\.mutate\(/)
    expect(template).toContain('state === \'loading\'')
    expect(template).toContain('state === \'empty\'')
    expect(template).toContain('state === \'error\'')
    expect(template).toContain('state === \'forbidden\'')
    expect(template).toContain('异常中心仅展示状态，不会修改业务记录。')
  })

  it('connects the route, dashboard capability and read-only gateway action', () => {
    const app = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/app.json'), 'utf8'))
    const admin = app.subPackages.find((item: { root: string }) => item.root === 'packages/admin')
    const dashboard = fs.readFileSync(path.resolve(import.meta.dirname, '../src/packages/admin/dashboard/index.wxml'), 'utf8')
    const gateway = fs.readFileSync(path.resolve(import.meta.dirname, '../src/modules/mip-admin/cloudbase-gateway.ts'), 'utf8')
    expect(admin.pages).toContain('exceptions/index')
    expect(dashboard).toContain('canExceptions')
    expect(dashboard).toContain('/packages/admin/exceptions/index')
    expect(gateway).toContain('\'mip.admin.exceptions.list\'')
    expect(gateway).toContain('parseOperationalExceptionPage')
    expect(gateway).not.toContain('mip.admin.exceptions.retry')
  })
})
