'use strict'

const { createHash, createHmac } = require('node:crypto')

function createCloudAiProvider(cloud, functionName, secret) {
  const configured = typeof functionName === 'string'
    && /^mip-[a-z0-9-]{2,58}$/.test(functionName)
    && functionName !== 'mip-ai-api'
    && typeof secret === 'string'
    && secret.length >= 32

  async function call(action, input) {
    if (!configured) throw new Error('AI_PROVIDER_UNAVAILABLE')
    const timestamp = Date.now()
    const request = { action, timestamp, ...input }
    const signature = createHmac('sha256', secret).update(providerPayload(request)).digest('hex')
    const result = await cloud.callFunction({ name: functionName, data: { ...request, signature } })
    const envelope = result?.result
    if (!envelope || envelope.ok !== true || !envelope.data) {
      throw new Error('AI_PROVIDER_UNAVAILABLE')
    }
    return normalizeProviderResult(envelope.data)
  }

  return {
    capability() {
      return {
        voiceDrafts: configured,
        textDrafts: configured,
        reason: configured ? undefined : 'PROVIDER_NOT_CONFIGURED',
      }
    },
    structureText(input) {
      return call('structureText', input)
    },
    transcribeAndStructure(input) {
      return call('transcribeAndStructure', input)
    },
  }
}

function providerPayload(value) {
  return [
    Number(value.timestamp),
    String(value.action || ''),
    String(value.appId || ''),
    String(value.draftId || ''),
    String(value.purpose || ''),
    createHash('sha256').update(String(value.transcriptText || value.audioFileId || '')).digest('hex'),
  ].join('\n')
}

function normalizeProviderResult(value) {
  const transcriptText = typeof value.transcriptText === 'string' ? value.transcriptText.trim() : ''
  const structuredDraft = value.structuredDraft
  const providerJobKey = typeof value.providerJobKey === 'string' ? value.providerJobKey.trim() : ''
  if (!transcriptText || transcriptText.length > 20_000
    || !structuredDraft || typeof structuredDraft !== 'object' || Array.isArray(structuredDraft)
    || JSON.stringify(structuredDraft).length > 30_000) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID')
  }
  return { transcriptText, structuredDraft, providerJobKey: providerJobKey || undefined }
}

module.exports = { createCloudAiProvider, normalizeProviderResult, providerPayload }
