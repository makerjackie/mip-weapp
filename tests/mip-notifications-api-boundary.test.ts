import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipCoreFunctionManifest } from '../scripts/lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP notification function boundary', () => {
  it('deploys a client API separately from the protected worker', () => {
    const manifest = createMipCoreFunctionManifest(resolveMipFunctionNames())
    expect(manifest.find(item => item.role === 'notifications')).toMatchObject({
      name: 'mip-notifications-api',
      clientInvokable: true,
    })
    expect(manifest.find(item => item.role === 'notification')).toMatchObject({
      name: 'mip-notification-worker',
      clientInvokable: false,
    })
  })

  it('routes the client gateway only to the user API', () => {
    const defaults = read('src/config/defaults.ts')
    const runtime = read('src/config/runtime.ts')
    const gateway = read('src/modules/mip-messaging/cloudbase-gateway.ts')
    const build = read('weapp-vite.config.ts')
    expect(defaults).toContain('notificationsFunctionName: \'mip-notifications-api\'')
    expect(runtime).toContain('notificationsFunctionName: __MIP_NOTIFICATIONS_FUNCTION_NAME__')
    expect(gateway).toContain('runtimeConfig.cloudbase.notificationsFunctionName')
    expect(gateway).not.toContain('mip-notification-worker')
    expect(build).toContain('__MIP_NOTIFICATIONS_FUNCTION_NAME__')
    expect(build).not.toContain('__MIP_NOTIFICATION_FUNCTION_NAME__')
  })

  it('keeps user and worker actions out of each other function', () => {
    const apiHandler = read('cloudfunctions/mip-notifications-api/domain/handler.js')
    const workerHandler = read('cloudfunctions/mip-notification-worker/domain/handler.js')
    expect(apiHandler).toContain('\'recordCustomerServiceInteraction\'')
    expect(apiHandler).toContain('\'recordSubscriptionDecision\'')
    expect(apiHandler).not.toContain('verifyInternal')
    expect(workerHandler).toContain('[\'publishMessage\', \'runDeliveryBatch\']')
    expect(workerHandler).toContain('options.verifyInternal(event)')
    expect(workerHandler).not.toContain('resolveCaller')
  })

  it('converges authenticated and protected invocation rules during deploy and verification', () => {
    const deploy = read('scripts/deploy-functions.mjs')
    const verify = read('scripts/verify-cloud.mjs')
    expect(deploy).toContain('enableAuthenticatedClientInvocation(spec.name)')
    expect(deploy).toContain('disableClientInvocation(spec.name)')
    expect(deploy).toMatch(/notifications:\s*\{[\s\S]*?MIP_NOTIFICATION_ENCRYPTION_KEY/)
    expect(deploy).toContain('role === \'notification\' ? {} : { MIP_IDENTITY_PEPPER')
    expect(verify).toContain('assertClientInvocationEnabled(spec.name)')
    expect(verify).toContain('assertClientInvocationDisabled(spec.name)')
    expect(verify).toContain('assertNotificationEnvironment(coreDetails.get(\'notifications\'), coreDetails.get(\'notification\'))')
  })

  it('uses existing table-scoped grants for delivery reservations', () => {
    expect(RUNTIME_TABLE_PRIVILEGES.mip_notification_grants).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_delivery_tasks).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_notification_grants).not.toContain('DELETE')
    expect(RUNTIME_TABLE_PRIVILEGES.mip_delivery_tasks).not.toContain('DELETE')
  })

  it('keeps the worker timeout below the database task lease', () => {
    const manifest = createMipCoreFunctionManifest(resolveMipFunctionNames())
    const timeoutSeconds = manifest.find(item => item.role === 'notification')?.timeout
    const repository = read('cloudfunctions/mip-notification-worker/domain/repository.js')
    const leaseMinutes = Number(repository.match(/TASK_LEASE_MS = (\d+) \* 60 \* 1000/)?.[1])
    expect(timeoutSeconds).toBeTypeOf('number')
    expect(leaseMinutes).toBeGreaterThan(0)
    expect(Number(timeoutSeconds) * 1000).toBeLessThan(leaseMinutes * 60 * 1000)
  })

  it('serializes external delivery with account closure through the active user lock', () => {
    const repository = read('cloudfunctions/mip-notification-worker/domain/repository.js')
    const service = read('cloudfunctions/mip-notification-worker/domain/service.js')
    const fenceStart = repository.indexOf('async function deliverReservedTask')
    const userLock = repository.indexOf('SELECT id, status FROM mip_users', fenceStart)
    const taskLock = repository.indexOf('FROM mip_delivery_tasks', userLock)
    const grantLock = repository.indexOf('FROM mip_notification_grants', taskLock)
    const sender = repository.indexOf('await deliver()', grantLock)
    const finalWrite = repository.indexOf('const grantUpdate = reservation.grant', sender)
    const noRetry = repository.indexOf('}, 1)', finalWrite)
    expect(fenceStart).toBeGreaterThan(-1)
    expect(userLock).toBeGreaterThan(fenceStart)
    expect(taskLock).toBeGreaterThan(userLock)
    expect(grantLock).toBeGreaterThan(taskLock)
    expect(sender).toBeGreaterThan(grantLock)
    expect(finalWrite).toBeGreaterThan(sender)
    expect(noRetry).toBeGreaterThan(finalWrite)
    expect(service).toContain('repository.deliverReservedTask')
    expect(service).not.toContain('repository.finalizeTask')
    expect(repository).not.toContain('async function finalizeTask')
  })

  it('adds and safely rolls back task-owned grant reservations', () => {
    const migration = read('database/mysql/mip/016_notification_delivery_reservations.sql')
    const rollback = read('database/mysql/mip/rollback/016_notification_delivery_reservations.sql')
    expect(migration).toContain('status IN (\'AVAILABLE\', \'RESERVED\', \'CONSUMED\', \'EXPIRED\', \'REVOKED\')')
    expect(migration).toContain('mip_notification_grants_task_reservation_uk')
    expect(migration).toContain('FOREIGN KEY (app_id, reservation_task_id)')
    expect(rollback).toContain('SET status = \'EXPIRED\'')
    expect(rollback).not.toContain('SET status = \'AVAILABLE\'')
  })
})
