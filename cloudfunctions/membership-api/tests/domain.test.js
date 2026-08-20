'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  publicRegistrationForm,
  resolvePrivateProfileAnswers,
  validateRegistrationAnswers,
} = require('../domain/activity-platform')
const { normalizeProfile } = require('../domain/profiles')
const { createMembershipOrder, registerForEvent } = require('../lib/workflows')

describe('member profile', () => {
  it('normalizes and deduplicates a safe editable profile', () => {
    assert.deepEqual(normalizeProfile({
      nickname: ' Jackie ',
      city: '上海',
      headline: '独立开发者',
      tags: ['AI', 'AI', '产品'],
    }), {
      nickname: 'Jackie',
      city: '上海',
      headline: '独立开发者',
      bio: '',
      organization: '',
      roleTitle: '',
      industry: '',
      tags: ['AI', '产品'],
      interests: [],
      skills: [],
    })
  })

  it('rejects oversized or empty identity fields', () => {
    assert.throws(() => normalizeProfile({ nickname: '', tags: [] }), /INVALID_NICKNAME/)
    assert.throws(() => normalizeProfile({ nickname: 'Jackie', tags: ['1234567890123'] }), /INVALID_TAGS/)
  })
})

describe('activity registration profile prefill', () => {
  const schema = [{
    id: 'contact',
    label: '联系电话',
    type: 'SHORT_TEXT',
    required: true,
    profileField: 'phone',
  }]

  it('never returns the raw bound phone number to Mini Program page data', () => {
    const [question] = publicRegistrationForm(schema, {}, { phone_number: '13800001234' })
    assert.equal(question.prefillValue, '已绑定手机号 · 1234')
    assert.doesNotMatch(JSON.stringify(question), /13800001234/)
  })

  it('resolves an unchanged masked phone value only inside the server workflow', () => {
    assert.deepEqual(
      resolvePrivateProfileAnswers(
        schema,
        { contact: '已绑定手机号 · 1234' },
        { phone_number: '13800001234' },
      ),
      { contact: '13800001234' },
    )
    assert.deepEqual(
      resolvePrivateProfileAnswers(
        schema,
        { contact: '13900005678' },
        { phone_number: '13800001234' },
      ),
      { contact: '13900005678' },
    )
  })
})

describe('structured registration identity fields', () => {
  const schema = [
    { id: 'phone', label: '手机号', type: 'PHONE', required: true },
    { id: 'idCard', label: '身份证号', type: 'ID_CARD', required: true },
  ]

  it('accepts valid phone and PRC identity checksum', () => {
    const result = validateRegistrationAnswers(schema, {
      phone: '13800001234',
      idCard: '11010519491231002X',
    })
    assert.equal(result.answers.phone, '13800001234')
    assert.equal(result.answers.idCard, '11010519491231002X')
    assert.ok(result.schema.every(question => question.privacy === 'ORGANIZER_ONLY'))
  })

  it('rejects invalid phone and identity checksum', () => {
    assert.throws(() => validateRegistrationAnswers(schema, {
      phone: '123',
      idCard: '110105194912310021',
    }), /INVALID_REGISTRATION_ANSWERS/)
  })
})

describe('MySQL transactional workflows', () => {
  it('derives amount and duration from the stored plan and reuses an idempotent order', async () => {
    const statements = []
    const db = {
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('member_private_profiles')) return { phone_number: '13800000000' }
            if (sql.includes('member_plans')) return { id: 'test-plan', name: '测试会员', price_cents: 10, duration_days: 1 }
            if (sql.includes('member_orders')) return { id: 'existing-order', product_id: 'test-plan' }
            return null
          },
          async query(sql) { statements.push(sql) },
        })
      },
    }
    const orderId = await createMembershipOrder(db, {
      appId: 'wx-app', userId: 'openid', planId: 'test-plan',
      idempotencyKey: 'checkout-1', environment: 'test',
    })
    assert.equal(orderId, 'existing-order')
    assert.equal(statements.length, 0)
  })

  it('rejects idempotent createOrder when product_id fingerprint differs', async () => {
    const db = {
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('member_private_profiles')) return { phone_number: '13800000000' }
            if (sql.includes('member_plans')) return { id: 'plan-b', name: '另一方案', price_cents: 20, duration_days: 30 }
            if (sql.includes('member_orders')) return { id: 'existing-order', product_id: 'plan-a' }
            return null
          },
          async query() { return { affectedRows: 0 } },
        })
      },
    }
    await assert.rejects(
      () => createMembershipOrder(db, {
        appId: 'wx-app',
        userId: 'openid',
        planId: 'plan-b',
        idempotencyKey: 'checkout-1',
        environment: 'test',
      }),
      /IDEMPOTENCY_CONFLICT/,
    )
  })

  it('selects product_id when resolving an idempotent membership order', async () => {
    const statements = []
    const db = {
      async transaction(work) {
        return work({
          async one(sql) {
            statements.push(sql)
            if (sql.includes('member_private_profiles')) return { phone_number: '13800000000' }
            if (sql.includes('member_plans')) return { id: 'test-plan', name: '测试会员', price_cents: 10, duration_days: 1 }
            if (sql.includes('member_orders')) return { id: 'existing-order', product_id: 'test-plan' }
            return null
          },
          async query(sql) { statements.push(sql) },
        })
      },
    }
    await createMembershipOrder(db, {
      appId: 'wx-app', userId: 'openid', planId: 'test-plan',
      idempotencyKey: 'checkout-1', environment: 'test',
    })
    const orderSelect = statements.find(sql => sql.includes('FROM member_orders') && sql.includes('idempotency_key'))
    assert.match(orderSelect, /product_id/)
  })

  it('locks the event before checking capacity', async () => {
    const statements = []
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const db = {
      async transaction(work) {
        return work({
          async one(sql) {
            statements.push(sql)
            if (sql.includes('FROM member_events')) {
              return {
                id: 'event',
                capacity: 1,
                price_cents: 0,
                member_free: 0,
                registration_deadline: null,
                status: 'PUBLISHED',
                starts_at: futureStart,
              }
            }
            if (sql.includes('member_registrations') && sql.includes('FOR UPDATE') && !sql.includes('COUNT(*)')) {
              return null
            }
            if (sql.includes('member_private_profiles')) return { phone_number: '13800000000' }
            if (sql.includes('COUNT(*)')) return { total: 1 }
            return null
          },
          async query(sql) { statements.push(sql) },
        })
      },
    }
    await assert.rejects(
      () => registerForEvent(db, { appId: 'wx-app', userId: 'openid', eventId: 'event' }),
      /EVENT_FULL/,
    )
    assert.match(statements.find(sql => sql.includes('FROM member_events')), /FOR UPDATE/)
    const eventIdx = statements.findIndex(sql => sql.includes('FROM member_events'))
    const regIdx = statements.findIndex(sql =>
      sql.includes('member_registrations') && sql.includes('FOR UPDATE') && !sql.includes('COUNT(*)'))
    assert.ok(regIdx > eventIdx)
  })
})
