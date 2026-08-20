'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  MAX_ATTEMPTS,
  claimCleanupLease,
  insertCleanupOutbox,
  markCleanupDone,
  markCleanupRetry,
  processCleanupItem,
  processDueCleanup,
  requeueTerminalCleanup,
  resolveDeleteFileResults,
} = require('../domain/media-cleanup')

function createMemoryDb(seedRows = []) {
  const rows = seedRows.map(row => ({ ...row }))
  const calls = []

  function matchUpdate(sql, params) {
    calls.push({ kind: 'query', sql, params })
    if (sql.includes('INSERT INTO member_media_cleanup_outbox')) {
      const existing = rows.find(r => r.app_id === params[1] && r.media_asset_id === params[3])
      if (existing) {
        // Pure idempotent duplicate: preserve status/lease/version/attempts.
        return { affectedRows: 1 }
      }
      rows.push({
        id: params[0],
        app_id: params[1],
        user_id: params[2],
        media_asset_id: params[3],
        cloud_file_id: params[4],
        status: 'PENDING',
        attempts: 0,
        version: 1,
        lease_owner: null,
        lease_until: null,
        next_retry_at: new Date(0),
        last_error: null,
      })
      return { affectedRows: 1 }
    }
    // Explicit requeue of terminal FAILED → PENDING with fresh attempts.
    if (
      /SET\s+status\s*=\s*'PENDING'/i.test(sql)
      && /attempts\s*=\s*0/i.test(sql)
      && /status\s*=\s*'FAILED'/i.test(sql)
    ) {
      const id = params[1]
      const appId = params[2]
      const version = params[3]
      const row = rows.find(r => r.id === id && r.app_id === appId)
      if (!row || Number(row.version) !== Number(version) || row.status !== 'FAILED') {
        return { affectedRows: 0 }
      }
      row.status = 'PENDING'
      row.attempts = 0
      row.lease_owner = null
      row.lease_until = null
      row.next_retry_at = params[0]
      row.last_error = null
      row.version += 1
      return { affectedRows: 1 }
    }
    // Match SET target, not WHERE status = 'LEASED'.
    if (/SET\s+status\s*=\s*'LEASED'/i.test(sql)) {
      const id = params[2]
      const appId = params[3]
      const version = params[4]
      const row = rows.find(r => r.id === id && r.app_id === appId)
      if (!row || Number(row.version) !== Number(version)) {
        return { affectedRows: 0 }
      }
      // Default claim excludes terminal FAILED (and DONE).
      if (row.status === 'DONE' || row.status === 'FAILED') {
        return { affectedRows: 0 }
      }
      if (row.status !== 'PENDING' && row.status !== 'LEASED') {
        return { affectedRows: 0 }
      }
      row.status = 'LEASED'
      row.lease_owner = params[0]
      row.lease_until = params[1]
      row.attempts += 1
      row.version += 1
      return { affectedRows: 1 }
    }
    if (/SET\s+status\s*=\s*'DONE'/i.test(sql)) {
      const id = params[0]
      const appId = params[1]
      const version = params[2]
      const row = rows.find(r => r.id === id && r.app_id === appId)
      if (!row || Number(row.version) !== Number(version) || row.status !== 'LEASED') {
        return { affectedRows: 0 }
      }
      row.status = 'DONE'
      row.lease_owner = null
      row.lease_until = null
      row.version += 1
      return { affectedRows: 1 }
    }
    if (/SET\s+status\s*=\s*\?/i.test(sql) && sql.includes('next_retry_at')) {
      const status = params[0]
      const id = params[3]
      const appId = params[4]
      const version = params[5]
      const row = rows.find(r => r.id === id && r.app_id === appId)
      if (!row || Number(row.version) !== Number(version) || row.status !== 'LEASED') {
        return { affectedRows: 0 }
      }
      row.status = status
      row.next_retry_at = params[1]
      row.last_error = params[2]
      row.lease_owner = null
      row.lease_until = null
      row.version += 1
      return { affectedRows: 1 }
    }
    return { affectedRows: 1 }
  }

  const db = {
    rows,
    calls,
    async transaction(fn) {
      const tx = {
        async one(sql, params) {
          calls.push({ kind: 'one', sql, params })
          if (sql.includes('FROM member_media_cleanup_outbox')) {
            // media_asset_id = ? contains the substring "id = ?" — match media first.
            if (params.length >= 2 && /media_asset_id\s*=\s*\?/.test(sql)) {
              return rows.find(r => r.app_id === params[0] && r.media_asset_id === params[1]) || null
            }
            if (params.length >= 2 && /\bid\s*=\s*\?/.test(sql)) {
              return rows.find(r => r.id === params[0] && r.app_id === params[1]) || null
            }
          }
          return null
        },
        async query(sql, params) {
          return matchUpdate(sql, params)
        },
      }
      return fn(tx)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('FROM member_media_cleanup_outbox') && sql.includes('LIMIT')) {
        // Mirror processDueCleanup: PENDING and LEASED only — never terminal FAILED.
        return rows.filter(r => (
          r.app_id === params[0]
          && (r.status === 'PENDING' || r.status === 'LEASED')
        ))
      }
      return matchUpdate(sql, params)
    },
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      return rows.find(r => r.id === params[0] && r.app_id === params[1]) || null
    },
  }
  return db
}

