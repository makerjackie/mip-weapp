'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  isWebBffHttpEvent,
  parseWebBffHttpBody,
  webBffHttpError,
  webBffHttpResponse,
} = require('../lib/web-bff-http')

describe('Web BFF HTTP gateway adapter', () => {
  it('parses the CloudBase HTTP access event without trusting headers as identity', () => {
    const body = { transport: 'MIP_WEB_BFF_V1', principal: { appId: 'untrusted' } }
    const event = {
      httpMethod: 'POST',
      headers: { authorization: 'browser-value' },
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
      isBase64Encoded: true,
    }
    assert.equal(isWebBffHttpEvent(event), true)
    assert.deepEqual(parseWebBffHttpBody(event), body)
  })

  it('rejects methods and oversized or malformed bodies', () => {
    assert.throws(() => parseWebBffHttpBody({ httpMethod: 'GET', body: '{}' }), /METHOD_NOT_ALLOWED/)
    assert.throws(() => parseWebBffHttpBody({ httpMethod: 'POST', body: '{' }), /REQUEST_INVALID/)
    assert.throws(
      () => parseWebBffHttpBody({ httpMethod: 'POST', body: JSON.stringify({ value: 'x'.repeat(33_000) }) }),
      /TOO_LARGE/,
    )
  })

  it('returns an explicit non-cacheable HTTP response envelope', () => {
    assert.deepEqual(webBffHttpResponse({ ok: true, data: {} }), {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: '{"ok":true,"data":{}}',
      isBase64Encoded: false,
    })
    assert.equal(webBffHttpError(new Error('HTTP_METHOD_NOT_ALLOWED')).statusCode, 405)
  })
})
