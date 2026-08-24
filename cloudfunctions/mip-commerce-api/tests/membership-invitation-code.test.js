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

function png() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ])
}

describe('membership invitation mini-program code', () => {
  it('uses an opaque isolated object key and the membership page', async () => {
    const appId = 'wx-app'
    const key = invitationCodeKey({ appId, scene, env })
    assert.match(key, /^mip\/test\/[0-9a-f]{24}\/membership-invitations\/[0-9a-f]{32}\.png$/)
    assert.equal(key.includes(appId), false)
    let options
    const result = await createMembershipInvitationCode({
      appId,
      scene,
      env,
      cloud: {
        openapi: { wxacode: { async getUnlimited(value) { options = value; return { buffer: png() } } } },
        async uploadFile(value) { return { fileID: `cloud://env.test/${value.cloudPath}` } },
      },
    })
    assert.equal(options.page, 'pages/membership/index')
    assert.equal(options.scene, scene)
    assert.equal(options.envVersion, 'develop')
    assert.equal(result.codeUrl, `cloud://env.test/${key}`)
  })

  it('fails closed when the mini-program code adapter is unavailable', async () => {
    await assert.rejects(
      createMembershipInvitationCode({ appId: 'wx-app', scene, env, cloud: {} }),
      /MEMBERSHIP_INVITATION_CODE_UNAVAILABLE/,
    )
  })
})
