'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  completionBody,
  createOpenAiCompatibleAdapter,
  normalizeDraft,
  parseCompletion,
} = require('../lib/openai-compatible')

const config = {
  openAiApiKey: `sk-${'k'.repeat(32)}`,
  openAiChatEndpoint: new URL('https://api.deepseek.com/chat/completions'),
  openAiModel: 'deepseek-v4-flash',
  timeoutMs: 5000,
}

const request = {
  action: 'structureText',
  operationKey: '1'.repeat(64),
  requestId: '2'.repeat(64),
  payload: {
    purpose: 'OPPORTUNITY',
    transcriptText: '项目名称：品牌渠道合作\n主营城市：深圳\n寻找合作方：成熟消费品渠道',
  },
}

function completion(content, overrides = {}) {
  return {
    id: 'chatcmpl-opportunity-1',
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
    ...overrides,
  }
}

test('sends a JSON-mode non-thinking request and keeps the API key out of the body', async () => {
  let outbound
  let transport
  const adapter = createOpenAiCompatibleAdapter({
    config,
    http: {
      async postJson(endpoint, body, options) {
        assert.equal(endpoint.toString(), 'https://api.deepseek.com/chat/completions')
        outbound = body
        transport = options
        return completion(JSON.stringify({
          title: '品牌渠道合作',
          cityLabel: '深圳',
          targetSummary: '成熟消费品渠道',
        }))
      },
    },
  })

  assert.deepEqual(await adapter.invoke(request), {
    transcriptText: request.payload.transcriptText,
    structuredDraft: {
      title: '品牌渠道合作',
      cityLabel: '深圳',
      targetSummary: '成熟消费品渠道',
    },
    providerJobKey: 'chatcmpl-opportunity-1',
  })
  assert.equal(outbound.model, 'deepseek-v4-flash')
  assert.deepEqual(outbound.response_format, { type: 'json_object' })
  assert.deepEqual(outbound.thinking, { type: 'disabled' })
  assert.equal(outbound.stream, false)
  assert.match(outbound.messages[0].content, /JSON/)
  assert.match(outbound.messages[0].content, /title.*valueSummary.*cityLabel.*targetSummary.*description/)
  assert.equal(JSON.stringify(outbound).includes(config.openAiApiKey), false)
  assert.equal(transport.secret, config.openAiApiKey)
  assert.equal(transport.operationKey, request.operationKey)
})

test('checks readiness through a bounded authenticated JSON completion', async () => {
  let outbound
  let transport
  const adapter = createOpenAiCompatibleAdapter({
    config,
    http: {
      async postJson(_endpoint, body, options) {
        outbound = body
        transport = options
        return completion('{"title":"AI 草稿服务连通性检查"}')
      },
    },
  })

  assert.equal(await adapter.readiness(), true)
  assert.equal(outbound.max_tokens, 128)
  assert.equal(outbound.messages[1].content.includes('AI 草稿服务连通性检查'), true)
  assert.equal(transport.secret, config.openAiApiKey)
})

test('returns refinement as a draft only and retains the current purpose whitelist', async () => {
  const adapter = createOpenAiCompatibleAdapter({
    config,
    http: {
      async postJson() {
        return completion('{"title":"品牌渠道合作","description":"补充渠道计划。"}')
      },
    },
  })
  const result = await adapter.invoke({
    ...request,
    action: 'refineDraft',
    payload: {
      purpose: 'OPPORTUNITY',
      currentTranscript: request.payload.transcriptText,
      currentStructuredDraft: { title: '品牌渠道合作' },
      supplementalText: '补充：第一阶段先覆盖华南渠道。',
    },
  })
  assert.deepEqual(result, {
    structuredDraft: { title: '品牌渠道合作', description: '补充渠道计划。' },
    providerJobKey: 'chatcmpl-opportunity-1',
  })
})

