'use strict'

const cloud = require('wx-server-sdk')
const { createMediaService } = require('./domain/service')
const { resolveActiveUser, trustedWechatIdentity } = require('./lib/identity')
const {
  MEDIA_ADMIN_TRANSPORT,
  createInternalMediaHandler,
} = require('./lib/internal-admin-transport')
const { verifyMaintenanceRequest } = require('./lib/internal-auth')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const messages = {
  AUTH_REQUIRED: '当前微信身份不可用，请重试',
  FORBIDDEN: '当前账号不能上传素材',
  IMAGE_CONTENT_REJECTED: '图片未通过安全检查，请更换后重试',
  IMAGE_DIMENSIONS_INVALID: '图片尺寸不符合要求',
  IMAGE_INVALID: '图片格式无效，请选择 PNG 或 JPEG 图片',
  IMAGE_SAFETY_UNAVAILABLE: '图片安全检查暂时不可用，请稍后重试',
  IMAGE_TOO_LARGE: '图片过大，请压缩后重试',
  MEDIA_CLEANUP_CONFIG_REQUIRED: '素材清理尚未配置',
  MEDIA_CLEANUP_FORBIDDEN: '素材清理请求无效',
  MEDIA_CLEANUP_INVALID: '素材清理参数无效',
  PURPOSE_INVALID: '素材用途无效',
  SERVICE_UNAVAILABLE: '素材服务暂时不可用',
  UPLOAD_FAILED: '图片上传失败，请重试',
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const raw = error instanceof Error ? error.message : ''
  const code = messages[raw] ? raw : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code],
      retryable: ['IMAGE_SAFETY_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'UPLOAD_FAILED'].includes(code),
    },
  }
}

exports.main = async (event = {}) => {
  const database = mysqlDatabase()
  const service = createMediaService({ database, cloud })
  try {
    if (event.transport === MEDIA_ADMIN_TRANSPORT) {
      return createInternalMediaHandler({
        service,
        database,
        secret: process.env.MIP_MEDIA_ADMIN_HMAC_SECRET,
        allowedAppIds: new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
          .split(',').map(value => value.trim()).filter(Boolean)),
        failure,
      })(event)
    }
    if (event.action === 'health') {
      return success(await service.health())
    }
    if (event.action === 'cleanupOrphans') {
      verifyMaintenanceRequest(event, {
        allowedAppIds: new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
          .split(',').map(value => value.trim()).filter(Boolean)),
        secret: process.env.MIP_MEDIA_MAINTENANCE_HMAC_SECRET,
      })
      return success(await service.cleanupOrphans(event.appId, event))
    }
    if (event.action !== 'uploadImage') {
      throw new Error('PURPOSE_INVALID')
    }
    const identity = trustedWechatIdentity(cloud.getWXContext())
    const caller = await resolveActiveUser(database, identity)
    return success(await service.uploadImage(caller, event))
  }
  catch (error) {
    return failure(error)
  }
}

exports._test = { failure, MEDIA_ADMIN_TRANSPORT, success, verifyMaintenanceRequest }
