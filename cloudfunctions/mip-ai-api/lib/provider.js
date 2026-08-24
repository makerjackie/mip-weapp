'use strict'

const { createHash, createHmac } = require('node:crypto')

function createCloudAiProvider(cloud, functionName, secret) {
  const configured = typeof functionName === 'string'
    && /^mip-[a-z0-9-]{2,58}$/.test(functionName)
    && functionName !== 'mip-ai-api'
    && typeof secret === 'string'
    && secret.length >= 32

  async function call(action, input, options = {}) {
    if (!configured) throw new Error('AI_PROVIDER_UNAVAILABLE')
    const timestamp = Date.now()
    const request = { action, timestamp, ...input }
    const signature = createHmac('sha256', secret).update(providerPayload(request)).digest('hex')
    const result = await cloud.callFunction({ name: functionName, data: { ...request, signature } })
    const envelope = result?.result
    if (!envelope || envelope.ok !== true || !envelope.data) {
      throw new Error('AI_PROVIDER_UNAVAILABLE')
    }
    return normalizeProviderResult(envelope.data, options)
  }

  return {
    capability() {
      return {
        voiceDrafts: configured,
        textDrafts: configured,
        refinementDrafts: configured,
        reason: configured ? undefined : 'PROVIDER_NOT_CONFIGURED',
      }
    },
    structureText(input) {
      return call('structureText', input)
    },
    transcribeAndStructure(input) {
      return call('transcribeAndStructure', input)
    },
    refineDraft(input) {
      return call('refineDraft', input, { requireTranscript: false })
    },
  }
}

function createUnavailableAiProvider() {
  const unavailable = async () => { throw new Error('AI_PROVIDER_UNAVAILABLE') }
  return {
    capability() {
      return {
        voiceDrafts: false,
        textDrafts: false,
        refinementDrafts: false,
        reason: 'PROVIDER_NOT_CONFIGURED',
      }
    },
    structureText: unavailable,
    transcribeAndStructure: unavailable,
    refineDraft: unavailable,
  }
}

function createAiProviderAdapter(options = {}) {
  const adapter = typeof options.adapter === 'string' ? options.adapter.trim() : 'cloud_function'
  if (adapter !== 'cloud_function') return createUnavailableAiProvider()
  return createCloudAiProvider(options.cloud, options.functionName, options.secret)
}

function providerPayload(value) {
  const contentDigest = createHash('sha256').update(stableJson({
    audioFileId: String(value.audioFileId || ''),
    currentStructuredDraft: value.currentStructuredDraft || {},
    currentTranscript: String(value.currentTranscript || ''),
    supplementalText: String(value.supplementalText || ''),
    transcriptText: String(value.transcriptText || ''),
  })).digest('hex')
  return [
    Number(value.timestamp),
    String(value.action || ''),
    String(value.appId || ''),
    String(value.draftId || ''),
    String(value.purpose || ''),
    Number(value.expectedVersion || 0),
    contentDigest,
  ].join('\n')
}

function normalizeProviderResult(value, options = {}) {
  const transcriptText = typeof value.transcriptText === 'string' ? value.transcriptText.trim() : ''
  const structuredDraft = value.structuredDraft
  const providerJobKey = typeof value.providerJobKey === 'string' ? value.providerJobKey.trim() : ''
  if ((options.requireTranscript !== false && !transcriptText) || transcriptText.length > 20_000
    || !structuredDraft || typeof structuredDraft !== 'object' || Array.isArray(structuredDraft)
    || JSON.stringify(structuredDraft).length > 30_000) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID')
  }
  return {
    ...(transcriptText ? { transcriptText } : {}),
    structuredDraft,
    providerJobKey: providerJobKey || undefined,
  }
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = {
  createAiProviderAdapter,
  createCloudAiProvider,
  createUnavailableAiProvider,
  normalizeProviderResult,
  providerPayload,
  stableJson,
}
