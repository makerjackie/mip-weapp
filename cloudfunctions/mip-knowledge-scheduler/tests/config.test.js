'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { runtimeCredentials, schedulerConfig } = require('../lib/config')

const baseEnvironment = Object.freeze({
  MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME: 'mip-knowledge-scheduler',
  MIP_ADMIN_FUNCTION_NAME: 'mip-admin-api',
  MIP_KNOWLEDGE_SCHEDULER_TRIGGER_NAME: 'mip-knowledge-ingestion-next',
  MIP_SCF_NAMESPACE: 'mip-test-env',
  MIP_SCF_REGION: 'ap-shanghai',
  MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: 'scheduler-config-test-secret-at-least-32-bytes',
  MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
})

describe('knowledge scheduler runtime configuration', () => {
  it('requires an explicit canaried cron offset', () => {
    assert.throws(
      () => schedulerConfig({ ...baseEnvironment, MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '' }),
      /MIP_SCF_TIMER_UTC_OFFSET_MINUTES_INVALID/,
    )
    assert.equal(schedulerConfig({
      ...baseEnvironment,
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '0',
    }).cronUtcOffsetMinutes, 0)
  })

  it('accepts Tencent regions with and without a numbered suffix', () => {
    assert.equal(schedulerConfig({
      ...baseEnvironment,
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }).region, 'ap-shanghai')
    assert.equal(schedulerConfig({
      ...baseEnvironment,
      MIP_SCF_REGION: 'ap-beijing-1',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }).region, 'ap-beijing-1')
    assert.throws(
      () => schedulerConfig({
        ...baseEnvironment,
        MIP_SCF_REGION: 'https://ap-shanghai',
        MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
      }),
      /MIP_SCF_REGION_INVALID/,
    )
  })

  it('accepts only complete temporary SCF role credentials', () => {
    assert.deepEqual(runtimeCredentials({
      TENCENTCLOUD_SECRETID: 'fresh-context-id',
      TENCENTCLOUD_SECRETKEY: 'fresh-context-key',
      TENCENTCLOUD_SESSIONTOKEN: 'fresh-context-token',
    }, {
      TENCENTCLOUD_SECRETID: 'cold-start-env-id',
      TENCENTCLOUD_SECRETKEY: 'cold-start-env-key',
      TENCENTCLOUD_SESSIONTOKEN: 'cold-start-env-token',
    }), {
      secretId: 'fresh-context-id',
      secretKey: 'fresh-context-key',
      token: 'fresh-context-token',
    })
    assert.deepEqual(runtimeCredentials({}, {
      TENCENTCLOUD_SECRETID: 'temporary-id',
      TENCENTCLOUD_SECRETKEY: 'temporary-key',
      TENCENTCLOUD_SESSIONTOKEN: 'temporary-token',
    }), {
      secretId: 'temporary-id',
      secretKey: 'temporary-key',
      token: 'temporary-token',
    })
    assert.throws(
      () => runtimeCredentials({}, {
        TENCENTCLOUD_SECRETID: 'permanent-id',
        TENCENTCLOUD_SECRETKEY: 'permanent-key',
      }),
      /SCF_TEMPORARY_CREDENTIALS_UNAVAILABLE/,
    )
  })
})
