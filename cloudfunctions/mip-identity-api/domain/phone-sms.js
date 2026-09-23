'use strict'

const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto')
const TTL_MS = 5 * 60 * 1000
const RETRY_SECONDS = 60
const MAX_ATTEMPTS = 5
function normalizePhone(value) {
  const phone = typeof value === 'string' ? value.trim() : ''
  if (!/^1\d{10}$/.test(phone)) throw new Error('VALIDATION_FAILED')
  return phone
}

function createPhoneSmsService(options) {
  const database = options.database
  const now = options.now || Date.now
  const id = options.id || randomUUID
  function digest(...parts) {
    if (typeof options.secret !== 'string' || options.secret.length < 32) throw new Error('SMS_DISABLED')
    return createHmac('sha256', options.secret).update(['mip-phone-sms-v1', ...parts].join('\0')).digest('hex')
  }
  function protectedPhone(caller, userId, phone) {
    return options.protectPhone({ purePhoneNumber: phone, countryCode: '86' }, { appId: caller.appId, userId })
  }
  async function request(caller, userId, input = {}) {
    if (!options.provider?.available) throw new Error('SMS_DISABLED')
    const phone = normalizePhone(input.phone)
    const phoneHash = protectedPhone(caller, userId, phone).phoneHash
    const challengeId = id()
    const code = String((options.randomInt || randomInt)(0, 1000000)).padStart(6, '0')
    const time = now()
    const expiresAt = new Date(time + TTL_MS)
    const codeHash = digest(caller.appId, userId, challengeId, phoneHash, code)
    const keys = [digest(caller.appId, 'user', userId), digest(caller.appId, 'phone', phoneHash)].sort()
    await database.transaction(async (tx) => {
      const user = await tx.one('SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE', [caller.appId, userId])
      if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
      for (const key of keys) {
        await tx.query(`INSERT INTO mip_phone_sms_rate_limits (app_id, subject_key, hour_started_at, day_started_at)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE subject_key = mip_phone_sms_rate_limits.subject_key`, [caller.appId, key, new Date(time), new Date(time)])
        const rate = await tx.one(`SELECT last_sent_at, hour_started_at, hour_count, day_started_at, day_count
          FROM mip_phone_sms_rate_limits WHERE app_id = ? AND subject_key = ? FOR UPDATE`, [caller.appId, key])
        const hourReset = time - new Date(rate.hour_started_at).getTime() >= 3600000
        const dayReset = time - new Date(rate.day_started_at).getTime() >= 86400000
        if (rate.last_sent_at && time - new Date(rate.last_sent_at).getTime() < RETRY_SECONDS * 1000) throw new Error('SMS_RATE_LIMITED')
        if ((!hourReset && Number(rate.hour_count) >= 5) || (!dayReset && Number(rate.day_count) >= 10)) throw new Error('SMS_RATE_LIMITED')
        await tx.query(`UPDATE mip_phone_sms_rate_limits SET last_sent_at = ?, hour_started_at = ?, hour_count = ?, day_started_at = ?, day_count = ?
          WHERE app_id = ? AND subject_key = ?`, [new Date(time), hourReset ? new Date(time) : rate.hour_started_at,
          hourReset ? 1 : Number(rate.hour_count) + 1, dayReset ? new Date(time) : rate.day_started_at,
          dayReset ? 1 : Number(rate.day_count) + 1, caller.appId, key])
      }
      await tx.query(`UPDATE mip_phone_sms_challenges SET status = 'EXPIRED'
        WHERE app_id = ? AND user_id = ? AND status IN ('PENDING', 'SENT')`, [caller.appId, userId])
      await tx.query(`INSERT INTO mip_phone_sms_challenges
        (id, app_id, user_id, phone_hash, code_hash, status, expires_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`, [challengeId, caller.appId, userId, phoneHash, codeHash, expiresAt])
    })
    try {
      const result = await options.provider.send(phone, code)
      if (result?.accepted !== true) throw new Error('SMS_SEND_FAILED')
      const sent = await database.query(`UPDATE mip_phone_sms_challenges SET status = 'SENT'
        WHERE app_id = ? AND id = ? AND user_id = ? AND status = 'PENDING'`, [caller.appId, challengeId, userId])
      if (Number(sent.affectedRows) !== 1) throw new Error('SMS_SEND_FAILED')
    }
    catch {
      await database.query(`UPDATE mip_phone_sms_challenges SET status = 'FAILED'
        WHERE app_id = ? AND id = ? AND user_id = ? AND status = 'PENDING'`, [caller.appId, challengeId, userId]).catch(() => undefined)
      throw new Error('SMS_SEND_FAILED')
    }
    return { challengeId, retryAfterSeconds: RETRY_SECONDS, expiresAt: expiresAt.toISOString(), status: 'ACCEPTED' }
  }

  async function verify(caller, userId, input = {}) {
    const phone = normalizePhone(input.phone)
    const challengeId = typeof input.challengeId === 'string' ? input.challengeId : ''
    const code = typeof input.code === 'string' ? input.code.trim() : ''
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) throw new Error('SMS_CODE_INVALID')
    const protectedValue = protectedPhone(caller, userId, phone)
    await options.bindPhone(caller, userId, protectedValue, async (tx) => {
      const challenge = await tx.one(`SELECT id, phone_hash, code_hash, status, expires_at, attempts
        FROM mip_phone_sms_challenges WHERE app_id = ? AND id = ? AND user_id = ? FOR UPDATE`, [caller.appId, challengeId, userId])
      if (!challenge || challenge.phone_hash !== protectedValue.phoneHash) return { error: 'SMS_CODE_INVALID' }
      if (challenge.status === 'CONSUMED') return { error: 'SMS_CODE_USED' }
      const expiry = new Date(challenge.expires_at).getTime()
      if (challenge.status !== 'SENT' || !Number.isFinite(expiry) || now() >= expiry) return { error: 'SMS_CODE_EXPIRED' }
      if (Number(challenge.attempts) >= MAX_ATTEMPTS) return { error: 'SMS_CODE_LOCKED' }
      const expected = digest(caller.appId, userId, challengeId, protectedValue.phoneHash, code)
      const stored = String(challenge.code_hash || '')
      const valid = /^[0-9a-f]{64}$/.test(stored) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(stored, 'hex'))
      if (!valid) {
        await tx.query(`UPDATE mip_phone_sms_challenges SET attempts = attempts + 1
          WHERE app_id = ? AND id = ? AND user_id = ?`, [caller.appId, challengeId, userId])
        return { error: Number(challenge.attempts) + 1 >= MAX_ATTEMPTS ? 'SMS_CODE_LOCKED' : 'SMS_CODE_INVALID' }
      }
      await tx.query(`UPDATE mip_phone_sms_challenges SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(3)
        WHERE app_id = ? AND id = ? AND user_id = ? AND status = 'SENT'`, [caller.appId, challengeId, userId])
      return null
    })
  }
  return { request, verify }
}

module.exports = { createPhoneSmsService, normalizePhone }
