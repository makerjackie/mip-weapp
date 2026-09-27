/* global URL, Headers, Request, Response, Buffer, console */
import { isIP } from 'node:net'

const MAX_REQUEST_BYTES = 1.5 * 1024 * 1024
const discardedHeaders = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cf-connecting-ip', 'forwarded', 'x-forwarded-for', 'x-real-ip', 'x-cloudbase-context', 'x-tencent-cloudbase-request-id'])

// CloudBase node-sdk parseContext documents environment as a JSON string, with
// legacy environ using semicolon-delimited pairs. Parse this invocation only:
// process.env/getWXContext can retain another invocation's dynamic context.
// https://github.com/TencentCloudBase/node-sdk/blob/master/src/cloudbase.ts
export function trustedGatewayIp(event, context = {}) {
  let runtime = {}
  try {
    if (typeof context.environment === 'string') runtime = JSON.parse(context.environment)
    else if (context.environment && typeof context.environment === 'object') runtime = context.environment
    else if (typeof context.environ === 'string') runtime = Object.fromEntries(context.environ.split(';').filter(part => part.includes('=')).map(part => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)]))
  } catch { /* Malformed platform context does not authorize a header fallback. */ }
  const candidates = [runtime?.TCB_SOURCE_IP, runtime?.WX_CLIENTIP, runtime?.WX_CLIENTIPV6, context.clientIP, context.sourceIp, event?.requestContext?.identity?.sourceIp, event?.requestContext?.sourceIp]
  return candidates.find(value => typeof value === 'string' && isIP(value))
}

function gatewayResponse(statusCode, code) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: false, error: { code, message: statusCode === 413 ? '请求内容过大' : '服务暂时不可用' } }), isBase64Encoded: false }
}

// Client SDK invocation must be disabled on this function. Gateway event metadata is
// trustworthy only when the platform, rather than a caller, constructs the event.
export function createHttpHandler({ origin, handle, serveStatic }) {
  let base
  try {
    base = new URL(origin)
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) base = undefined
  } catch { /* Fail closed below. */ }
  return async (event, context = {}) => {
    if (!base) return gatewayResponse(503, 'CONFIGURATION_REQUIRED')
    if (!event || typeof event.path !== 'string' || typeof event.httpMethod !== 'string') return gatewayResponse(400, 'HTTP_REQUEST_REQUIRED')
    try {
      // Reject absolute URLs and dot segments before URL normalizes them.
      if (!event.path.startsWith('/') || event.path.startsWith('//') || event.path.includes('\\') || /[\r\n#?]/.test(event.path)) return gatewayResponse(400, 'INVALID_REQUEST')
      const method = event.httpMethod.toUpperCase()
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) return gatewayResponse(405, 'METHOD_NOT_ALLOWED')
      const url = new URL(event.path, base)
      const query = event.queryStringParameters || event.queryString || {}
      for (const [name, value] of Object.entries(query)) {
        if (typeof value === 'string') url.searchParams.set(name, value)
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(event.headers || {})) {
        if (!discardedHeaders.has(name.toLowerCase()) && typeof value === 'string') headers.set(name, value)
      }
      const ip = trustedGatewayIp(event, context)
      if (typeof ip === 'string' && isIP(ip)) headers.set('cf-connecting-ip', ip)
      let body
      if (event.body != null && event.body !== '') {
        if (typeof event.body !== 'string') return gatewayResponse(400, 'INVALID_REQUEST')
        if (event.body.length > MAX_REQUEST_BYTES * (event.isBase64Encoded ? 4 / 3 : 1)) return gatewayResponse(413, 'REQUEST_TOO_LARGE')
        body = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
        if (body.length > MAX_REQUEST_BYTES) return gatewayResponse(413, 'REQUEST_TOO_LARGE')
        if (method === 'GET' || method === 'HEAD') return gatewayResponse(400, 'INVALID_REQUEST')
      }
      const request = new Request(url, { method, headers, body })
      const response = url.pathname.startsWith('/api/') ? await handle(request) : await serveStatic?.(request) || new Response('Not found', { status: 404 })
      const resultHeaders = Object.fromEntries([...response.headers].filter(([key]) => key !== 'set-cookie'))
      resultHeaders['cache-control'] ||= 'no-store'
      const cookies = response.headers.getSetCookie()
      const bytes = Buffer.from(await response.arrayBuffer())
      return {
        statusCode: response.status,
        headers: resultHeaders,
        ...(cookies.length ? { multiValueHeaders: { 'set-cookie': cookies } } : {}),
        body: method === 'HEAD' ? '' : bytes.toString('base64'),
        isBase64Encoded: true,
      }
    } catch {
      // Do not log headers, request bodies, database URIs or auth material.
      console.error('[mip-admin-cloudbase] request failed')
      return gatewayResponse(503, 'SERVICE_UNAVAILABLE')
    }
  }
}
