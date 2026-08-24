'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { createHandler } = require('../domain/handler')

describe('admin handler and isolation contract', () => {
  it('runs the public health probe against MySQL without resolving a user', async () => {
    let resolved = false
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => { resolved = true; throw new Error('unexpected') },
      service: { health: async () => ({ persistence: 'cloudbase-mysql' }) },
    })
    assert.deepEqual(await handler({ action: 'health' }), {
      ok: true, data: { persistence: 'cloudbase-mysql' },
    })
    assert.equal(resolved, false)
  })

  it('keeps the transport handler reusable and maps conflicts to retryable responses', async () => {
    const handler = createHandler({
      getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async getSession() {
          const error = new Error('CONFLICT')
          error.code = 'CONFLICT'
          throw error
        },
      },
    })
    const response = await handler({ action: 'mip.admin.session' })
    assert.equal(response.ok, false)
    assert.deepEqual(response.error, {
      code: 'CONFLICT', message: '记录状态已变化，请刷新后重试', retryable: true,
    })
  })

  it('returns stable neutral growth configuration conflicts', async () => {
    const cases = [
      ['GROWTH_BASE_LEVEL_REQUIRED', '必须保留一个门槛为 0 的启用基础等级'],
      ['GROWTH_LEVEL_THRESHOLD_CONFLICT', '等级经验门槛已存在'],
      ['GROWTH_RULE_ACTIVE_CONFLICT', '同一来源事件和成长类型只能启用一条规则'],
    ]
    for (const [code, message] of cases) {
      const handler = createHandler({
        getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
        resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
        service: {
          async saveGrowthLevel() {
            const error = new Error(code)
            error.code = code
            throw error
          },
        },
      })
      const response = await handler({ action: 'mip.admin.growth.saveLevel' })
      assert.deepEqual(response.error, { code, message, retryable: false })
    }
  })

  it('returns stable event reminder errors without internal details', async () => {
    const handler = createHandler({
      getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async publishEventReminder() {
          const error = new Error('COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED')
          error.code = 'COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED'
          throw error
        },
      },
    })
    const response = await handler({ action: 'mip.admin.communications.publishEventReminder' })
    assert.deepEqual(response.error, {
      code: 'COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED',
      message: '已确认参与者数量超过单次发送上限',
      retryable: false,
    })
  })

  it('rejects unknown operations without dispatching', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => { throw new Error('should not resolve') },
      service: {},
    })
    const response = await handler({ action: 'mip.admin.deleteEverything' })
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'NOT_FOUND')
  })

  it('references only mip-prefixed SQL facts and never issues physical business deletes', () => {
    const root = path.resolve(__dirname, '..')
    const files = [
      path.join(root, 'domain/repository.js'),
      path.resolve(root, '../../database/mysql/mip/006_admin.sql'),
    ]
    const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:member|dating|sewing)_\w+/i)
    assert.doesNotMatch(fs.readFileSync(files[0], 'utf8'), /\bDELETE\s+FROM\b/i)
    assert.match(source, /mip_audit_logs/)
    assert.match(source, /mip_admin_export_tickets/)
  })
})
