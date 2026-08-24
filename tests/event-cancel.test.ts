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
    const repository = read('cloudfunctions/mip-admin-api/domain/repository.js')
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
    const service = read('cloudfunctions/mip-admin-api/domain/service.js')
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(service).toContain('text(input.reason, 300, { required: true, label: \'取消原因\' })')
    expect(service).toContain('const version = expectedVersion(input.expectedVersion)')
    expect(pageTs).toContain('confirmCancelEvent')
    expect(pageTs).toMatch(/cancelBusy: true[\s\S]*?wx\.showModal/)
    expect(pageTs).toContain('status: \'CANCELLED\'')
    expect(pageTs).toContain('expectedVersion: this.data.version')
    expect(pageWxml).toContain('取消原因（必填）')
    expect(pageWxml).toContain('cancelDialogVisible && !cancelConflict')
  })

  it('does not adopt a new version after conflict without reloading the event', () => {
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(pageTs).toContain('cancelConflict: true')
    expect(pageTs).toContain('cancelDialogVisible: false')
    expect(pageTs).toContain('refreshAfterCancelConflict')
    expect(pageTs).toContain('this.setData({ cancelReason: \'\' })')
    expect(pageTs).not.toMatch(/cancelEventVersion:\s*latest\.version/)
    expect(pageWxml).toContain('refreshAfterCancelConflict')
  })

  it('dispatches committed refund ids and exposes recoverable provider status in the order page', () => {
    const service = read('cloudfunctions/mip-admin-api/domain/service.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')
    const pageTs = read('src/packages/admin/orders/index.ts')
    const pageWxml = read('src/packages/admin/orders/index.wxml')

    expect(service).toMatch(/await repository\.changeEventStatus\([\s\S]*?const refundIds = Array\.isArray\(result\.refundIds\)/)
    expect(service).toContain('dispatchRefundBatchSafely(context.caller.appId, refundIds)')
    expect(gateway).toContain('call(\'mip.admin.refunds.retry\', { refundId })')
    expect(pageTs).toContain('gateway.retryRefund(refundId)')
    expect(pageTs).toContain('\'退款处理失败\'')
    expect(pageWxml).toContain('item.status === \'REFUND_PENDING\'')
    expect(pageWxml).toContain('item.refundStatus === \'PROVIDER_CREATED\'')
  })
})
