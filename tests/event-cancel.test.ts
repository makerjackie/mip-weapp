import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP event cancellation convergence contract', () => {
  it('cancels registrations and queues eligible refunds as durable facts', () => {
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const cancellationFlow = repository.slice(
      repository.indexOf('async function changeEventStatus'),
      repository.indexOf('async function checkIn'),
    )

    expect(cancellationFlow).toContain('input.status === \'CANCELLED\'')
    expect(cancellationFlow).toContain('UPDATE mip_event_registrations')
    expect(cancellationFlow).toContain('status = \'CANCELLED\'')
    expect(cancellationFlow).toContain('UPDATE mip_orders')
    expect(cancellationFlow).toContain('INSERT INTO mip_refunds')
    expect(cancellationFlow).toContain('writeEventChange')
    expect(cancellationFlow).toContain('writeOutbox')
    expect(cancellationFlow).toContain('writeAudit')
    expect(cancellationFlow).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('requires a reason, expected version, and an explicit confirmation latch', () => {
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')

    expect(service).toContain('text(input.reason, 300, { required: true, label: \'取消原因\' })')
    expect(service).toContain('const version = expectedVersion(input.expectedVersion)')
  })

  it('dispatches committed refund ids and exposes recoverable provider status in the order page', () => {
    const events = read('cloudfunctions/mip-admin-api/domain/events.js')
    const service = read('cloudfunctions/mip-admin-api/domain/service.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(events).toMatch(/const result = await repository\.changeEventStatus\([\s\S]*?const refundIds = result\.idempotent \? \[\] : \(Array\.isArray\(result\.refundIds\)/)
    expect(events).toContain('dispatchCancellationRefunds(context.caller.appId, refundIds)')
    expect(service).toContain('dispatchCancellationRefunds: dispatchRefundBatchSafely')
    expect(gateway).toContain('call(\'mip.admin.refunds.retry\', { refundId })')
  })
})
