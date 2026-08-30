'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createMembershipInvitationCode,
  invitationCodeKey,
} = require('../lib/membership-invitation-code')

const env = {
  MIP_DEPLOYMENT_STAGE: 'test',
  MIP_MEDIA_SCOPE_SECRET: 'membership-code-media-secret-more-than-32-characters',
}
const scene = 'a1234567890123456789012345678901'
const inviterUserId = '10000000-0000-4000-8000-000000000001'
const invitationId = '20000000-0000-4000-8000-000000000001'
const leaseToken = '30000000-0000-4000-8000-000000000001'
const assetId = '40000000-0000-4000-8000-000000000001'
const allocationId = '50000000-0000-4000-8000-000000000001'

function png() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ])
}

describe('membership invitation mini-program code', () => {
  it('uses an opaque isolated object key and the membership page', async () => {
    const appId = 'wx-app'
    const key = invitationCodeKey({ appId, scene, allocationId, env })
    assert.match(key, /^mip\/test\/[0-9a-f]{24}\/membership-invitations\/[0-9a-f]{32}\.png$/)
    assert.equal(key.includes(appId), false)
    let options
    const reads = []
    const queries = []
    const result = await createMembershipInvitationCode({
      appId,
      inviterUserId,
      invitationId,
      leaseToken,
      allocationId,
      assetId,
      scene,
      env,
      database: {
        async one() { return null },
        async query() { return { affectedRows: 1 } },
        async transaction(work) {
          return work({
            async one(sql) {
              reads.push(sql)
              if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return { id: invitationId }
              if (sql.includes('FROM mip_media_assets')) return null
              if (sql.includes('FROM mip_users')) return { id: inviterUserId, status: 'ACTIVE' }
              if (sql.includes('SELECT code_asset_id')) return { code_asset_id: assetId }
              return null
            },
            async query(sql, params) {
              queries.push({ sql, params })
              return { affectedRows: 1 }
            },
          })
        },
      },
      cloud: {
        openapi: { wxacode: { async getUnlimited(value) { options = value; return { buffer: png() } } } },
        async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
      },
    })
    assert.equal(options.page, 'pages/membership/index')
    assert.equal(options.scene, scene)
    assert.equal(options.envVersion, 'develop')
    assert.equal(result.codeUrl, `cloud://env.test/${key}`)
    assert.equal(result.assetId, assetId)
    assert.equal(queries.some(call => call.sql.includes("'MEMBERSHIP_INVITATION_CODE'")), true)
    assert.equal(queries.some(call => call.sql.includes("status = 'READY'")), true)
    assert.equal(queries.some(call => call.sql.includes('SET code_asset_id = ?')), true)
    assert.equal(reads.some(sql => sql.includes('FROM mip_membership_entitlements entitlement')), true)
  })

  it('recovers a committed upload timeout by retrying the same bytes at the same allocation key', async () => {
    const appId = 'wx-app'
    const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const codeUrl = `cloud://env.test/${objectKey}`
    const storedObjects = new Map()
    let uploadCalls = 0
    let firstBuffer
    const database = {
      async one() { return null },
      async query() { return { affectedRows: 1 } },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return { id: invitationId }
            if (sql.includes('FROM mip_media_assets')) return null
            if (sql.includes('FROM mip_users')) return { id: inviterUserId }
            if (sql.includes('SELECT code_asset_id')) return { code_asset_id: assetId }
            return null
          },
          async query() { return { affectedRows: 1 } },
        })
      },
    }
    const result = await createMembershipInvitationCode({
      appId,
      inviterUserId,
      invitationId,
      leaseToken,
      allocationId,
      assetId,
      scene,
      env,
      database,
      cloud: {
        openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
        async uploadFile({ cloudPath, fileContent }) {
          uploadCalls += 1
          assert.equal(cloudPath, objectKey)
          if (!firstBuffer) firstBuffer = fileContent
          else assert.equal(fileContent, firstBuffer)
          storedObjects.set(cloudPath, Buffer.from(fileContent))
          if (uploadCalls === 1) throw new Error('UPLOAD_RESPONSE_TIMEOUT')
          return { fileID: codeUrl }
        },
      },
    })
    assert.equal(uploadCalls, 2)
    assert.equal(storedObjects.size, 1)
    assert.equal(storedObjects.has(objectKey), true)
    assert.deepEqual(result, { assetId, codeUrl, objectKey })
  })

  it('keeps one durable allocation key when both upload responses are unknown', async () => {
    const appId = 'wx-app'
    const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const storedObjects = new Set()
    const bindings = []
    let uploadCalls = 0
    await assert.rejects(
      createMembershipInvitationCode({
        appId,
        inviterUserId,
        invitationId,
        leaseToken,
        allocationId,
        assetId,
        scene,
        env,
        database: {
          async one() { return null },
          async query(sql, params) {
            bindings.push({ sql, params })
            return { affectedRows: 1 }
          },
          async transaction() { assert.fail('unknown upload must not invent a media fact') },
        },
        cloud: {
          openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
          async uploadFile({ cloudPath }) {
            uploadCalls += 1
            storedObjects.add(cloudPath)
            throw new Error('UPLOAD_RESPONSE_TIMEOUT')
          },
        },
      }),
      /MEMBERSHIP_INVITATION_CODE_UNAVAILABLE/,
    )
    assert.equal(uploadCalls, 2)
    assert.deepEqual([...storedObjects], [objectKey])
    const binding = bindings.find(call => call.sql.includes('SET allocation_object_key = ?'))
    assert.equal(binding.params[0], objectKey)
  })

  it('recovers a committed READY code after an unknown transaction outcome', async () => {
    const appId = 'wx-app'
    const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const codeUrl = `cloud://env.test/${objectKey}`
    let transactionCount = 0
    let deleteCalls = 0
    const database = {
      async one() {
        return {
          status: 'READY',
          allocation_id: allocationId,
          allocation_asset_id: assetId,
          unexpired: 1,
          code_asset_id: assetId,
          owner_user_id: inviterUserId,
          asset_status: 'READY',
          object_key: objectKey,
          cloud_file_id: codeUrl,
        }
      },
      async transaction(work) {
        transactionCount += 1
        const result = await work({
          async one(sql) {
            if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return { id: invitationId }
            if (sql.includes('FROM mip_media_assets')) return null
            if (sql.includes('FROM mip_users')) return { id: inviterUserId, status: 'ACTIVE' }
            if (sql.includes('SELECT code_asset_id')) return { code_asset_id: assetId }
            return null
          },
          async query() { return { affectedRows: 1 } },
        })
        if (transactionCount === 2) throw new Error('COMMIT_RESULT_UNKNOWN')
        return result
      },
      async query() { return { affectedRows: 1 } },
    }
    const result = await createMembershipInvitationCode({
      appId,
      inviterUserId,
      invitationId,
      leaseToken,
      allocationId,
      assetId,
      scene,
      env,
      database,
      cloud: {
        openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
        async uploadFile() { return { fileID: codeUrl } },
        async deleteFile() { deleteCalls += 1 },
      },
    })
    assert.deepEqual(result, { assetId, codeUrl, objectKey })
    assert.equal(deleteCalls, 0)
  })

  it('deletes only the exact failed upload and records both tombstones', async () => {
    const appId = 'wx-app'
    const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const codeUrl = `cloud://env.test/${objectKey}`
    const updates = []
    let deleteCalls = 0
    const database = {
      async one() {
        return {
          status: 'PENDING',
          lease_token: leaseToken,
          allocation_id: allocationId,
          allocation_asset_id: assetId,
          code_asset_id: assetId,
          owner_user_id: null,
          asset_status: 'PENDING',
          object_key: objectKey,
          cloud_file_id: codeUrl,
        }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return { id: invitationId }
            if (sql.includes('FROM mip_media_assets')) return null
            if (sql.includes('FROM mip_users')) return null
            if (sql.includes('SELECT code_asset_id')) return { code_asset_id: assetId }
            return null
          },
          async query(sql) {
            updates.push(sql)
            return { affectedRows: 1 }
          },
        })
      },
      async query(sql) {
        updates.push(sql)
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(
      createMembershipInvitationCode({
        appId,
        inviterUserId,
        invitationId,
        leaseToken,
        allocationId,
        assetId,
        scene,
        env,
        database,
        cloud: {
          openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
          async uploadFile() { return { fileID: codeUrl } },
          async deleteFile({ fileList }) {
            deleteCalls += 1
            assert.deepEqual(fileList, [codeUrl])
            return { fileList: [{ fileID: codeUrl, status: 0 }] }
          },
        },
      }),
      /MEMBERSHIP_INVITATION_FORBIDDEN/,
    )
    assert.equal(deleteCalls, 1)
    assert.equal(updates.some(sql => sql.includes("status = 'DELETED'")), true)
    assert.equal(updates.some(sql => sql.includes("status = 'FAILED'")), true)
  })

  it('binds each reclaimed lease to a distinct object and a stale holder deletes only its allocation', async () => {
    const appId = 'wx-app'
    const winnerAllocationId = '60000000-0000-4000-8000-000000000001'
    const winnerAssetId = '70000000-0000-4000-8000-000000000001'
    const winnerLeaseToken = '80000000-0000-4000-8000-000000000001'
    const staleObjectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const winnerObjectKey = invitationCodeKey({ appId, scene, allocationId: winnerAllocationId, env })
    const staleCodeUrl = `cloud://env.test/${staleObjectKey}`
    const deletedFiles = []
    const writes = []
    const database = {
      async one() {
        return {
          status: 'PENDING',
          lease_token: winnerLeaseToken,
          allocation_id: winnerAllocationId,
          allocation_asset_id: winnerAssetId,
          code_asset_id: null,
          owner_user_id: null,
          asset_status: null,
        }
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return null
            if (sql.includes('FROM mip_media_assets')) return null
            return null
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    await assert.rejects(
      createMembershipInvitationCode({
        appId,
        inviterUserId,
        invitationId,
        leaseToken,
        allocationId,
        assetId,
        scene,
        env,
        database,
        cloud: {
          openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
          async uploadFile({ cloudPath }) {
            assert.equal(cloudPath, staleObjectKey)
            return { fileID: staleCodeUrl }
          },
          async deleteFile({ fileList }) {
            deletedFiles.push(...fileList)
            return { fileList: [{ fileID: fileList[0], status: 0 }] }
          },
        },
      }),
      /MEMBERSHIP_INVITATION_CODE_UNAVAILABLE/,
    )
    assert.notEqual(staleObjectKey, winnerObjectKey)
    assert.deepEqual(deletedFiles, [staleCodeUrl])
    assert.equal(deletedFiles.includes(`cloud://env.test/${winnerObjectKey}`), false)
    assert.equal(writes.some(call => call.sql.includes('INSERT INTO mip_media_assets')), true)
    assert.equal(writes.some(call => call.sql.includes("status = 'DELETED'")), true)
  })

  it('tombstones and removes its own upload when account closure expires the claim first', async () => {
    const appId = 'wx-app'
    const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
    const codeUrl = `cloud://env.test/${objectKey}`
    const writes = []
    let deleteCalls = 0
    const database = {
      async one() {
        return {
          status: 'EXPIRED',
          lease_token: null,
          allocation_id: allocationId,
          allocation_asset_id: assetId,
          code_asset_id: null,
          owner_user_id: null,
          asset_status: null,
        }
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('SELECT id FROM mip_membership_invitation_codes')) return null
            if (sql.includes('FROM mip_media_assets')) return null
            return null
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    await assert.rejects(
      createMembershipInvitationCode({
        appId,
        inviterUserId,
        invitationId,
        leaseToken,
        allocationId,
        assetId,
        scene,
        env,
        database,
        cloud: {
          openapi: { wxacode: { async getUnlimited() { return { buffer: png() } } } },
          async uploadFile() { return { fileID: codeUrl } },
          async deleteFile() {
            deleteCalls += 1
            return { fileList: [{ fileID: codeUrl, status: 0 }] }
          },
        },
      }),
      /MEMBERSHIP_INVITATION_CODE_UNAVAILABLE/,
    )
    assert.equal(deleteCalls, 1)
    assert.equal(writes.some(call => call.sql.includes('INSERT INTO mip_media_assets')), true)
    assert.equal(writes.some(call => call.sql.includes("status = 'DELETED'")), true)
  })

  it('fails closed when the mini-program code adapter is unavailable', async () => {
    await assert.rejects(
      createMembershipInvitationCode({ appId: 'wx-app', scene, env, cloud: {} }),
      /MEMBERSHIP_INVITATION_CODE_UNAVAILABLE/,
    )
  })
})
