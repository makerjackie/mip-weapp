'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { DomainError } = require('../domain/rules')

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function createSignedToken(payload, secret) {
  if (!secret) {
    throw new DomainError('SERVICE_UNAVAILABLE', '活动互动服务暂时不可用', true)
  }
  const body = base64url(JSON.stringify(payload))
  return `${body}.${signature(body, secret)}`
}

function readSignedToken(token, secret, expectedType, now = new Date()) {
  if (!secret || typeof token !== 'string' || !token.includes('.')) {
    throw new DomainError('VALIDATION_FAILED', '活动凭证无效')
  }
  const [body, provided] = token.split('.', 2)
  if (!body || !provided || !safeEqual(provided, signature(body, secret))) {
    throw new DomainError('VALIDATION_FAILED', '活动凭证无效')
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  }
  catch {
    throw new DomainError('VALIDATION_FAILED', '活动凭证无效')
  }
  if (!payload || payload.type !== expectedType || (payload.expiresAt && Date.parse(payload.expiresAt) <= now.getTime())) {
    throw new DomainError('VALIDATION_FAILED', '活动凭证已失效')
  }
  return payload
}

module.exports = { createSignedToken, readSignedToken }