describe('resolveDeleteFileResults', () => {
  it('requires per-item success status before DONE', () => {
    const ok = resolveDeleteFileResults({
      fileList: [{ fileID: 'cloud://a', status: 0 }],
    }, ['cloud://a'])
    assert.deepEqual(ok, [{ fileId: 'cloud://a', ok: true, reason: null }])

    const missing = resolveDeleteFileResults({ fileList: [] }, ['cloud://a'])
    assert.equal(missing[0].ok, false)
    assert.equal(missing[0].reason, 'MISSING_ITEM_STATUS')

    const failed = resolveDeleteFileResults({
      fileList: [{ fileID: 'cloud://a', status: -1, errMsg: 'storage fail' }],
    }, ['cloud://a'])
    assert.equal(failed[0].ok, false)
  })

  it('item present but status missing is not success', () => {
    const noStatus = resolveDeleteFileResults({
      fileList: [{ fileID: 'cloud://a', errMsg: '' }],
    }, ['cloud://a'])
    assert.equal(noStatus[0].ok, false)
    assert.notEqual(noStatus[0].reason, null)

    const undefinedStatus = resolveDeleteFileResults({
      fileList: [{ fileID: 'cloud://a', status: undefined }],
    }, ['cloud://a'])
    assert.equal(undefinedStatus[0].ok, false)

    // Documented explicit success codes still pass.
    for (const status of [0, '0', 'ok', 'SUCCESS']) {
      const resolved = resolveDeleteFileResults({
        fileList: [{ fileID: 'cloud://a', status }],
      }, ['cloud://a'])
      assert.equal(resolved[0].ok, true, `status=${status} should be ok`)
    }
  })
})

