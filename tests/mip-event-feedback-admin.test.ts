import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP admin event feedback workflow', () => {
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
