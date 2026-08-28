import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  continueSensitiveExport,
  createSensitiveExportWorkflow,
  SensitiveExportError,
  type SensitiveExportRequest,
} from './admin-sensitive-export.ts'

const NOW = Date.UTC(2030, 0, 1)
const EXPIRES_AT = '2030-01-01T00:15:00.000Z'
const RESERVATION_EXPIRES_AT = '2030-01-01T00:02:00.000Z'
const TOKEN = 'a'.repeat(43)
const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
const HASH = createHash('sha256').update(BYTES).digest('hex')

function ready(fileName = 'mip-users-20300101T000000Z.xlsx') {
  return { status: 'READY', rowCount: 2, expiresAt: EXPIRES_AT, fileName, failureCode: null }
}

function reservation(fileName = 'mip-users-20300101T000000Z.xlsx', hash = HASH) {
  return {
    status: 'RESERVED',
    tempUrl: 'https://storage.example.test/signed-export',
    fileName,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contentBytes: BYTES.byteLength,
    contentSha256: hash,
    reservationExpiresAt: RESERVATION_EXPIRES_AT,
  }
}

function requestQueue(responses: Record<string, unknown | Error>) {
  const calls: Array<{ action: string; input: Record<string, unknown> }> = []
  const request: SensitiveExportRequest = async (action, input = {}) => {
    calls.push({ action, input })
    const value = responses[action]
    if (value instanceof Error) throw value
    if (value === undefined) throw new Error(`UNEXPECTED_ACTION:${action}`)
    return value as never
  }
  return { calls, request }
}

function runtime(saveCalls: Array<{ fileName: string; bytes: number[] }>, fetchCalls: RequestInit[] = []) {
  return {
    now: () => NOW,
    createKey: (step: 'create' | 'prepare' | 'reserve' | 'complete') => `web-export-${step}-fixture`,
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(init || {})
      return new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.byteLength) } })
    }) as typeof fetch,
    save: async (fileName: string, bytes: Uint8Array<ArrayBuffer>) => {
      saveCalls.push({ fileName, bytes: [...bytes] })
    },
  }
}

