'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')

const appId = 'wx-community-test'
const userId = '10000000-0000-4000-8000-000000000001'
const pepper = 'community-profile-reference-test-pepper-value-2026'

test('profile reference is AppID-bound and reversible only on the server', () => {
  const profileRef = createProfileRef({ appId, userId }, pepper)
  assert.match(profileRef, /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/)
  assert.equal(readProfileRef(profileRef, appId, pepper), userId)
  assert.throws(() => readProfileRef(profileRef, 'wx-other-app', pepper), /TARGET_NOT_FOUND/)
  assert.equal(profileRef.includes(userId), false)
})
