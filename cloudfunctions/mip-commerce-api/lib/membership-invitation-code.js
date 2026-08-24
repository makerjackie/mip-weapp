'use strict'

const { createHash, createHmac } = require('node:crypto')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function deploymentStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  return stage
}

function codeEnvironment(stage) {
  if (stage === 'production') return 'release'
  if (stage === 'staging') return 'trial'
  return 'develop'
}

function invitationCodeKey({ appId, scene, env = process.env }) {
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  if (!appId || !/^[A-Za-z0-9_-]{32}$/.test(scene) || secret.length < 32) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = createHmac('sha256', secret).update(appId).digest('hex').slice(0, 24)
  const reference = createHash('sha256').update(scene).digest('hex').slice(0, 32)
  return `mip/${stage}/${appScope}/membership-invitations/${reference}.png`
}

async function createMembershipInvitationCode({ appId, scene, cloud, env = process.env }) {
  if (typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function'
    || typeof cloud?.uploadFile !== 'function') {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const objectKey = invitationCodeKey({ appId, scene, env })
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page: 'pages/membership/index',
    width: 430,
    checkPath: false,
    envVersion: codeEnvironment(stage),
  })
  const content = Buffer.isBuffer(response) ? response : response?.buffer
  if (!Buffer.isBuffer(content) || content.length < PNG_SIGNATURE.length
    || content.length > 2 * 1024 * 1024
    || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: content })
  const codeUrl = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
  if (!codeUrl.startsWith('cloud://') || !codeUrl.endsWith(`/${objectKey}`)
    || codeUrl.includes('..') || codeUrl.includes('\\') || /\s/.test(codeUrl)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  return { codeUrl }
}

module.exports = { codeEnvironment, createMembershipInvitationCode, deploymentStage, invitationCodeKey }
