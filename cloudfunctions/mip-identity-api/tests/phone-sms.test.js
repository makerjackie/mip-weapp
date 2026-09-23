'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { randomUUID } = require('node:crypto')
const { createPhoneSmsService } = require('../domain/phone-sms')
const { createIdentityRepository } = require('../domain/repository')
const { protectPhone, revealPhone } = require('../lib/private-data')
const { createTencentSmsProvider } = require('../lib/tencent-sms')

const caller = { appId: 'wx-sms-test', identityKey: 'trusted-identity' }
const userId = '10000000-0000-4000-8000-000000000001'
const phone = '13800000000'
const secret = 'phone-sms-test-secret-with-at-least-32-characters'

// Transactional database double: failed transactions roll back and concurrent requests serialize.
// The real identity repository, encryption and SMS service all run against this boundary.
function fixture(options = {}) {
  let state = { rates: {}, challenges: {}, bound: null, active: true }
  let time = Date.parse('2026-09-22T08:00:00Z')
  let chain = Promise.resolve()
  const sent = []
  let conflict = false
  function adapter(draft) {
    return {
      async one(sql, p) {
        if (sql.includes('FROM mip_users')) return { id: p[1], status: draft.active ? 'ACTIVE' : 'CLOSED' }
        if (sql.includes('FROM mip_phone_sms_rate_limits')) return draft.rates[`${p[0]}:${p[1]}`] || null
        if (sql.includes('FROM mip_phone_sms_challenges')) {
          const row = draft.challenges[p[1]]
          return row?.app_id === p[0] && row.user_id === p[2] ? { ...row } : null
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
      async query(sql, p) {
        if (sql.includes('INSERT INTO mip_phone_sms_rate_limits')) {
          draft.rates[`${p[0]}:${p[1]}`] ||= { hour_started_at: p[2], day_started_at: p[3], hour_count: 0, day_count: 0 }
        }
        else if (sql.includes('UPDATE mip_phone_sms_rate_limits')) {
          Object.assign(draft.rates[`${p[5]}:${p[6]}`], { last_sent_at: p[0], hour_started_at: p[1], hour_count: p[2], day_started_at: p[3], day_count: p[4] })
        }
        else if (sql.includes('INSERT INTO mip_phone_sms_challenges')) {
          draft.challenges[p[0]] = { id: p[0], app_id: p[1], user_id: p[2], phone_hash: p[3], code_hash: p[4], expires_at: p[5], status: 'PENDING', attempts: 0 }
        }
        else if (sql.includes("SET status = 'EXPIRED'")) {
          for (const row of Object.values(draft.challenges)) {
            if (row.app_id === p[0] && row.user_id === p[1] && ['PENDING', 'SENT'].includes(row.status)) row.status = 'EXPIRED'
          }
        }
        else if (sql.includes('UPDATE mip_phone_sms_challenges')) {
          const row = draft.challenges[p[1]]
          if (!row || row.app_id !== p[0] || row.user_id !== p[2]) return { affectedRows: 0 }
          if (sql.includes("status = 'PENDING'") && row.status !== 'PENDING') return { affectedRows: 0 }
          if (sql.includes('attempts = attempts + 1')) row.attempts++
          else row.status = sql.includes("SET status = 'SENT'") ? 'SENT' : sql.includes("SET status = 'FAILED'") ? 'FAILED' : 'CONSUMED'
        }
        else if (sql.includes('UPDATE mip_private_profiles')) {
          if (conflict) throw Object.assign(new Error('redacted duplicate index error'), { code: 'ER_DUP_ENTRY' })
          draft.bound = { hash: p[0], ciphertext: p[1], appId: p[2], userId: p[3] }
        }
        else throw new Error(`Unexpected mutation: ${sql}`)
        return { affectedRows: 1 }
      },
    }
  }
  const database = {
    query: (sql, p) => adapter(state).query(sql, p),
    transaction(work) {
      const result = chain.then(async () => {
        const draft = structuredClone(state)
        const result = await work(adapter(draft))
        state = draft
        return result
      })
      chain = result.catch(() => {})
      return result
    },
  }
  const provider = { available: options.available !== false, async send(number, code) { sent.push({ number, code }); if (options.fail) throw new Error('private provider error'); return { accepted: true } } }
  const repository = createIdentityRepository(database)
  const service = createPhoneSmsService({ database, provider, secret, now: () => time, id: randomUUID, randomInt: () => 123456,
    protectPhone: (value, context) => protectPhone(value, secret, context), bindPhone: repository.bindPhone })
  return { service, sent, state: () => state, advance: ms => { time += ms }, conflict: value => { conflict = value } }
}

function verification(request, overrides = {}) {
  return { phone, challengeId: request.challengeId, code: '123456', ...overrides }
}

describe('phone SMS identity contract', () => {
  it('stores only scoped hashes and consumes verification atomically with the existing phone binding', async () => {
    const f = fixture()
    const result = await f.service.request(caller, userId, { phone })
    assert.deepEqual(Object.keys(result).sort(), ['challengeId', 'expiresAt', 'retryAfterSeconds', 'status'])
    assert.equal(result.status, 'ACCEPTED')
    assert.equal(result.retryAfterSeconds, 60)
    assert.equal(f.sent.length, 1)
    const row = f.state().challenges[result.challengeId]
    assert.match(row.code_hash, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(f.state()).includes(phone), false)
    assert.equal(JSON.stringify(f.state()).includes('123456'), false)
    await f.service.verify(caller, userId, verification(result))
    assert.equal(f.state().challenges[result.challengeId].status, 'CONSUMED')
    assert.equal(revealPhone(f.state().bound.ciphertext, secret, { appId: caller.appId, userId }), `+86:${phone}`)
    await assert.rejects(f.service.verify(caller, userId, verification(result)), /SMS_CODE_USED/)
  })
  it('binds challenges to AppID, authenticated user and requested phone', async () => {
    const f = fixture()
    const result = await f.service.request(caller, userId, { phone })
    await assert.rejects(f.service.verify({ ...caller, appId: 'wx-other' }, userId, verification(result)), /SMS_CODE_INVALID/)
    await assert.rejects(f.service.verify(caller, 'other-user', verification(result)), /SMS_CODE_INVALID/)
    await assert.rejects(f.service.verify(caller, userId, verification(result, { phone: '13900000000' })), /SMS_CODE_INVALID/)
    assert.equal(f.state().bound, null)
  })
  it('persists wrong-code attempts, locks after five, and expires after five minutes', async () => {
    const f = fixture()
    const result = await f.service.request(caller, userId, { phone })
    for (let attempt = 1; attempt <= 5; attempt++) {
      await assert.rejects(f.service.verify(caller, userId, verification(result, { code: '654321' })), attempt === 5 ? /SMS_CODE_LOCKED/ : /SMS_CODE_INVALID/)
      assert.equal(f.state().challenges[result.challengeId].attempts, attempt)
    }
    await assert.rejects(f.service.verify(caller, userId, verification(result)), /SMS_CODE_LOCKED/)
    f.advance(60000)
    const next = await f.service.request(caller, userId, { phone })
    assert.equal(f.state().challenges[result.challengeId].status, 'EXPIRED')
    f.advance(300000)
    await assert.rejects(f.service.verify(caller, userId, verification(next)), /SMS_CODE_EXPIRED/)
    assert.equal(f.state().bound, null)
  })
  it('serializes concurrent sends, enforces user and phone cooldowns, and caps hourly/daily cost', async () => {
    const f = fixture()
    const concurrent = await Promise.allSettled([f.service.request(caller, userId, { phone }), f.service.request(caller, userId, { phone })])
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(f.sent.length, 1)
    await assert.rejects(f.service.request(caller, userId, { phone: '13900000000' }), /SMS_RATE_LIMITED/)
    await assert.rejects(f.service.request(caller, 'other-user', { phone }), /SMS_RATE_LIMITED/)
    for (let count = 1; count < 5; count++) { f.advance(60000); await f.service.request(caller, userId, { phone }) }
    f.advance(60000)
    await assert.rejects(f.service.request(caller, userId, { phone }), /SMS_RATE_LIMITED/)
    f.advance(3600000)
    for (let count = 0; count < 5; count++) { await f.service.request(caller, userId, { phone }); f.advance(60000) }
    f.advance(3600000)
    await assert.rejects(f.service.request(caller, userId, { phone }), /SMS_RATE_LIMITED/)
    assert.equal(f.sent.length, 10)
    f.advance(86400000)
    await f.service.request(caller, userId, { phone })
    assert.equal(f.sent.length, 11)
  })
  it('rolls back code consumption on existing phone conflicts and rejects closed users', async () => {
    const f = fixture()
    const result = await f.service.request(caller, userId, { phone })
    f.conflict(true)
    await assert.rejects(f.service.verify(caller, userId, verification(result)), /PHONE_ALREADY_BOUND/)
    assert.equal(f.state().challenges[result.challengeId].status, 'SENT')
    assert.equal(f.state().bound, null)
    f.conflict(false)
    f.state().active = false
    await assert.rejects(f.service.verify(caller, userId, verification(result)), /FORBIDDEN/)
    await assert.rejects(f.service.request(caller, userId, { phone }), /FORBIDDEN/)
  })
  it('does not pretend disabled or unconfirmed provider requests were sent; failed sends remain rate limited', async () => {
    const disabled = fixture({ available: false })
    await assert.rejects(disabled.service.request(caller, userId, { phone }), /SMS_DISABLED/)
    assert.equal(disabled.sent.length, 0)
    const failed = fixture({ fail: true })
    await assert.rejects(failed.service.request(caller, userId, { phone }), /^Error: SMS_SEND_FAILED$/)
    const row = Object.values(failed.state().challenges)[0]
    assert.equal(row.status, 'FAILED')
    await assert.rejects(failed.service.verify(caller, userId, verification({ challengeId: row.id })), /SMS_CODE_EXPIRED/)
    await assert.rejects(failed.service.request(caller, userId, { phone }), /SMS_RATE_LIMITED/)
    assert.equal(failed.sent.length, 1)
  })
})

describe('Tencent SMS server adapter (no real network)', () => {
  const env = { MIP_SMS_ENABLED: 'true', MIP_SMS_SECRET_ID: 'test-id', MIP_SMS_SECRET_KEY: 'test-key', MIP_SMS_SDK_APP_ID: 'test-sdk', MIP_SMS_SIGN_NAME: '测试签名', MIP_SMS_TEMPLATE_ID: 'test-template' }
  it('sends a signed fixed-endpoint E164 request and returns acceptance only', async () => {
    let request
    const provider = createTencentSmsProvider(env, { now: () => Date.parse('2026-09-22T08:00:00Z'), fetch: async (url, init) => {
      request = { url, ...init }
      return { ok: true, json: async () => ({ Response: { SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800000000', SerialNo: 'private' }] } }) }
    } })
    assert.deepEqual(await provider.send(phone, '123456'), { accepted: true })
    assert.equal(request.url, 'https://sms.tencentcloudapi.com/')
    assert.equal(request.redirect, 'error')
    assert.equal(request.headers['X-TC-Action'], 'SendSms')
    assert.equal(request.headers['X-TC-Version'], '2021-01-11')
    assert.match(request.headers.Authorization, /^TC3-HMAC-SHA256 Credential=test-id\/2026-09-22\/sms\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/)
    // Independent Python hashlib/hmac TC3 fixture for this exact Unicode JSON body.
    assert.equal(request.headers.Authorization.split('Signature=')[1], 'da5ffb3dd43217b6da86080ab322cde3fa06f788155474e43efb07d3d2552149')
    assert.deepEqual(JSON.parse(request.body), { PhoneNumberSet: [`+86${phone}`], SmsSdkAppId: 'test-sdk', SignName: '测试签名', TemplateId: 'test-template', TemplateParamSet: ['123456', '5'] })
  })
  it('never sends with incomplete configuration and sanitizes vendor failures without retries', async () => {
    let calls = 0
    const fetch = async () => { calls++; return { ok: true, json: async () => ({ Response: { SendStatusSet: [{ Code: 'LimitExceeded', Message: 'private phone and credentials' }] } }) } }
    await assert.rejects(createTencentSmsProvider({ ...env, MIP_SMS_SECRET_KEY: '' }, { fetch }).send(phone, '123456'), /SMS_DISABLED/)
    assert.equal(calls, 0)
    await assert.rejects(createTencentSmsProvider(env, { fetch }).send(phone, '123456'), /^Error: SMS_SEND_FAILED$/)
    assert.equal(calls, 1)
  })
})
