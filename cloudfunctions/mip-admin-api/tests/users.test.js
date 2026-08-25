'use strict'

const assert = require('node:assert/strict')
const { createCipheriv, createHash, createHmac } = require('node:crypto')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminUsers } = require('../domain/users')
const { AdminError } = require('../domain/validation')

const phoneEncryptionKey = 'phone-encryption-secret-with-at-least-32-characters'
const caller = { appId: 'wx-trusted', identityKey: 'wechat-identity' }

function encryptedPhone(userId) {
  const master = createHash('sha256').update(phoneEncryptionKey).digest()
  const key = createHmac('sha256', master).update('mip-phone-encryption-v1').digest()
  const iv = Buffer.alloc(12, 7)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${caller.appId}\0${userId}`))
  const ciphertext = Buffer.concat([cipher.update('+86:13800138000'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

function userRow(id = 'target-user') {
  return {
    id,
    status: 'ACTIVE',
    kind: 'PLAYER',
    nickname: '用户',
    primaryBranchId: 'branch-a',
    phoneBound: true,
    phoneCiphertext: encryptedPhone(id),
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

function repository(bindings = [{
  roleKey: 'BRANCH_ADMIN',
  scopeType: 'BRANCH',
  scopeId: 'branch-a',
}]) {
  const audits = []
  return {
    audits,
    resolveUser: async () => ({
      id: 'admin-user',
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    }),
    listRoleBindings: async () => bindings,
    listUsers: async () => [],
    getUserScope: async (_appId, userId) => userId === 'missing-user'
      ? null
      : { scopeType: 'BRANCH', scopeId: 'branch-a' },
    getUserDetail: async (_appId, userId) => userRow(userId),
    getUserRelatedRecords: async () => ({
      superCases: [], opportunities: [], registrations: [], orders: [],
    }),
    recordAudit: async audit => audits.push(audit),
    updateUserFields: async input => input,
    setUserControl: async input => input,
  }
}

function usersFor(repo) {
  return createAdminUsers({
    access: createAdminAccess({ repository: repo }),
    phoneEncryptionKey,
    repository: repo,
  })
}

describe('admin users module', () => {
  it('keeps a narrow interface and returns only scoped public list fields', async () => {
    const repo = repository()
    let captured
    repo.listUsers = async (...args) => {
      captured = args
      return { items: [userRow()], nextCursor: 'next-page' }
    }
    const users = usersFor(repo)

    assert.deepEqual(Object.keys(users).sort(), [
      'getUser',
      'listUsers',
      'normalizeExportFilters',
      'setUserControl',
      'updateUser',
    ])
    const result = await users.listUsers(caller, {
      filters: { query: '  用户  ', kind: 'PLAYER' },
      includePhone: false,
      limit: 25,
    })

    assert.deepEqual(captured[1], {
      platform: false,
      branchIds: ['branch-a'],
      eventIds: [],
    })
    assert.equal(captured[2].query, '用户')
    assert.equal(captured[2].kind, 'PLAYER')
    assert.equal(captured[3], 25)
    assert.equal(captured[4], null)
    assert.equal(result.nextCursor, 'next-page')
    assert.equal(result.items[0].phoneNumber, null)
    assert.equal(Object.hasOwn(result.items[0], 'phoneCiphertext'), false)
    assert.equal(repo.audits.length, 0)
  })

  it('requires the current phone capability before listing and audits successful decryptions', async () => {
    const restrictedRepo = repository([{
      roleKey: 'PLATFORM_OPERATIONS',
      scopeType: 'PLATFORM',
      scopeId: null,
      capabilities: [CAPABILITIES.USERS_READ],
    }])
    let restrictedReads = 0
    restrictedRepo.listUsers = async () => {
      restrictedReads += 1
      return [userRow()]
    }
    await assert.rejects(
      () => usersFor(restrictedRepo).listUsers(caller, { includePhone: true }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(restrictedReads, 0)
    assert.equal(restrictedRepo.audits.length, 0)

    const ownerRepo = repository([{
      roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null,
    }])
    ownerRepo.listUsers = async () => [userRow()]
    const result = await usersFor(ownerRepo).listUsers(caller, { includePhone: true })
    assert.equal(result.items[0].phoneNumber, '+86 13800138000')
    assert.equal(Object.hasOwn(result.items[0], 'phoneCiphertext'), false)
    assert.deepEqual(ownerRepo.audits, [{
      appId: caller.appId,
      actorUserId: 'admin-user',
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.users.phone.view',
      resourceType: 'USER_LIST',
      resourceId: null,
      effectiveRole: 'PLATFORM_OWNER',
      metadata: {
        count: 1,
        filters: usersFor(ownerRepo).normalizeExportFilters({}),
        cursor: false,
      },
    }])
  })

  it('returns NOT_FOUND before scope authorization and never reads a missing detail', async () => {
    const repo = repository([{
      roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b',
    }])
    let detailReads = 0
    repo.getUserDetail = async () => {
      detailReads += 1
      return userRow()
    }
    const users = usersFor(repo)

    await assert.rejects(
      () => users.getUser(caller, { userId: 'missing-user' }),
      error => error?.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => users.getUser(caller, { userId: 'target-user' }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(detailReads, 0)
  })

  it('decrypts an authorized detail without exposing ciphertext and preserves related DTOs', async () => {
    const repo = repository()
    const users = usersFor(repo)
    const result = await users.getUser(caller, {
      userId: 'target-user',
      includePhone: true,
    })

    assert.equal(result.phoneNumber, '+86 13800138000')
    assert.equal(Object.hasOwn(result, 'phoneCiphertext'), false)
    assert.deepEqual(result.relatedRecords, {
      superCases: [], opportunities: [], registrations: [], orders: [],
    })
    assert.equal(repo.audits[0].scopeType, 'BRANCH')
    assert.equal(repo.audits[0].scopeId, 'branch-a')
    assert.equal(repo.audits[0].resourceType, 'USER')
  })

  it('passes scoped mutation evidence and preserves repository version conflicts', async () => {
    const repo = repository()
    let updateInput
    repo.updateUserFields = async (input) => {
      updateInput = input
      throw new AdminError('CONFLICT', '记录已变更')
    }
    const users = usersFor(repo)

    await assert.rejects(() => users.updateUser(caller, {
      userId: 'target-user',
      expectedVersion: 4,
      fields: { nickname: '  新昵称  ', headline: '  新标题  ' },
    }), error => error?.code === 'CONFLICT')
    assert.equal(updateInput.expectedVersion, 4)
    assert.deepEqual(updateInput.fields, { nickname: '新昵称', headline: '新标题' })
    assert.deepEqual(updateInput.authorizedScope, { scopeType: 'BRANCH', scopeId: 'branch-a' })
    assert.deepEqual(updateInput.authorization, {
      capability: CAPABILITIES.USERS_EDIT,
      effectiveGrant: {
        roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a',
      },
    })
    assert.equal(updateInput.audit.action, 'admin.users.fields.update')
    assert.deepEqual(updateInput.audit.metadata, {
      fields: ['nickname', 'headline'], expectedVersion: 4,
    })

    const control = await users.setUserControl(caller, {
      userId: 'target-user',
      controlType: 'BLOCKLIST',
      active: true,
      reason: '  违反社区规则  ',
    })
    assert.equal(control.reason, '违反社区规则')
    assert.equal(control.audit.action, 'admin.users.access.activate')
    assert.equal(control.audit.metadata.reasonLength, 6)
    assert.equal(control.authorization.capability, CAPABILITIES.USERS_CONTROL)
  })

  it('keeps list and export user filter validation identical', () => {
    const users = usersFor(repository())
    assert.deepEqual(users.normalizeExportFilters({
      joinedWithinDays: 30,
      experienceMin: 10,
      experienceMax: 20,
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-24T23:59:59.999Z',
    }), {
      query: '', status: '', kind: '', branchId: '', levelId: '', controlType: '',
      phoneBound: '', profileComplete: '', joinedWithinDays: 30,
      experienceMin: 10, experienceMax: 20,
      createdFrom: '2026-08-01 00:00:00.000',
      createdTo: '2026-08-24 23:59:59.999',
    })
    assert.throws(
      () => users.normalizeExportFilters({ experienceMin: 21, experienceMax: 20 }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })
})