test('transcribes storage audio through Flash ASR then structures the transcript', async () => {
  const loadedPayloads = []
  const asrInputs = []
  const outboundBodies = []
  const voiceRequest = {
    action: 'transcribeAndStructure',
    operationKey: '1'.repeat(64),
    requestId: '2'.repeat(64),
    payload: {
      appId: 'wx1234567890abcdef',
      draftId: '0f0e0d0c-1111-4222-8333-444455556666',
      purpose: 'SUPER_CASE',
      expectedVersion: 1,
      audioFileId: `cloud://env-bucket/mip/development/${'a'.repeat(24)}/ai/${'b'.repeat(24)}/11111111-2222-4333-8444-555566667777.mp3`,
      audioContentSha256: 'a'.repeat(64),
      audioContentType: 'audio/mpeg',
      audioContentBytes: 3,
    },
  }
  const adapter = createOpenAiCompatibleAdapter({
    config,
    http: {
      async postJson(_endpoint, body) {
        outboundBodies.push(body)
        return completion(JSON.stringify({
          projectName: '商业项目',
          caseType: '创意实践',
        }))
      },
    },
    audioLoader: {
      async load(payload) {
        loadedPayloads.push(payload)
        return {
          contentBase64: Buffer.from('mp3').toString('base64'),
          contentSha256: payload.audioContentSha256,
          contentType: payload.audioContentType,
          contentBytes: payload.audioContentBytes,
        }
      },
    },
    flashAsr: {
      configured: true,
      async transcribe(input) {
        asrInputs.push(input)
        return {
          transcript: '我去年负责一个商业项目，做创意实践。',
          audioDurationMs: 9000,
          requestId: 'asr-1',
        }
      },
    },
  })

  assert.equal(adapter.supportsVoiceDrafts, true)
  assert.deepEqual(await adapter.invoke(voiceRequest), {
    transcriptText: '我去年负责一个商业项目，做创意实践。',
    structuredDraft: {
      projectName: '商业项目',
      caseType: '创意实践',
    },
    providerJobKey: 'chatcmpl-opportunity-1',
  })
  assert.equal(loadedPayloads[0], voiceRequest.payload)
  assert.deepEqual(asrInputs[0], {
    contentBase64: Buffer.from('mp3').toString('base64'),
    voiceFormat: 'mp3',
  })
  assert.match(outboundBodies[0].messages[0].content, /SUPER_CASE/)
  assert.equal(outboundBodies[0].messages[1].content.includes('我去年负责一个商业项目'), true)
})

test('reports voice capability off when ASR is not configured', async () => {
  const adapter = createOpenAiCompatibleAdapter({
    config,
    http: {},
    audioLoader: { async load() { throw new Error('must not run') } },
    flashAsr: { configured: false, async transcribe() { throw new Error('must not run') } },
  })
  assert.equal(adapter.supportsVoiceDrafts, false)
  await assert.rejects(
    () => adapter.invoke({ ...request, action: 'transcribeAndStructure' }),
    /AUDIO_UNAVAILABLE/,
  )
})

test('rejects audio, incomplete completions, markdown, unknown fields, and invalid opportunity values', async () => {
  const adapter = createOpenAiCompatibleAdapter({ config, http: {} })
  await assert.rejects(() => adapter.invoke({ ...request, action: 'transcribeAndStructure' }), /AUDIO_UNAVAILABLE/)
  assert.throws(() => parseCompletion(completion('{}', {
    choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }],
  })), /RESPONSE_INVALID/)
  assert.throws(() => normalizeDraft('OPPORTUNITY', '```json\n{"title":"项目"}\n```'), /RESPONSE_INVALID/)
  assert.throws(() => normalizeDraft('OPPORTUNITY', '{"title":"项目","cityTagId":"internal"}'), /RESPONSE_INVALID/)
  assert.throws(() => normalizeDraft('OPPORTUNITY', '{"title":123}'), /RESPONSE_INVALID/)
})

test('keeps the previous three purposes available in the OpenAI-compatible prompt', () => {
  for (const purpose of ['PROFILE', 'COOPERATION_CARD', 'SUPER_CASE']) {
    const body = completionBody('structureText', { purpose, transcriptText: '原始内容' }, config.openAiModel)
    assert.equal(body.model, config.openAiModel)
    assert.match(body.messages[0].content, new RegExp(purpose))
    assert.deepEqual(body.response_format, { type: 'json_object' })
  }
})
