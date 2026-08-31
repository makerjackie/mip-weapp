'use strict'

const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')

const purposeFields = Object.freeze({
  PROFILE: Object.freeze(['nickname', 'identityStatus', 'headline', 'introduction', 'companies', 'organizations']),
  COOPERATION_CARD: Object.freeze(['roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores']),
  SUPER_CASE: Object.freeze(['projectName', 'summary', 'responsibility', 'description', 'startedOn', 'endedOn', 'caseType']),
  OPPORTUNITY: Object.freeze(['title', 'valueSummary', 'cityLabel', 'targetSummary', 'description']),
})

const opportunityTextLimits = Object.freeze({
  title: 120,
  valueSummary: 240,
  cityLabel: 80,
  targetSummary: 500,
  description: 6000,
})

function createOpenAiCompatibleAdapter(options) {
  const config = options.config
  const http = options.http

  return {
    async readiness() {
      const operationKey = sha256('MIP_AI_OPENAI_READINESS_V1')
      const requestId = sha256([
        'MIP_AI_OPENAI_READINESS_REQUEST_V1',
        config.openAiChatEndpoint.toString(),
        config.openAiModel,
      ].join('\0'))
      await requestStructuredDraft({
        action: 'structureText',
        config,
        http,
        operationKey,
        payload: {
          purpose: 'OPPORTUNITY',
          transcriptText: '项目名称：AI 草稿服务连通性检查',
        },
        requestId,
        maximumTokens: 128,
      })
      return true
    },

    async invoke(request) {
      if (request.action === 'transcribeAndStructure') {
        throw new Error('AI_DRAFT_PROVIDER_AUDIO_UNAVAILABLE')
      }
      const { providerJobKey, ...structuredDraft } = await requestStructuredDraft({
        action: request.action,
        config,
        http,
        operationKey: request.operationKey,
        payload: request.payload,
        requestId: request.requestId,
      })
      return request.action === 'refineDraft'
        ? { structuredDraft, providerJobKey }
        : {
            transcriptText: request.payload.transcriptText,
            structuredDraft,
            providerJobKey,
          }
    },
  }
}

async function requestStructuredDraft(options) {
  const body = completionBody(options.action, options.payload, options.config.openAiModel, options.maximumTokens)
  const payloadDigest = sha256(JSON.stringify(body))
  const response = await options.http.postJson(options.config.openAiChatEndpoint, body, {
    maximumRequestBytes: 96 * 1024,
    maximumResponseBytes: 64 * 1024,
    operationKey: options.operationKey,
    payloadDigest,
    requestId: options.requestId,
    secret: options.config.openAiApiKey,
    timeoutMs: options.config.timeoutMs,
  })
  const completion = parseCompletion(response)
  const structuredDraft = normalizeDraft(options.payload.purpose, completion.content)
  return {
    ...structuredDraft,
    providerJobKey: completion.id || sha256([
      'MIP_AI_OPENAI_RESULT_V1',
      options.operationKey,
      completion.content,
    ].join('\0')),
  }
}

function completionBody(action, payload, model, maximumTokens = 4096) {
  const purpose = payload?.purpose
  const fields = purposeFields[purpose]
  if (!fields || !['structureText', 'refineDraft'].includes(action)) {
    throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
  }
  const instructions = purpose === 'OPPORTUNITY'
    ? [
        '把用户提供的机会信息整理成一个 JSON 对象。',
        'JSON 只能包含 title、valueSummary、cityLabel、targetSummary、description 五个可选字符串字段。',
        '只提取原文明确陈述的事实，不推断城市、金额、合作方或项目背景，不输出内部 ID。',
        '缺少的字段直接省略。不要输出 Markdown、解释、数组、null 或空字符串。',
        'JSON 示例：{"title":"品牌渠道合作","valueSummary":"年度合作额 50 万元","cityLabel":"深圳","targetSummary":"寻找成熟消费品渠道","description":"第一阶段覆盖华南。"}',
      ]
    : [
        `把用户内容整理成 ${purpose} 草稿 JSON。`,
        `JSON 只能包含这些可选字段：${fields.join('、')}。`,
        '只保留原文能够确认的事实；缺少的字段省略，不要输出 Markdown 或解释。',
      ]
  const userPayload = action === 'refineDraft'
    ? {
        currentTranscript: payload.currentTranscript,
        currentStructuredDraft: payload.currentStructuredDraft,
        supplementalText: payload.supplementalText,
      }
    : { transcriptText: payload.transcriptText }
  return {
    model,
    messages: [
      { role: 'system', content: instructions.join('\n') },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
    response_format: { type: 'json_object' },
    stream: false,
    temperature: 0,
    max_tokens: maximumTokens,
    thinking: { type: 'disabled' },
  }
}

function parseCompletion(value) {
  const choice = Array.isArray(value?.choices) && value.choices.length === 1
    ? value.choices[0]
    : null
  const content = typeof choice?.message?.content === 'string'
    ? choice.message.content.trim()
    : ''
  const id = typeof value?.id === 'string' ? value.id.trim() : ''
  if (!choice
    || choice.finish_reason !== 'stop'
    || choice.message?.role !== 'assistant'
    || !content
    || Buffer.byteLength(content) > 30_000
    || (id && (id.length > 256 || !/^[\x21-\x7E]+$/.test(id)))) {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  return { content, id }
}

function normalizeDraft(purpose, content) {
  let value
  try {
    value = JSON.parse(content)
  }
  catch {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  const fields = purposeFields[purpose]
  if (!plainObject(value)
    || !fields
    || Object.keys(value).some(key => !fields.includes(key))) {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  const normalized = Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (purpose === 'OPPORTUNITY') {
      const text = typeof item === 'string' ? item.trim() : ''
      return text && text.length <= opportunityTextLimits[key] ? [[key, text]] : []
    }
    return isSupportedValue(item) ? [[key, item]] : []
  }))
  if (!Object.keys(normalized).length || Buffer.byteLength(JSON.stringify(normalized)) > 30_000) {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  return normalized
}

function isSupportedValue(value) {
  if (typeof value === 'string') {
    return value.trim().length > 0 && value.trim().length <= 4000
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (typeof value === 'boolean' || value === null) {
    return true
  }
  if (Array.isArray(value)) {
    return value.length <= 20 && value.every(isSupportedValue)
  }
  if (plainObject(value)) {
    return Object.keys(value).length <= 30 && Object.values(value).every(isSupportedValue)
  }
  return false
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

module.exports = {
  completionBody,
  createOpenAiCompatibleAdapter,
  normalizeDraft,
  parseCompletion,
  purposeFields,
}
