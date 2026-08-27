'use strict'

const MAX_HTTP_BODY_BYTES = 32 * 1024

function isWebBffHttpEvent(event) {
  return Boolean(event
    && typeof event === 'object'
    && typeof event.httpMethod === 'string'
    && Object.hasOwn(event, 'body'))
}

function parseWebBffHttpBody(event) {
  if (!isWebBffHttpEvent(event) || event.httpMethod.toUpperCase() !== 'POST') {
    throw new Error('HTTP_METHOD_NOT_ALLOWED')
  }
  if (event.isBase64Encoded !== undefined && typeof event.isBase64Encoded !== 'boolean') {
    throw new Error('HTTP_REQUEST_INVALID')
  }
  let body
  if (event.isBase64Encoded) {
    if (typeof event.body !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.body)) {
      throw new Error('HTTP_REQUEST_INVALID')
    }
    body = Buffer.from(event.body, 'base64').toString('utf8')
  }
  else {
    body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body)
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_HTTP_BODY_BYTES) {
    throw new Error('HTTP_REQUEST_TOO_LARGE')
  }
  let parsed
  try { parsed = JSON.parse(body) }
  catch { throw new Error('HTTP_REQUEST_INVALID') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('HTTP_REQUEST_INVALID')
  }
  return parsed
}

function webBffHttpResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  }
}

function webBffHttpError(error) {
  const method = error?.message === 'HTTP_METHOD_NOT_ALLOWED'
  return webBffHttpResponse({
    ok: false,
    error: {
      code: method ? 'METHOD_NOT_ALLOWED' : 'VALIDATION_FAILED',
      message: method ? '请求方法不受支持' : '运营请求格式无效',
      retryable: false,
    },
  }, method ? 405 : 400)
}

module.exports = {
  isWebBffHttpEvent,
  parseWebBffHttpBody,
  webBffHttpError,
  webBffHttpResponse,
}
