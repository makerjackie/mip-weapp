'use strict'

const cloud = require('wx-server-sdk')
const { DomainError } = require('./domain/rules')
const service = require('./domain/event-service')
const { resolveMipUser, trustedWechatIdentity } = require('./lib/identity')
const { createCheckInCodeAsset } = require('./lib/checkin-poster')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const publicActions = new Set([
  'mip.events.list',
  'mip.events.detail',
  'mip.events.publicParticipants',
  'mip.events.album.list',
  'mip.events.resolveCheckInScene',
])
const userActions = new Set([
  'mip.events.mine',
  'mip.events.myRegistration',
  'mip.events.register',
  'mip.events.updateRegistration',
  'mip.events.cancelRegistration',
  'mip.events.checkIn',
  'mip.events.heartCandidates',
  'mip.events.heart',
  'mip.events.setHeart',
  'mip.events.feedback',
  'mip.events.saveFeedback',
  'mip.events.createInvitation',
  'mip.events.album.mine',
  'mip.events.album.submit',
  'mip.events.album.withdraw',
])
const adminActions = new Set([
  'mip.events.admin.issueCheckInCredential',
  'mip.events.admin.createCheckInPoster',
  'mip.events.admin.listFeedback',
])

function response(data) {
  return { ok: true, data }
}

function errorResponse(error) {
  if (error instanceof DomainError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, retryable: error.retryable === true },
    }
  }
  console.error('[mip-events-api] request failed', error?.code || error?.name || 'UNKNOWN')
  return {
    ok: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: '活动服务暂时不可用', retryable: true },
  }
}

function interactionTokenSecret() {
  return process.env.MIP_EVENT_TOKEN_SECRET || ''
}

function paymentAvailable() {
  return process.env.MIP_PAYMENT_MODE === 'test' || process.env.MIP_PAYMENT_MODE === 'live'
}

async function caller(event, { requireUser }) {
  const identity = trustedWechatIdentity(cloud.getWXContext(), { requireUser })
  const user = await resolveMipUser(mysqlDatabase(), identity, { required: requireUser })
  return { appId: identity.appId, userId: user?.id || null }
}

async function dispatch(event) {
  const action = typeof event?.action === 'string' ? event.action : ''
  if (action === 'health') {
    await mysqlDatabase().one('SELECT 1 AS ok')
    return { service: 'mip-events-api', persistence: 'cloudbase-mysql' }
  }
  if (!publicActions.has(action) && !userActions.has(action) && !adminActions.has(action)) {
    throw new DomainError('NOT_FOUND', '活动操作不存在')
  }
  const current = await caller(event, { requireUser: !publicActions.has(action) })
  const shared = {
    appId: current.appId,
    userId: current.userId,
    tokenSecret: interactionTokenSecret(),
    profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
  }
  switch (action) {
    case 'mip.events.list':
      return service.listEvents(mysqlDatabase(), { ...shared, query: event.query || {} })
    case 'mip.events.detail':
      return service.getEvent(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.publicParticipants':
      return service.listPublicParticipants(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        query: event.query || {},
      })
    case 'mip.events.album.list':
      return service.listEventAlbum(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        cursor: event.cursor,
        limit: event.limit,
      })
    case 'mip.events.resolveCheckInScene':
      return service.resolveCheckInScene(mysqlDatabase(), { ...shared, scene: event.scene })
    case 'mip.events.mine':
      return service.listMyRegistrations(mysqlDatabase(), { ...shared, cursor: event.cursor })
    case 'mip.events.myRegistration':
      return service.getMyRegistration(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.register':
      return service.createRegistration(mysqlDatabase(), {
        ...shared,
        input: event,
        paymentAvailable: paymentAvailable(),
      })
    case 'mip.events.updateRegistration':
      return service.updateRegistration(mysqlDatabase(), { ...shared, input: event })
    case 'mip.events.cancelRegistration':
      return service.cancelRegistration(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        expectedVersion: event.expectedVersion,
        paymentAvailable: paymentAvailable(),
      })
    case 'mip.events.checkIn':
      return service.checkIn(mysqlDatabase(), {
        ...shared,
        scanToken: event.scanToken,
        idempotencyKey: event.idempotencyKey,
        expectedVersion: event.expectedVersion,
      })
    case 'mip.events.heartCandidates':
      return service.listHeartCandidates(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.heart':
      return service.getHeart(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.setHeart':
      return service.setHeart(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        targetRef: event.targetRef || null,
        expectedVersion: event.expectedVersion,
      })
    case 'mip.events.feedback':
      return service.getFeedback(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.saveFeedback':
      return service.saveFeedback(mysqlDatabase(), { ...shared, eventId: event.eventId, draft: event.draft })
    case 'mip.events.createInvitation':
      return service.createInvitation(mysqlDatabase(), { ...shared, eventId: event.eventId })
    case 'mip.events.album.mine':
      return service.listMyEventAlbumSubmissions(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
      })
    case 'mip.events.album.submit':
      return service.submitEventAlbumPhoto(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        mediaAssetId: event.mediaAssetId,
        caption: event.caption,
      })
    case 'mip.events.album.withdraw':
      return service.withdrawEventAlbumPhoto(mysqlDatabase(), {
        ...shared,
        photoId: event.photoId,
        expectedVersion: event.expectedVersion,
      })
    case 'mip.events.admin.issueCheckInCredential':
      return service.adminIssueCheckInCredential(mysqlDatabase(), { ...shared, eventId: event.eventId, mode: event.mode })
    case 'mip.events.admin.createCheckInPoster': {
      const credential = await service.adminIssueCheckInCredential(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        mode: event.mode === 'ROTATING' ? 'ROTATING' : 'STATIC',
      })
      const asset = await createCheckInCodeAsset({
        appId: current.appId,
        eventId: credential.eventId,
        credentialId: credential.credentialId,
        ownerUserId: current.userId,
        scene: credential.scanToken,
        cloud,
        database: mysqlDatabase(),
      })
      return { ...credential, ...asset }
    }
    case 'mip.events.admin.listFeedback':
      return service.adminListFeedback(mysqlDatabase(), {
        ...shared,
        eventId: event.eventId,
        cursor: event.cursor,
        limit: event.limit,
        rating: event.rating,
      })
    default:
      throw new DomainError('NOT_FOUND', '活动操作不存在')
  }
}

exports.main = async (event = {}) => {
  try {
    return response(await dispatch(event))
  }
  catch (error) {
    return errorResponse(error)
  }
}

exports._test = { dispatch }
