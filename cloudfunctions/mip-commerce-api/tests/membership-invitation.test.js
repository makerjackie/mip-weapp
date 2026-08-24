'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createMembershipInvitation,
  createMembershipInvitationScene,
  hashMembershipInvitation,
  readMembershipInvitation,
  readMembershipInvitationScene,
} = require('../lib/membership-invitation')

const secret = 'membership-invitation-secret-with-more-than-32-characters'
const inviterUserId = '20000000-0000-4000-8000-000000000001'

describe('membership invitation token', () => {
  it('is opaque, AppID-bound, expiring, and tamper-evident', () => {
    const token = createMembershipInvitation({
      appId: 'app-1',
      inviterUserId,
      expiresAt: new Date('2026-09-23T00:00:00.000Z'),
    }, secret)
    assert.match(token, /^m1\./)
    assert.equal(token.includes(inviterUserId), false)
    assert.deepEqual(
      readMembershipInvitation(token, 'app-1', secret, new Date('2026-08-24T00:00:00.000Z')),
      { inviterUserId, expiresAt: '2026-09-23T00:00:00.000Z' },
    )
    assert.match(hashMembershipInvitation(token), /^[0-9a-f]{64}$/)
    assert.throws(
      () => readMembershipInvitation(token, 'app-2', secret, new Date('2026-08-24T00:00:00.000Z')),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
    const tokenParts = token.split('.')
    tokenParts[3] = `${tokenParts[3][0] === 'a' ? 'b' : 'a'}${tokenParts[3].slice(1)}`
    const tampered = tokenParts.join('.')
    assert.throws(
      () => readMembershipInvitation(tampered, 'app-1', secret, new Date('2026-08-24T00:00:00.000Z')),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
    assert.throws(
      () => readMembershipInvitation(token, 'app-1', secret, new Date('2026-09-23T00:00:00.000Z')),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
  })

  it('uses a 32-character AppID-bound expiring scene for mini-program codes', () => {
    const scene = createMembershipInvitationScene({
      appId: 'app-1',
      inviterUserId,
      expiresAt: new Date('2026-09-23T00:00:00.000Z'),
    }, secret)
    assert.equal(scene.length, 32)
    assert.equal(scene.includes(inviterUserId), false)
    assert.deepEqual(
      readMembershipInvitationScene(scene, 'app-1', secret, new Date('2026-08-24T00:00:00.000Z')),
      { inviterUserId, expiresAt: '2026-09-23T00:00:00.000Z' },
    )
    assert.throws(
      () => readMembershipInvitationScene(scene, 'app-2', secret, new Date('2026-08-24T00:00:00.000Z')),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
    assert.throws(
      () => readMembershipInvitationScene(scene, 'app-1', secret, new Date('2026-09-23T00:00:00.000Z')),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
  })
})