describe('sensitive admin export workflow', () => {
  it('exports filtered users with an optional phone column and clears secrets after saving', async () => {
    const responses = requestQueue({
      'mip.admin.exports.create': { ticketId: 'ticket-a', token: TOKEN, status: 'PENDING', expiresAt: EXPIRES_AT },
      'mip.admin.exports.prepare': ready(),
      'mip.admin.exports.reserve': reservation(),
      'mip.admin.exports.complete': { status: 'CONSUMED', consumedAt: '2030-01-01T00:00:10.000Z' },
    })
    const saves: Array<{ fileName: string; bytes: number[] }> = []
    const fetchCalls: RequestInit[] = []
    const workflow = createSensitiveExportWorkflow({
      kind: 'users',
      includesPhone: true,
      filters: { query: ' Jackie ', status: 'ACTIVE' },
    }, step => `web-export-${step}-fixture`)

    const result = await continueSensitiveExport(workflow, responses.request, runtime(saves, fetchCalls))

    assert.deepEqual(result, { ticketId: 'ticket-a', fileName: 'mip-users-20300101T000000Z.xlsx', rowCount: 2 })
    assert.deepEqual(responses.calls.map(item => item.action), [
      'mip.admin.exports.create', 'mip.admin.exports.prepare', 'mip.admin.exports.reserve', 'mip.admin.exports.complete',
    ])
    assert.deepEqual(responses.calls[0].input, {
      exportType: 'USERS', includesPhone: true, filters: { query: 'Jackie', status: 'ACTIVE' },
      idempotencyKey: 'web-export-create-fixture',
    })
    assert.equal(fetchCalls[0].credentials, 'omit')
    assert.equal(fetchCalls[0].cache, 'no-store')
    assert.equal(fetchCalls[0].referrerPolicy, 'no-referrer')
    assert.deepEqual(saves, [{ fileName: 'mip-users-20300101T000000Z.xlsx', bytes: [...BYTES] }])
    assert.equal(workflow.ticket?.token, '')
    assert.equal(workflow.reservation, null)
    assert.equal(workflow.fileBytes, null)
  })

  it('polls only the status query while a prepared export is pending', async () => {
    let statusCalls = 0
    const calls: string[] = []
    const request: SensitiveExportRequest = async (action) => {
      calls.push(action)
      if (action === 'mip.admin.exports.create') return { ticketId: 'ticket-a', token: TOKEN, status: 'PENDING', expiresAt: EXPIRES_AT } as never
      if (action === 'mip.admin.exports.prepare') return { ...ready(), status: 'PENDING', rowCount: null, retryAfterMs: 300 } as never
      if (action === 'mip.admin.exports.status') {
        statusCalls += 1
        return (statusCalls === 1 ? { ...ready(), status: 'PENDING', rowCount: null } : ready()) as never
      }
      if (action === 'mip.admin.exports.reserve') return reservation() as never
      if (action === 'mip.admin.exports.complete') return { status: 'CONSUMED', consumedAt: '2030-01-01T00:00:10.000Z' } as never
      throw new Error(`UNEXPECTED:${action}`)
    }
    const workflow = createSensitiveExportWorkflow({ kind: 'users', filters: {} }, step => `web-export-${step}-fixture`)
    await continueSensitiveExport(workflow, request, {
      ...runtime([]),
      wait: async () => {},
    })

    assert.deepEqual(calls, [
      'mip.admin.exports.create', 'mip.admin.exports.prepare',
      'mip.admin.exports.status', 'mip.admin.exports.status',
      'mip.admin.exports.reserve', 'mip.admin.exports.complete',
    ])
  })

  it('reuses the same completion key after an uncertain response without downloading twice', async () => {
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    let completionAttempts = 0
    const request: SensitiveExportRequest = async (action, input = {}) => {
      calls.push({ action, input })
      if (action === 'mip.admin.exports.create') return { ticketId: 'ticket-a', token: TOKEN, status: 'PENDING', expiresAt: EXPIRES_AT } as never
      if (action === 'mip.admin.exports.prepare') return ready() as never
      if (action === 'mip.admin.exports.reserve') return reservation() as never
      if (action === 'mip.admin.exports.complete') {
        completionAttempts += 1
        if (completionAttempts === 1) {
          throw Object.assign(new Error('network response lost'), { code: 'SERVICE_UNAVAILABLE' })
        }
        return { status: 'CONSUMED', consumedAt: '2030-01-01T00:00:10.000Z' } as never
      }
      throw new Error(`UNEXPECTED:${action}`)
    }
    const fetchCalls: RequestInit[] = []
    const workflow = createSensitiveExportWorkflow({ kind: 'orders', filters: {} }, step => `web-export-${step}-fixture`)

    await assert.rejects(() => continueSensitiveExport(workflow, request, runtime([], fetchCalls)), /network response lost/)
    const result = await continueSensitiveExport(workflow, request, runtime([], fetchCalls))

    assert.equal(result.ticketId, 'ticket-a')
    assert.equal(fetchCalls.length, 1)
    const completionKeys = calls
      .filter(item => item.action === 'mip.admin.exports.complete')
      .map(item => item.input.idempotencyKey)
    assert.deepEqual(completionKeys, ['web-export-complete-fixture', 'web-export-complete-fixture'])
  })

  it('rejects a hash mismatch before consuming or saving the ticket', async () => {
    const responses = requestQueue({
      'mip.admin.exports.create': { ticketId: 'ticket-a', token: TOKEN, status: 'PENDING', expiresAt: EXPIRES_AT },
      'mip.admin.exports.prepare': ready(),
      'mip.admin.exports.reserve': reservation('mip-users-20300101T000000Z.xlsx', '0'.repeat(64)),
    })
    const saves: Array<{ fileName: string; bytes: number[] }> = []
    const workflow = createSensitiveExportWorkflow({ kind: 'users', filters: {} }, step => `web-export-${step}-fixture`)

    await assert.rejects(
      () => continueSensitiveExport(workflow, responses.request, runtime(saves)),
      (error: unknown) => error instanceof SensitiveExportError && error.code === 'EXPORT_INTEGRITY_FAILED',
    )
    assert.equal(responses.calls.some(item => item.action === 'mip.admin.exports.complete'), false)
    assert.deepEqual(saves, [])
  })
})
