import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
function readOptional(relativePath: string) {
  const absolutePath = path.join(root, relativePath)
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : ''
}

describe('admin event clone contract', () => {
  it('uses a scoped, versioned and idempotent server operation', () => {
    const operations = read('cloudfunctions/mip-admin-api/domain/operations/events.js')
    const eventDomain = [
      read('cloudfunctions/mip-admin-api/domain/service.js'),
      readOptional('cloudfunctions/mip-admin-api/domain/events.js'),
    ].join('\n')
    const repository = read('cloudfunctions/mip-admin-api/domain/repository.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(operations).toContain('\'mip.admin.events.clone\'')
    expect(eventDomain).toContain('eventAuthorization(context, sourceEventId, CAPABILITIES.EVENTS_WRITE)')
    expect(eventDomain).toContain('expectedVersion(input.expectedVersion)')
    expect(eventDomain).toContain('normalizeIdempotencyKey(input.idempotencyKey)')
    expect(gateway).toContain('call(\'mip.admin.events.clone\'')
    expect(repository).toContain('const operation = \'admin.events.clone\'')
    expect(repository).toContain('status: \'DRAFT\'')
  })

  it('keeps a retry key and states exactly which records are not copied', () => {
    const page = read('src/packages/admin/event-console/index.ts')
    const view = read('src/packages/admin/event-console/index.wxml')

    expect(page).toContain('cloneRequestKey')
    expect(page).toContain('cloneRequestVersion')
    expect(page).toContain('expectedVersion: event.version')
    expect(page).toContain('报名、订单、签到、相册和消息不会复制')
    expect(view).toContain('复制为草稿')
  })
})
