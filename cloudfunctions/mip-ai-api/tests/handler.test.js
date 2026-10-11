'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler, failure } = require('../domain/handler')

test('health checks persistence without resolving a user or provider', async () => {
  const handler = createHandler({
    async health() {
      return { service: 'mip-ai-api', persistence: 'cloudbase-mysql' }
    },
    async resolveCaller() { throw new Error('unexpected caller') },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-ai-api', persistence: 'cloudbase-mysql' },
  })
})

test('exposes unknown provider and upload results as retryable without claiming failure', () => {
  assert.deepEqual(failure(new Error('AI_PROVIDER_RESULT_UNKNOWN')), {
    ok: false,
    error: {
      code: 'AI_PROVIDER_RESULT_UNKNOWN',
      message: 'AI 草稿结果暂未确认，请稍后重试',
      retryable: true,
    },
  })
  assert.equal(failure(new Error('AI_AUDIO_UPLOAD_RESULT_UNKNOWN')).error.retryable, true)
  assert.equal(failure(new Error('AI_PROVIDER_REJECTED')).error.retryable, false)
})

// MIW-66:静音录音要引导重录(非重试),ASR 瞬时失败明确可重试。
test('maps voice transcription failures to re-record and retry guidance', () => {
  assert.deepEqual(failure(new Error('AI_PROVIDER_TRANSCRIPT_EMPTY')), {
    ok: false,
    error: {
      code: 'AI_PROVIDER_TRANSCRIPT_EMPTY',
      message: '录音中没有识别到内容，请重新录制',
      retryable: false,
    },
  })
  assert.deepEqual(failure(new Error('AI_PROVIDER_TRANSCRIBE_FAILED')), {
    ok: false,
    error: {
      code: 'AI_PROVIDER_TRANSCRIBE_FAILED',
      message: '语音转写失败，请重试',
      retryable: true,
    },
  })
})

test('maps uncoded internal failures to SERVICE_UNAVAILABLE and logs only the error category (MIW-61)', () => {
  const logged = []
  const original = console.error
  console.error = (...parts) => logged.push(parts)
  try {
    // 数据库层约束错误:消息含表/约束名,不得进入返回值或日志。
    const violation = new Error("Check constraint 'mip_ai_draft_requests_kind_ck' is violated.")
    violation.code = 'ER_CHECK_CONSTRAINT_VIOLATED'
    violation.errno = 3819
    assert.deepEqual(failure(violation), {
      ok: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'AI 草稿服务暂时不可用',
        retryable: true,
      },
    })
    assert.equal(failure(new Error('')).error.code, 'SERVICE_UNAVAILABLE')
  }
  finally {
    console.error = original
  }
  assert.deepEqual(logged, [
    ['[mip-ai-api] uncoded failure', 'ER_CHECK_CONSTRAINT_VIOLATED'],
    ['[mip-ai-api] uncoded failure', 'Error'],
  ])
})

test('reports unknown actions as version skew instead of draft-missing (MIW-56)', async () => {
  const handler = createHandler({
    async health() { return {} },
    async resolveCaller() { return { appId: 'wxapp', userId: 'user-1' } },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'timeTravel' }), {
    ok: false,
    error: {
      code: 'ACTION_NOT_FOUND',
      message: 'AI 服务版本暂不匹配，请稍后重试',
      retryable: true,
    },
  })
})
