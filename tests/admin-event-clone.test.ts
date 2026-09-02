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
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(operations).toContain('\'mip.admin.events.clone\'')
    expect(eventDomain).toContain('eventAuthorization(context, sourceEventId, CAPABILITIES.EVENTS_WRITE)')
    expect(eventDomain).toContain('expectedVersion(input.expectedVersion)')
    expect(eventDomain).toContain('normalizeIdempotencyKey(input.idempotencyKey)')
    expect(gateway).toContain('call(\'mip.admin.events.clone\'')
    expect(repository).toContain('const operation = \'admin.events.clone\'')
    expect(repository).toContain('status: \'DRAFT\'')
    const cloneService = eventDomain.slice(
      eventDomain.indexOf('async function cloneEvent'),
      eventDomain.indexOf('async function changeEventStatus'),
    )
    const cloneRepository = repository.slice(
      repository.indexOf('async function cloneEvent'),
      repository.indexOf('async function changeEventStatus'),
    )
    expect(cloneService).not.toContain('source.version !== version')
    expect(cloneService).toContain('grant.scopeType === \'EVENT\'')
    expect(cloneRepository).toContain('authorization.effectiveGrant.scopeType === \'EVENT\'')
    expect(cloneRepository.indexOf('INSERT INTO mip_idempotency_keys'))
      .toBeLessThan(cloneRepository.indexOf('Number(source.version) !== input.expectedVersion'))
  })
})
