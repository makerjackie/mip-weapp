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

test('2026-10-24: unsigned-in or phone-bound-but-incomplete users stay anonymous visitors', () => {
  // 未登录（未绑定手机号）即匿名访客；有效权益或有效签到优先于匿名访客。
  assert.equal(productRole({ phoneBound: false, profileComplete: true }), 'ANONYMOUS')
  // 已授权手机号但未完善资料仍是匿名访客。
  assert.equal(productRole({ phoneBound: true, profileComplete: false }), 'ANONYMOUS')
  assert.equal(productRole({ phoneBound: false, profileComplete: false }), 'ANONYMOUS')
  // 付费与有效签到不回退为匿名访客（Q-ADMIN-09 有效权益优先）。
  assert.equal(productRole({ isPlayer: true, phoneBound: false, profileComplete: false }), 'PLAYER')
  assert.equal(productRole({ hasAttended: true, phoneBound: true, profileComplete: false }), 'GUEST')
  // 完善资料后回到普通用户。
  assert.equal(productRole({ phoneBound: true, profileComplete: true }), 'NORMAL')
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
  for (const name of ['mip-admin-api', 'mip-commerce-api', 'mip-events-api', 'mip-opportunities-api']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '../../', name, 'lib/profile-readiness.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../lib/profile-readiness.js'), 'utf8'))
  }
})
