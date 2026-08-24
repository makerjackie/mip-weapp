'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const REF_PATTERN = /^mc1\.[\w-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createCandidateRef(input, secret) {
  if (!input?.appId || !UUID_PATTERN.test(input.requestId)
    || !UUID_PATTERN.test(input.candidateId)
    || !['TALENT', 'PROJECT'].includes(input.candidateType)
    || !Number.isInteger(input.resultVersion) || input.resultVersion < 1) {
    throw new Error('MATCHING_CANDIDATE_REF_INVALID')
  }
  const signature = createHmac('sha256', key(secret))
    .update([
      input.appId,
      input.requestId,
      String(input.resultVersion),
      input.candidateType,
      input.candidateId,
    ].join('\0'))
    .digest('base64url')
  return `mc1.${signature}`
}

function candidateRefEquals(left, right) {
  if (!REF_PATTERN.test(String(left || '')) || !REF_PATTERN.test(String(right || ''))) { return false }
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function assertCandidateRef(value) {
  if (!REF_PATTERN.test(String(value || ''))) { throw new Error('VALIDATION_FAILED') }
  return String(value)
}

function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32) { throw new Error('MATCHING_CONFIG_REQUIRED') }
  return createHash('sha256').update('mip-matching-candidate-ref:v1\0').update(secret).digest()
}

module.exports = { assertCandidateRef, candidateRefEquals, createCandidateRef }
