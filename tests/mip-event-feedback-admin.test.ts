import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP admin event feedback workflow', () => {
  it('registers an event-scoped page from the event console', () => {
    const app = read('src/app.json')
    const consolePage = read('src/packages/admin/event-console/index.ts')
    const consoleView = read('src/packages/admin/event-console/index.wxml')
    const page = read('src/packages/admin/event-feedback/index.ts')
    const view = read('src/packages/admin/event-feedback/index.wxml')
    const runtime = JSON.parse(read('config/runtime-pages.json')) as {
      routes: Array<{ id: string, path: string, selector: string, query?: string[] }>
    }
    const route = runtime.routes.find(item => item.path === 'packages/admin/event-feedback/index')

    expect(app).toContain('"event-feedback/index"')
    expect(consolePage).toContain('\'event-feedback\'')
    expect(consolePage).toContain('\'events.feedback.read\'')
    expect(consoleView).toContain('data-page="event-feedback"')
    expect(page).toContain('listAdminFeedback')
    expect(view).toContain('state === \'forbidden\'')
    expect(view).toContain('暂无活动反馈')
    expect(view).toContain('加载更多')
    expect(route).toMatchObject({
      id: 'A22',
      selector: '#admin-event-feedback-page',
      query: ['eventId'],
    })
  })

  it('keeps feedback access and filtering on the canonical events service', () => {
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const handler = read('cloudfunctions/mip-events-api/index.js')
    const gateway = read('src/modules/mip-events/cloudbase-gateway.ts')

    expect(service).toContain('capability: \'events.feedback.read\'')
    expect(service).toContain('f.app_id = ? AND f.event_id = ?')
    expect(service).toContain('f.rating = ?')
    expect(service).toContain('submitted_at DESC, f.id DESC')
    expect(handler).toContain('case \'mip.events.admin.listFeedback\':')
    expect(gateway).toContain('\'mip.events.admin.listFeedback\'')
    expect(service).toContain('SELECT f.id, f.rating, f.body, f.version, f.submitted_at, f.updated_at, p.nickname')
    expect(service).not.toContain('SELECT f.user_id')
  })
})
