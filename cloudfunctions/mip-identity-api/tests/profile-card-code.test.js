'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createProfileCardCode,
  createProfileCardScene,
  readProfileCardScene,
} = require('../lib/profile-card-code')

const pepper = 'identity-pepper-with-at-least-thirty-two-characters'
const appId = 'wx-profile-card-test'
const userId = '10000000-0000-4000-8000-000000000001'

function png() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
}

function jpeg() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
}

test('creates a compact AppID-bound opaque scene', () => {
  const scene = createProfileCardScene({ appId, userId }, pepper)
  assert.match(scene, /^pc1_[A-Za-z0-9_-]{22}$/)
  assert.equal(scene.length, 26)
  assert.equal(readProfileCardScene(scene, appId, pepper), userId)
  assert.throws(() => readProfileCardScene(scene, 'wx-other-app', pepper), /PUBLIC_PROFILE_NOT_FOUND/)
})

test('creates and stores a profile card mini-program code', async () => {
  let request
  const result = await createProfileCardCode({
    appId,
    userId,
    pepper,
    env: {
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MEDIA_SCOPE_SECRET: 'media-scope-secret-with-at-least-thirty-two-characters',
    },
    cloud: {
      openapi: { wxacode: { async getUnlimited(value) { request = value; return { buffer: png() } } } },
      async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
    },
  })
  assert.deepEqual(request, {
    scene: createProfileCardScene({ appId, userId }, pepper),
    page: 'packages/member/mip-public-profile/index',
    width: 430,
    checkPath: false,
    envVersion: 'develop',
  })
  assert.match(result.codeUrl, /^cloud:\/\/env\.test\/mip\/test\/[a-f0-9]{24}\/profile-cards\/[a-f0-9]{32}\.png$/)
})

test('accepts typed-array mini-program code buffers returned by the cloud runtime', async () => {
  const result = await createProfileCardCode({
    appId,
    userId,
    pepper,
    env: {
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MEDIA_SCOPE_SECRET: 'media-scope-secret-with-at-least-thirty-two-characters',
    },
    cloud: {
      openapi: { wxacode: { async getUnlimited() { return { buffer: new Uint8Array(png()) } } } },
      async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
    },
  })
  assert.match(result.codeUrl, /^cloud:\/\/env\.test\/mip\/test\/[a-f0-9]{24}\/profile-cards\/[a-f0-9]{32}\.png$/)
})

test('accepts base64 mini-program code buffers returned by a serialized runtime', async () => {
  const result = await createProfileCardCode({
    appId,
    userId,
    pepper,
    env: {
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MEDIA_SCOPE_SECRET: 'media-scope-secret-with-at-least-thirty-two-characters',
    },
    cloud: {
      openapi: { wxacode: { async getUnlimited() { return { buffer: png().toString('base64') } } } },
      async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
    },
  })
  assert.match(result.codeUrl, /^cloud:\/\/env\.test\/mip\/test\/[a-f0-9]{24}\/profile-cards\/[a-f0-9]{32}\.png$/)
})

test('stores the JPEG format returned by the WeChat code provider with its matching extension', async () => {
  const result = await createProfileCardCode({
    appId,
    userId,
    pepper,
    env: {
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MEDIA_SCOPE_SECRET: 'media-scope-secret-with-at-least-thirty-two-characters',
    },
    cloud: {
      openapi: { wxacode: { async getUnlimited() { return { buffer: new Uint8Array(jpeg()) } } } },
      async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
    },
  })
  assert.match(result.codeUrl, /^cloud:\/\/env\.test\/mip\/test\/[a-f0-9]{24}\/profile-cards\/[a-f0-9]{32}\.jpg$/)
})

test('returns a bounded stage error when the mini-program code provider is unavailable', async () => {
  await assert.rejects(createProfileCardCode({
    appId,
    userId,
    pepper,
    env: {
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MEDIA_SCOPE_SECRET: 'media-scope-secret-with-at-least-thirty-two-characters',
    },
    cloud: {
      openapi: { wxacode: { async getUnlimited() { throw new Error('provider detail') } } },
      async uploadFile() { throw new Error('must not run') },
    },
  }), /PROFILE_CARD_OPENAPI_UNAVAILABLE/)
})
