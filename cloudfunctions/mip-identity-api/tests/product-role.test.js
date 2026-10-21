'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { productRole, attendedEventSql, activePlayerSql } = require('../lib/product-role')
const { missingProfileFields, profileCompleteSql } = require('../lib/profile-readiness')

test('product role has four labels without granting membership or backend permissions', () => {
  assert.equal(productRole({ authenticated: false, isPlayer: true, hasAttended: true }), 'ANONYMOUS')
  assert.equal(productRole(), 'NORMAL')
  assert.equal(productRole({ hasAttended: true }), 'GUEST')
  assert.equal(productRole({ isPlayer: true }), 'PLAYER')
  // Expiry/revocation remove membership; revoking the final valid attendance removes the guest label.
  assert.equal(productRole({ isPlayer: false, hasAttended: true }), 'GUEST')
  assert.equal(productRole({ isPlayer: false, hasAttended: false }), 'NORMAL')
  assert.match(attendedEventSql(), /role_checkin\.status = 'ACTIVE'/)
  assert.match(attendedEventSql(), /role_registration\.status = 'ATTENDED'/)
  assert.match(attendedEventSql(), /role_registration\.app_id = u\.app_id/)
  assert.match(activePlayerSql(), /starts_at <= UTC_TIMESTAMP\(3\).*ends_at > UTC_TIMESTAMP\(3\)/s)
})

test('profile readiness requires exactly the five visible fields and retains inactive industry references', () => {
  const complete = { nickname: '用户', avatarReady: true, industryBound: true, careerIdentityKey: 'STUDENT', headline: '介绍' }
  assert.deepEqual(missingProfileFields(complete), [])
  assert.deepEqual(missingProfileFields(), ['NICKNAME', 'AVATAR', 'PRIMARY_INDUSTRY', 'CAREER_IDENTITY', 'HEADLINE'])
  for (const [field, missing] of [['nickname', 'NICKNAME'], ['avatarReady', 'AVATAR'], ['industryBound', 'PRIMARY_INDUSTRY'], ['careerIdentityKey', 'CAREER_IDENTITY'], ['headline', 'HEADLINE']]) {
    assert.deepEqual(missingProfileFields({ ...complete, [field]: field.endsWith('Ready') || field.endsWith('Bound') ? false : '  ' }), [missing])
  }
  assert.doesNotMatch(profileCompleteSql(), /primary_branch_id|gender|enabled/)
  assert.match(profileCompleteSql(), /profile_avatar\.status = 'READY'/)
  assert.match(profileCompleteSql(), /profile_industry\.relation = 'PRIMARY_INDUSTRY'/)
})

test('independent cloud bundles keep the exact same role and readiness policy', () => {
  for (const name of ['mip-admin-api', 'mip-opportunities-api']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '../../', name, 'lib/product-role.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../lib/product-role.js'), 'utf8'))
  }
  for (const name of ['mip-admin-api', 'mip-commerce-api', 'mip-events-api', 'mip-opportunities-api', 'mip-tasks-api', 'mip-game-api', 'mip-banners-api']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '../../', name, 'lib/profile-readiness.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../lib/profile-readiness.js'), 'utf8'))
  }
})
