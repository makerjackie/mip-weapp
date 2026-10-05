'use strict'

// 腾讯云录音文件识别极速版(Flash ASR)客户端。
// 专用 HTTPS 接口:HMAC-SHA1 签名 + 二进制 body,同步返回 JSON。
// 凭据仅来自函数环境变量,由 lib/config.js 解析后注入。

const https = require('node:https')
const { createHmac } = require('node:crypto')

const FLASH_ASR_HOST = 'asr.cloud.tencent.com'
const maximumAudioBytes = 6 * 1024 * 1024

function createFlashAsr(options = {}) {
  const secretId = options.secretId
  const secretKey = options.secretKey
  const appId = options.appId
  const engineType = options.engineType || '16k_zh'
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const request = options.request || https.request
  const configured = Boolean(validSecretId(secretId) && validSecretKey(secretKey) && validAppId(appId))

  return {
    configured,
    async transcribe({ contentBase64, voiceFormat = 'mp3' }) {
      if (!configured) throw new Error('AI_DRAFT_PROVIDER_NOT_CONFIGURED')
      const audio = Buffer.from(String(contentBase64 || ''), 'base64')
      if (!audio.length || audio.length > maximumAudioBytes) {
        throw new Error('AI_DRAFT_PROVIDER_AUDIO_INVALID')
      }
      const params = buildFlashAsrParams({
        engineType,
        secretId,
        timestampSeconds: Math.floor(Date.now() / 1000),
        voiceFormat,
      })
      const query = buildFlashAsrQuery(params)
      const signature = signFlashAsrRequest({
        host: FLASH_ASR_HOST,
        method: 'POST',
        path: flashAsrPath(appId),
        query,
        secretKey,
      })
      const payload = await postBinary({
        host: FLASH_ASR_HOST,
        path: `${flashAsrPath(appId)}?${query}`,
        body: audio,
        signature,
        timeoutMs,
        request,
      })
      return parseFlashAsrResponse(payload)
    },
  }
}

function flashAsrPath(appId) {
  return `/asr/flash/v1/${appId}`
}

function buildFlashAsrParams({ engineType, secretId, timestampSeconds, voiceFormat }) {
  return {
    convert_num_mode: '1',
    engine_type: engineType,
    filter_dirty: '0',
    filter_modal: '0',
    filter_punc: '1',
    first_channel_only: '1',
    secretid: secretId,
    speaker_diarization: '0',
    timestamp: String(timestampSeconds),
    voice_format: voiceFormat,
    word_info: '0',
  }
}

function buildFlashAsrQuery(params) {
  return Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
}

function signFlashAsrRequest({ method, host, path, query, secretKey }) {
  const original = `${method}${host}${path}?${query}`
  return createHmac('sha1', secretKey).update(original).digest('base64')
}

function parseFlashAsrResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof payload.code !== 'number') {
    throw new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')
  }
  if (payload.code !== 0) {
    safeWarnAsrRejection(payload.code, payload.message)
    throw new Error('AI_DRAFT_PROVIDER_ASR_FAILED')
  }
  const transcript = Array.isArray(payload.flash_result)
    ? payload.flash_result
      .map(item => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
      .trim()
    : ''
  if (!transcript || transcript.length > 20_000) {
    throw new Error('AI_DRAFT_PROVIDER_TRANSCRIPT_EMPTY')
  }
  return {
    transcript,
    audioDurationMs: Number.isFinite(payload.audio_duration) ? Number(payload.audio_duration) : null,
    requestId: typeof payload.request_id === 'string' ? payload.request_id.slice(0, 128) : '',
  }
}

async function postBinary({ host, path, body, signature, timeoutMs, request }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let responseStream
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
      responseStream?.destroy()
      outgoing.destroy()
    }, timeoutMs)
    const outgoing = request({
      hostname: host,
      method: 'POST',
      path,
      headers: {
        authorization: signature,
        'content-length': String(body.length),
        'content-type': 'application/octet-stream',
        host,
      },
    }, (response) => {
      responseStream = response
      const status = Number(response.statusCode || 0)
      const contentLength = Number(response.headers?.['content-length'] || 0)
      if (status !== 200
        || !Number.isSafeInteger(contentLength)
        || contentLength < 0
        || contentLength > 256 * 1024) {
        response.resume()
        finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
        return
      }
      const chunks = []
      let received = 0
      response.on('data', (chunk) => {
        received += chunk.length
        if (received > 256 * 1024) {
          response.destroy()
          finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          finish(null, parsed)
        }
        catch {
          finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
        }
      })
      response.on('error', () => finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')))
    })
    outgoing.on('error', () => finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')))
    outgoing.end(body)
  })
}

function safeWarnAsrRejection(code, message) {
  try {
    console.warn('[mip-ai-draft-provider]', {
      event: 'flash_asr_rejected',
      code: Number(code),
      message: typeof message === 'string' ? message.slice(0, 200) : '',
    })
  }
  catch {}
}

function normalizeTimeout(value) {
  const timeout = Number(value || 20_000)
  return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 45_000 ? timeout : 20_000
}

function validSecretId(value) {
  return typeof value === 'string' && /^AKID[0-9A-Za-z]{13,52}$/.test(value)
}

function validSecretKey(value) {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 64
    && /^[A-Za-z0-9+/=_-]+$/.test(value)
}

function validAppId(value) {
  return typeof value === 'string' && /^\d{4,12}$/.test(value)
}

module.exports = {
  FLASH_ASR_HOST,
  buildFlashAsrParams,
  buildFlashAsrQuery,
  createFlashAsr,
  flashAsrPath,
  isValidAsrAppId: validAppId,
  isValidAsrSecretId: validSecretId,
  isValidAsrSecretKey: validSecretKey,
  maximumAudioBytes,
  parseFlashAsrResponse,
  signFlashAsrRequest,
}
