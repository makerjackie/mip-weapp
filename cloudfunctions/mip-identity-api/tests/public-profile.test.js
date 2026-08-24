'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createIdentityService, publicProfileDto } = require('../domain/service')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')

const appId = 'wx-test-app'
const userId = '10000000-0000-4000-8000-000000000001'
const pepper = 'public-profile-test-pepper-with-more-than-32-characters'

test('profile refs are opaque, authenticated, and bound to one AppID', () => {
  const profileRef = createProfileRef({ appId, userId }, pepper)
  assert.match(profileRef, /^p1\./)
  assert.equal(profileRef.includes(userId), false)
  assert.equal(readProfileRef(profileRef, appId, pepper), userId)
  assert.throws(() => readProfileRef(profileRef, 'another-app', pepper), /PUBLIC_PROFILE_NOT_FOUND/)
  const tamperedParts = profileRef.split('.')
  const tamperedTagPrefix = tamperedParts[3].startsWith('A') ? 'B' : 'A'
  tamperedParts[3] = `${tamperedTagPrefix}${tamperedParts[3].slice(1)}`
  assert.throws(
    () => readProfileRef(tamperedParts.join('.'), appId, pepper),
    /PUBLIC_PROFILE_NOT_FOUND/,
  )
})

test('public profile DTO includes only visibility-approved fields', () => {
  const profile = publicProfileDto('p1.opaque', {
    profile: {
      nickname: '不应公开的昵称',
      avatar_file_id: 'cloud://avatar',
      identity_status: '创业者',
      headline: '公开介绍',
      introduction: '不应公开的简介',
      companies_json: '[{"name":"不应公开的公司"}]',
      organizations_json: '[{"name":"公开组织"}]',
      branch_name: '广州分会',
      branch_city_name: '广州',
      is_player: 1,
      visibility_json: JSON.stringify({
        nickname: false,
        avatar: false,
        identityStatus: false,
        headline: true,
        introduction: false,
        companies: false,
        organizations: true,
        industry: false,
        abilities: true,
        primaryBranch: false,
      }),
      user_id: userId,
      phone_ciphertext: Buffer.from('secret'),
      openid: 'secret-openid',
    },
    tags: [
      { relation: 'PRIMARY_INDUSTRY', label: '不应公开的行业' },
      { relation: 'ABILITY', label: '项目管理' },
    ],
  })
  assert.deepEqual(profile, {
    profileRef: 'p1.opaque',
    isSelf: false,
    headline: '公开介绍',
    organizations: [{ name: '公开组织' }],
    abilities: [{ label: '项目管理' }],
  })
  for (const forbidden of ['userId', 'user_id', 'openid', 'phone', 'phoneNumber']) {
    assert.equal(forbidden in profile, false)
  }
})

test('public profile lookup does not create or authenticate an application user', async () => {
  let ensured = false
  const service = createIdentityService({
    repository: {
      ensureUser() {
        ensured = true
        throw new Error('SHOULD_NOT_RUN')
      },
      async findUserByIdentity() {
        return null
      },
      async loadPublicProfile(receivedAppId, receivedUserId, viewerUserId) {
        assert.equal(receivedAppId, appId)
        assert.equal(receivedUserId, userId)
        assert.equal(viewerUserId, null)
        return {
          profile: {
            nickname: '公开用户',
            visibility_json: '{}',
            companies_json: '[]',
            organizations_json: '[]',
            is_player: 0,
          },
          tags: [],
        }
      },
    },
    profileRefReader: () => userId,
  })
  const result = await service.getPublicProfile({ appId }, { profileRef: 'p1.opaque' })
  assert.equal(result.nickname, '公开用户')
  assert.equal(result.isSelf, false)
  assert.equal(ensured, false)
})

test('public profile lookup passes an existing viewer without creating one', async () => {
  const calls = []
  const service = createIdentityService({
    repository: {
      async findUserByIdentity(caller) {
        calls.push(['viewer', caller.appId])
        return { id: 'viewer-user' }
      },
      async loadPublicProfile(receivedAppId, receivedUserId, viewerUserId) {
        calls.push(['profile', receivedAppId, receivedUserId, viewerUserId])
        return null
      },
    },
    profileRefReader: () => userId,
  })

  await assert.rejects(
    () => service.getPublicProfile({ appId, identityKey: 'identity' }, { profileRef: 'p1.opaque' }),
    /PUBLIC_PROFILE_NOT_FOUND/,
  )
  assert.deepEqual(calls, [
    ['viewer', appId],
    ['profile', appId, userId, 'viewer-user'],
  ])
})

test('public profile marks the authenticated subject as self without exposing its id', async () => {
  const service = createIdentityService({
    repository: {
      async findUserByIdentity() {
        return { id: userId }
      },
      async loadPublicProfile() {
        return {
          profile: {
            nickname: '本人',
            visibility_json: '{}',
            companies_json: '[]',
            organizations_json: '[]',
          },
          tags: [],
        }
      },
    },
    profileRefReader: () => userId,
  })

  const result = await service.getPublicProfile(
    { appId, identityKey: 'identity' },
    { profileRef: 'p1.opaque' },
  )
  assert.equal(result.isSelf, true)
  assert.equal('userId' in result, false)
})
