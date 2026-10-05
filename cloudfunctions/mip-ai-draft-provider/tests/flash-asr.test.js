'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  FLASH_ASR_HOST,
  buildFlashAsrParams,
  buildFlashAsrQuery,
  createFlashAsr,
  flashAsrPath,
  parseFlashAsrResponse,
  signFlashAsrRequest,
} = require('../lib/flash-asr')

const fixedConfig = {
  secretId: 'AKIDzExample0123456789abcdef',
  secretKey: 'ExampleSecretKey0123456789abcd',
  appId: '1429274561',
}

test('flashAsrPath uses the dedicated flash endpoint with the app id', () => {
  assert.equal(flashAsrPath('1429274561'), '/asr/flash/v1/1429274561')
  assert.equal(FLASH_ASR_HOST, 'asr.cloud.tencent.com')
})

test('buildFlashAsrQuery sorts keys lexicographically', () => {
  const params = buildFlashAsrParams({
    engineType: '16k_zh',
    secretId: fixedConfig.secretId,
    timestampSeconds: 1760000000,
    voiceFormat: 'mp3',
  })
  const query = buildFlashAsrQuery(params)
  assert.equal(query, [
    'convert_num_mode=1',
    'engine_type=16k_zh',
    'filter_dirty=0',
    'filter_modal=0',
    'filter_punc=1',
    'first_channel_only=1',
    `secretid=${fixedConfig.secretId}`,
    'speaker_diarization=0',
    'timestamp=1760000000',
    'voice_format=mp3',
    'word_info=0',
  ].join('&'))
})

test('signFlashAsrRequest produces the HMAC-SHA1 base64 signature of the canonical original', () => {
  const signature = signFlashAsrRequest({
    host: FLASH_ASR_HOST,
    method: 'POST',
    path: flashAsrPath(fixedConfig.appId),
    query: buildFlashAsrQuery(buildFlashAsrParams({
      engineType: '16k_zh',
      secretId: fixedConfig.secretId,
      timestampSeconds: 1760000000,
      voiceFormat: 'mp3',
    })),
    secretKey: fixedConfig.secretKey,
  })
  // 固定向量,公式与 2026-10-05 线上实测一致的签名原文:POST + host + path + ? + 排序 query。
  assert.equal(signature, '2IAjuy7SHuzYFGEI4vYdilAMMpo=')
})

test('parseFlashAsrResponse joins flash_result text and returns duration', () => {
  const result = parseFlashAsrResponse({
    code: 0,
    request_id: 'req-1',
    audio_duration: 900123,
    flash_result: [{ text: '第一段。' }, { text: '第二段。' }],
  })
  assert.deepEqual(result, {
    transcript: '第一段。第二段。',
    audioDurationMs: 900123,
    requestId: 'req-1',
  })
})

test('parseFlashAsrResponse rejects non-zero codes as ASR failure', () => {
  assert.throws(
    () => parseFlashAsrResponse({ code: 10001, message: 'engine not ready' }),
    /AI_DRAFT_PROVIDER_ASR_FAILED/,
  )
})

test('parseFlashAsrResponse rejects empty transcripts without retry', () => {
  assert.throws(
    () => parseFlashAsrResponse({ code: 0, flash_result: [{ text: '' }] }),
    /AI_DRAFT_PROVIDER_TRANSCRIPT_EMPTY/,
  )
  assert.throws(
    () => parseFlashAsrResponse({ code: 0, flash_result: [] }),
    /AI_DRAFT_PROVIDER_TRANSCRIPT_EMPTY/,
  )
})

test('parseFlashAsrResponse rejects malformed payloads as upstream unavailable', () => {
  assert.throws(() => parseFlashAsrResponse(null), /AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE/)
  assert.throws(() => parseFlashAsrResponse('nope'), /AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE/)
  assert.throws(() => parseFlashAsrResponse([]), /AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE/)
})

test('createFlashAsr reports configured only with complete credentials', () => {
  assert.equal(createFlashAsr({ ...fixedConfig }).configured, true)
  assert.equal(createFlashAsr({ ...fixedConfig, secretId: undefined }).configured, false)
  assert.equal(createFlashAsr({ ...fixedConfig, appId: 'abc' }).configured, false)
  assert.equal(createFlashAsr({ ...fixedConfig, secretKey: 'short' }).configured, false)
})

test('createFlashAsr.transcribe refuses to run unconfigured', async () => {
  const asr = createFlashAsr({ secretId: '', secretKey: '', appId: '' })
  await assert.rejects(
    () => asr.transcribe({ contentBase64: Buffer.from('x').toString('base64') }),
    /AI_DRAFT_PROVIDER_NOT_CONFIGURED/,
  )
})

test('createFlashAsr.transcribe rejects oversized audio before signing', async () => {
  const requests = []
  const asr = createFlashAsr({
    ...fixedConfig,
    request: (options, callback) => {
      requests.push(options)
      throw new Error('should not be called')
    },
  })
  const oversized = Buffer.alloc(6 * 1024 * 1024 + 1)
  await assert.rejects(
    () => asr.transcribe({ contentBase64: oversized.toString('base64') }),
    /AI_DRAFT_PROVIDER_AUDIO_INVALID/,
  )
  assert.equal(requests.length, 0)
})

test('createFlashAsr.transcribe posts binary body with signed authorization', async () => {
  const captured = {}
  const asr = createFlashAsr({
    ...fixedConfig,
    request: (options, callback) => {
      captured.options = options
      const response = {
        statusCode: 200,
        headers: { 'content-length': '58' },
        on(event, handler) {
          if (event === 'data') handler(Buffer.from(JSON.stringify({
            code: 0,
            request_id: 'req-9',
            audio_duration: 1200,
            flash_result: [{ text: '你好。' }],
          })))
          if (event === 'end') handler()
          if (event === 'error') {}
        },
        resume() {},
        destroy() {},
      }
      setImmediate(() => callback(response))
      return {
        on(event, handler) {
          if (event === 'error') {}
        },
        end(body) {
          captured.body = body
        },
        destroy() {},
      }
    },
  })
  const result = await asr.transcribe({
    contentBase64: Buffer.from('fake-mp3-bytes').toString('base64'),
  })
  assert.equal(captured.options.hostname, 'asr.cloud.tencent.com')
  assert.equal(captured.options.headers['content-type'], 'application/octet-stream')
  assert.ok(captured.options.headers.authorization)
  assert.ok(String(captured.options.path).startsWith('/asr/flash/v1/1429274561?'))
  assert.equal(captured.body.toString(), 'fake-mp3-bytes')
  assert.deepEqual(result, { transcript: '你好。', audioDurationMs: 1200, requestId: 'req-9' })
})
