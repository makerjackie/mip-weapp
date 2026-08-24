'use strict'

const { randomUUID } = require('node:crypto')
const { deriveMembershipCheckout, refundableAmount } = require('./pure')
const {
  createMembershipInvitation: createInvitationToken,
  hashMembershipInvitation,
  readMembershipInvitation,
} = require('../lib/membership-invitation')

function createCommerceService(options) {
  const repository = options.repository
  const catalogStage = options.catalogStage
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  const invitationSecret = options.invitationSecret

  async function listPlans(caller) {
    const rows = await repository.listPlans(caller.appId, catalogStage)
    return rows.map(planDto)
  }

  function createCheckout(caller, value) {
    const input = checkoutInput(value)
    const attribution = membershipAttribution(caller, input.invitationToken, invitationSecret, now())
    return repository.createCheckout(caller, { ...input, attribution, catalogStage }, {
      orderId: createId(),
      merchantOrderNo: merchantNumber('MIP', createId(), 32),
      outboxId: createId(),
      createdAt: now().toISOString(),
    }, deriveMembershipCheckout)
  }

  async function createMembershipInvitation(caller) {
    const inviterUserId = await repository.resolveMembershipInviter(caller)
    const expiresAt = new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000)
    return {
      token: createInvitationToken({ appId: caller.appId, inviterUserId, expiresAt }, invitationSecret),
      expiresAt: expiresAt.toISOString(),
    }
  }

  function getOrder(caller, value) {
    return repository.getOrder(caller, uuid(value?.orderId))
  }

  function listOrders(caller, value) {
    const limit = boundedLimit(value?.limit)
    return repository.listOrders(caller, limit)
  }

  function requestRefund(caller, value) {
    const input = refundInput(value)
    return repository.requestRefund(caller, input, {
      refundId: createId(),
      merchantRefundNo: merchantNumber('MIPR', createId(), 64),
      outboxId: createId(),
    }, refundableAmount)
  }

  return { createCheckout, createMembershipInvitation, getOrder, listOrders, listPlans, requestRefund }
}

function checkoutInput(value) {
  return {
    planId: uuid(value?.planId),
    idempotencyKey: boundedText(value?.idempotencyKey, 1, 128),
    invitationToken: optionalText(value?.invitationToken, 512),
  }
}

function membershipAttribution(caller, invitationToken, secret, now) {
  if (!invitationToken) {
    return { sourceType: 'PLATFORM' }
  }
  const invitation = readMembershipInvitation(invitationToken, caller.appId, secret, now)
  return {
    sourceType: 'USER',
    invitedByUserId: invitation.inviterUserId,
    sourceTokenHash: hashMembershipInvitation(invitationToken),
  }
}

function refundInput(value) {
  return {
    orderId: uuid(value?.orderId),
    idempotencyKey: boundedText(value?.idempotencyKey, 1, 128),
    reason: boundedText(value?.reason, 0, 300) || undefined,
  }
}

function planDto(row) {
  return {
    id: row.id,
    planKey: row.plan_key,
    catalogStage: row.catalog_stage,
    name: row.name,
    description: row.description || undefined,
    durationDays: Number(row.duration_days),
    priceCents: Number(row.price_cents),
    currency: row.currency,
    benefits: jsonArray(row.benefits_json),
    status: row.status,
    version: Number(row.version),
  }
}

function boundedLimit(value) {
  const limit = Number(value || 30)
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 30
}

function boundedText(value, minimum, maximum) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length < minimum || result.length > maximum) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return boundedText(value, 1, maximum)
}

function uuid(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function merchantNumber(prefix, id, maximum) {
  return `${prefix}${String(id).replaceAll('-', '').toUpperCase()}`.slice(0, maximum)
}

function jsonArray(value) {
  if (Array.isArray(value)) {
    return value
  }
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

module.exports = { checkoutInput, createCommerceService, membershipAttribution, planDto, refundInput }
