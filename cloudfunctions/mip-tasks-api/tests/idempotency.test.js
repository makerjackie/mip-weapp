'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  idempotentMutation,
  requestHash,
} = require('../domain/idempotency')

const caller = {
  appId: 'wx1234567890abcdef',
  userId: '11111111-1111-4111-8111-111111111111',
}
const operation = 'tasks.admin.save'
const key = 'task.save-retry-0001'

function memoryDatabase() {
  let stored = null
  const database = {
    async one() { return stored ? { ...stored } : null },
    async transaction(work) {
      const before = stored ? { ...stored } : null
      const tx = {
        async one(sql) {
          return sql.includes('mip_idempotency_keys') && stored ? { ...stored } : null
        },
        async query(sql, params) {
          if (sql.includes('INSERT INTO mip_idempotency_keys')) {
            if (stored) {
              const error = new Error('duplicate')
              error.code = 'ER_DUP_ENTRY'
              throw error
            }
            stored = {
              request_hash: params[5],
              status: 'RUNNING',
              response_json: null,
            }
            return { affectedRows: 1 }
          }
          if (sql.includes("status = 'COMPLETED'")) {
            if (!stored || stored.status !== 'RUNNING' || stored.request_hash !== params[3]) {
              return { affectedRows: 0 }
            }
            stored = {
              ...stored,
              status: 'COMPLETED',
              response_json: params[0],
            }
            return { affectedRows: 1 }
          }
          return { affectedRows: 1 }
        },
      }
      try { return await work(tx) }
      catch (error) {
        stored = before
        throw error
      }
    },
    stored: () => stored,
  }
  return database
}

function run(database, request, work, authorize, preflight) {
  return idempotentMutation(database, {
    caller,
    operation,
    idempotencyKey: key,
    request,
    createId: () => '22222222-2222-4222-8222-222222222222',
    authorize,
    preflight,
    work,
  })
}

describe('task admin mutation idempotency', () => {
  it('stores and replays the exact committed response without running the mutation twice', async () => {
    const database = memoryDatabase()
    let writes = 0
    let preflights = 0
    const first = await run(database, {
      task: { name: '任务', rewardExperience: 10 },
      expectedVersion: null,
    }, async () => {
      writes += 1
      return { id: 'task-1', status: 'DRAFT', version: 1 }
    }, undefined, async () => { preflights += 1 })
    const replay = await run(database, {
      expectedVersion: null,
      task: { rewardExperience: 10, name: '任务' },
    }, async () => {
      writes += 1
      throw new Error('must not run')
    }, undefined, async () => { throw new Error('must not run preflight') })

    assert.deepEqual(replay, first)
    assert.equal(writes, 1)
    assert.equal(preflights, 1)
    assert.equal(database.stored().status, 'COMPLETED')
  })

  it('rejects reuse of a key for a different normalized request', async () => {
    const database = memoryDatabase()
    await run(database, { task: { name: '任务一' } }, async () => ({ id: 'task-1' }))
    await assert.rejects(
      run(database, { task: { name: '任务二' } }, async () => ({ id: 'task-2' })),
      /IDEMPOTENCY_CONFLICT/,
    )
  })

  it('rechecks current authorization before returning a stored replay', async () => {
    const database = memoryDatabase()
    let authorized = true
    const authorize = async () => {
      if (!authorized) throw new Error('FORBIDDEN')
      return 'PLATFORM_OWNER'
    }
    await run(database, { task: { name: '任务' } }, async () => ({ id: 'task-1' }), authorize)
    authorized = false
    await assert.rejects(
      run(database, { task: { name: '任务' } }, async () => ({ id: 'task-2' }), authorize),
      /FORBIDDEN/,
    )
  })

  it('rolls back the claim with a failed mutation so the same key can recover', async () => {
    const database = memoryDatabase()
    let attempts = 0
    await assert.rejects(
      run(database, { task: { name: '任务' } }, async () => {
        attempts += 1
        throw new Error('SERVICE_UNAVAILABLE')
      }),
      /SERVICE_UNAVAILABLE/,
    )
    assert.equal(database.stored(), null)

    const recovered = await run(database, { task: { name: '任务' } }, async () => {
      attempts += 1
      return { id: 'task-1' }
    })
    assert.deepEqual(recovered, { id: 'task-1' })
    assert.equal(attempts, 2)
  })

  it('uses a canonical request hash and rejects malformed keys before a write', async () => {
    assert.equal(
      requestHash({ task: { b: 2, a: 1 }, at: new Date('2030-01-01T02:00:00.000Z') }),
      requestHash({ at: '2030-01-01T02:00:00.000Z', task: { a: 1, b: 2 } }),
    )
    await assert.rejects(
      idempotentMutation(memoryDatabase(), {
        caller,
        operation,
        idempotencyKey: 'short',
        request: {},
        work: async () => ({}),
      }),
      /VALIDATION_FAILED/,
    )
  })
})