describe('media cleanup outbox lease/retry', () => {
  it('inserts PENDING outbox rows and claims with version', async () => {
    const db = createMemoryDb()
    const row = await db.transaction(tx => insertCleanupOutbox(tx, {
      appId: 'app-1',
      userId: 'user-1',
      mediaAssetId: 'asset-1',
      cloudFileId: 'cloud://file-1',
    }))
    assert.equal(row.status, 'PENDING')
    assert.equal(row.version, 1)

    const claimed = await db.transaction(tx => claimCleanupLease(tx, {
      appId: 'app-1',
      outboxId: row.id,
      leaseOwner: 'worker-a',
      expectedVersion: 1,
    }))
    assert.equal(claimed.status, 'LEASED')
    assert.equal(claimed.version, 2)
    assert.equal(claimed.attempts, 1)
  })

  it('concurrent claim with stale version loses the race', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 0,
      version: 3,
      next_retry_at: new Date(0),
    }])
    const lost = await db.transaction(tx => claimCleanupLease(tx, {
      appId: 'app-1',
      outboxId: 'out-1',
      leaseOwner: 'worker-b',
      expectedVersion: 1,
    }))
    assert.equal(lost, null)
  })

  it('marks DONE only after per-item resolved success', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 0,
      version: 1,
      next_retry_at: new Date(0),
    }])
    const cloudOk = {
      async deleteFile() {
        return { fileList: [{ fileID: 'cloud://file-1', status: 0 }] }
      },
    }
    const done = await processCleanupItem(db, cloudOk, {
      id: 'out-1',
      app_id: 'app-1',
    }, { leaseOwner: 'w1' })
    assert.equal(done.status, 'DONE')
    assert.equal(db.rows[0].status, 'DONE')
  })

  it('per-item resolved failure schedules retry without DONE', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 0,
      version: 1,
      next_retry_at: new Date(0),
    }])
    const cloudFail = {
      async deleteFile() {
        return { fileList: [{ fileID: 'cloud://file-1', status: -503002, errMsg: 'timeout' }] }
      },
    }
    const result = await processCleanupItem(db, cloudFail, {
      id: 'out-1',
      app_id: 'app-1',
    }, { leaseOwner: 'w1' })
    assert.equal(result.status, 'PENDING')
    assert.equal(db.rows[0].status, 'PENDING')
    assert.ok(db.rows[0].last_error)
    assert.notEqual(db.rows[0].status, 'DONE')
  })

  it('missing per-item status does not converge to DONE', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 0,
      version: 1,
      next_retry_at: new Date(0),
    }])
    const cloudEmpty = {
      async deleteFile() {
        return { fileList: [] }
      },
    }
    const result = await processCleanupItem(db, cloudEmpty, {
      id: 'out-1',
      app_id: 'app-1',
    })
    assert.notEqual(result.status, 'DONE')
    assert.equal(db.rows[0].status, 'PENDING')
  })

  it('item present with missing status does not mark DONE on processCleanupItem', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 0,
      version: 1,
      next_retry_at: new Date(0),
    }])
    const cloudMissingStatus = {
      async deleteFile() {
        // Item exists but status is omitted — fail-closed, not DONE.
        return { fileList: [{ fileID: 'cloud://file-1', errMsg: '' }] }
      },
    }
    const result = await processCleanupItem(db, cloudMissingStatus, {
      id: 'out-1',
      app_id: 'app-1',
    })
    assert.notEqual(result.status, 'DONE')
    assert.equal(db.rows[0].status, 'PENDING')
    assert.ok(db.rows[0].last_error)
  })

  it('processDueCleanup retries pending rows', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'PENDING',
      attempts: 1,
      version: 2,
      next_retry_at: new Date(0),
    }])
    let calls = 0
    const cloud = {
      async deleteFile() {
        calls += 1
        return { fileList: [{ fileID: 'cloud://file-1', status: 0 }] }
      },
    }
    const batch = await processDueCleanup(db, cloud, { appId: 'app-1', limit: 5 })
    assert.equal(batch.processed, 1)
    assert.equal(batch.results[0].status, 'DONE')
    assert.equal(calls, 1)
  })

  it('terminal FAILED after MAX_ATTEMPTS is not reclaimed by claim or processDueCleanup', async () => {
    const db = createMemoryDb([{
      id: 'out-failed',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'FAILED',
      attempts: MAX_ATTEMPTS,
      version: 20,
      next_retry_at: new Date(0),
      last_error: 'exhausted',
    }])
    let deleteCalls = 0
    const cloud = {
      async deleteFile() {
        deleteCalls += 1
        return { fileList: [{ fileID: 'cloud://file-1', status: 0 }] }
      },
    }

    const claimed = await db.transaction(tx => claimCleanupLease(tx, {
      appId: 'app-1',
      outboxId: 'out-failed',
      leaseOwner: 'worker-x',
      expectedVersion: 20,
    }))
    assert.equal(claimed, null, 'claimCleanupLease must not claim terminal FAILED')

    const batch = await processDueCleanup(db, cloud, { appId: 'app-1', limit: 5 })
    assert.equal(batch.processed, 0)
    assert.equal(deleteCalls, 0)
    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].attempts, MAX_ATTEMPTS)

    const direct = await processCleanupItem(db, cloud, {
      id: 'out-failed',
      app_id: 'app-1',
    })
    assert.equal(direct.status, 'SKIPPED')
    assert.equal(deleteCalls, 0)
  })

  it('requeueTerminalCleanup enables further processing and is version-guarded', async () => {
    const db = createMemoryDb([{
      id: 'out-failed',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'FAILED',
      attempts: MAX_ATTEMPTS,
      version: 20,
      next_retry_at: new Date(0),
      last_error: 'exhausted',
    }])

    const stale = await db.transaction(tx => requeueTerminalCleanup(tx, {
      appId: 'app-1',
      outboxId: 'out-failed',
      expectedVersion: 19,
      actorId: 'admin-1',
      reason: 'stale version',
    }))
    assert.equal(stale.ok, false)
    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].attempts, MAX_ATTEMPTS)
    assert.equal(db.rows[0].version, 20)

    const requeued = await db.transaction(tx => requeueTerminalCleanup(tx, {
      appId: 'app-1',
      outboxId: 'out-failed',
      expectedVersion: 20,
      actorId: 'admin-1',
      reason: 'operator requeue',
    }))
    assert.equal(requeued.ok, true)
    assert.equal(db.rows[0].status, 'PENDING')
    assert.equal(db.rows[0].attempts, 0)
    assert.equal(db.rows[0].lease_owner, null)
    assert.equal(db.rows[0].lease_until, null)
    assert.equal(db.rows[0].last_error, null)
    assert.equal(db.rows[0].version, 21)
    assert.ok(db.rows[0].next_retry_at instanceof Date)

    // Non-FAILED rows cannot be requeued.
    const notFailed = await db.transaction(tx => requeueTerminalCleanup(tx, {
      appId: 'app-1',
      outboxId: 'out-failed',
      expectedVersion: 21,
      actorId: 'admin-1',
      reason: 'already pending',
    }))
    assert.equal(notFailed.ok, false)

    let deleteCalls = 0
    const cloud = {
      async deleteFile() {
        deleteCalls += 1
        return { fileList: [{ fileID: 'cloud://file-1', status: 0 }] }
      },
    }
    const batch = await processDueCleanup(db, cloud, { appId: 'app-1', limit: 5 })
    assert.equal(batch.processed, 1)
    assert.equal(batch.results[0].status, 'DONE')
    assert.equal(deleteCalls, 1)
    assert.equal(db.rows[0].status, 'DONE')
  })

  it('markCleanupDone is version-guarded', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'LEASED',
      attempts: 1,
      version: 5,
    }])
    const ok = await db.transaction(tx => markCleanupDone(tx, {
      appId: 'app-1',
      outboxId: 'out-1',
      expectedVersion: 5,
    }))
    assert.equal(ok, true)
    const lost = await db.transaction(tx => markCleanupRetry(tx, {
      appId: 'app-1',
      outboxId: 'out-1',
      expectedVersion: 5,
      lastError: 'stale',
    }))
    assert.equal(lost.ok, false)
  })

  it('markCleanupRetry sets terminal FAILED at MAX_ATTEMPTS', async () => {
    const db = createMemoryDb([{
      id: 'out-1',
      app_id: 'app-1',
      user_id: 'user-1',
      media_asset_id: 'asset-1',
      cloud_file_id: 'cloud://file-1',
      status: 'LEASED',
      attempts: MAX_ATTEMPTS,
      version: 12,
    }])
    const result = await db.transaction(tx => markCleanupRetry(tx, {
      appId: 'app-1',
      outboxId: 'out-1',
      expectedVersion: 12,
      lastError: 'still failing',
    }))
    assert.equal(result.ok, true)
    assert.equal(result.status, 'FAILED')
    assert.equal(db.rows[0].status, 'FAILED')
  })

  it('duplicate outbox key is idempotent and never resets FAILED/LEASED/PENDING/DONE', async () => {
    for (const seed of [
      {
        status: 'FAILED',
        attempts: MAX_ATTEMPTS,
        version: 20,
        lease_owner: null,
        lease_until: null,
        last_error: 'exhausted',
      },
      {
        status: 'LEASED',
        attempts: 3,
        version: 7,
        lease_owner: 'worker-a',
        lease_until: new Date('2030-01-01T00:00:00Z'),
        last_error: null,
      },
      {
        status: 'PENDING',
        attempts: 2,
        version: 4,
        lease_owner: null,
        lease_until: null,
        last_error: 'retry later',
      },
      {
        status: 'DONE',
        attempts: 1,
        version: 3,
        lease_owner: null,
        lease_until: null,
        last_error: null,
      },
    ]) {
      const db = createMemoryDb([{
        id: 'out-dup',
        app_id: 'app-1',
        user_id: 'user-1',
        media_asset_id: 'asset-dup',
        cloud_file_id: 'cloud://file-old',
        next_retry_at: new Date(0),
        ...seed,
      }])
      const before = { ...db.rows[0] }
      const row = await db.transaction(tx => insertCleanupOutbox(tx, {
        appId: 'app-1',
        userId: 'user-1',
        mediaAssetId: 'asset-dup',
        cloudFileId: 'cloud://file-new',
      }))
      assert.equal(row.status, seed.status, `status preserved for ${seed.status}`)
      assert.equal(row.attempts, seed.attempts, `attempts preserved for ${seed.status}`)
      assert.equal(row.version, seed.version, `version preserved for ${seed.status}`)
      assert.equal(db.rows[0].status, before.status)
      assert.equal(db.rows[0].attempts, before.attempts)
      assert.equal(db.rows[0].version, before.version)
      assert.equal(db.rows[0].lease_owner, before.lease_owner)
      assert.equal(db.rows[0].lease_until, before.lease_until)
      assert.equal(db.rows[0].last_error, before.last_error)
      assert.equal(db.rows[0].cloud_file_id, before.cloud_file_id)
    }
  })
})

describe('media-cleanup package isolation', () => {
  it('membership-api and membership-admin-api media-cleanup.js are byte-identical', () => {
    const apiPath = path.resolve(__dirname, '../domain/media-cleanup.js')
    const adminPath = path.resolve(
      __dirname,
      '../../membership-admin-api/domain/media-cleanup.js',
    )
    assert.equal(fs.existsSync(apiPath), true, 'membership-api media-cleanup.js missing')
    assert.equal(fs.existsSync(adminPath), true, 'membership-admin-api media-cleanup.js missing')
    const apiBytes = fs.readFileSync(apiPath)
    const adminBytes = fs.readFileSync(adminPath)
    assert.equal(
      apiBytes.equals(adminBytes),
      true,
      'media-cleanup.js must be byte-identical across membership-api and membership-admin-api',
    )
  })
})
