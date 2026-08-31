'use strict'

function providerDetail(error) {
  if (!error || typeof error !== 'object') {
    return String(error || '')
  }
  return [
    error.errCode,
    error.errcode,
    error.code,
    error.errMsg,
    error.errmsg,
    error.message,
  ].filter(value => value !== undefined && value !== null).join(' ')
}

function providerErrorCode(error) {
  const detail = providerDetail(error)
  if (/\b(?:40029|40163)\b|invalid\s+(?:phone\s+)?code|code\s+(?:been\s+)?used|code\s+expired/i.test(detail)) {
    return 'PHONE_CODE_INVALID'
  }
  if (/\b(?:48001|48002|50001)\b|api\s+unauthorized|permission\s+denied|not\s+authorized/i.test(detail)) {
    return 'PHONE_PERMISSION_REQUIRED'
  }
  return 'PHONE_SERVICE_UNAVAILABLE'
}

async function resolveWechatPhone(getPhoneNumber, code) {
  if (typeof getPhoneNumber !== 'function') {
    throw new Error('PHONE_SERVICE_UNAVAILABLE')
  }
  let result
  try {
    result = await getPhoneNumber({ code })
  }
  catch (error) {
    throw new Error(providerErrorCode(error))
  }
  const responseErrorCode = result?.errCode ?? result?.errcode
  if (responseErrorCode !== undefined
    && responseErrorCode !== null
    && String(responseErrorCode) !== '0') {
    throw new Error(providerErrorCode(result))
  }
  const phoneInfo = result?.phoneInfo || result?.phone_info
  if (!phoneInfo || typeof phoneInfo !== 'object' || Array.isArray(phoneInfo)) {
    throw new Error('PHONE_BIND_FAILED')
  }
  return phoneInfo
}

function createWechatPhoneResolver(getPhoneNumber) {
  return code => resolveWechatPhone(getPhoneNumber, code)
}

module.exports = {
  createWechatPhoneResolver,
  providerErrorCode,
  resolveWechatPhone,
}
