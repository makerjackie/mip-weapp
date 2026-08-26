'use strict'

const dns = require('node:dns').promises
const https = require('node:https')
const { isIP } = require('node:net')

function createHttpsJsonClient(options = {}) {
  const lookup = options.lookup || dns.lookup.bind(dns)
  const request = options.request || https.request

  async function resolveEndpoint(endpoint) {
    const records = await lookup(endpoint.hostname, { all: true, verbatim: true })
      .catch(() => { throw new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE') })
    if (!Array.isArray(records)
      || !records.length
      || records.some(record => (
        !isPublicAddress(record?.address)
        || isIP(record.address) !== Number(record.family)
      ))) {
      throw new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')
    }
    const selected = records[0]
    return { address: selected.address, family: Number(selected.family) }
  }

  async function preflight(endpoint) {
    await resolveEndpoint(endpoint)
    return true
  }

  async function postJson(endpoint, body, requestOptions = {}) {
    const serialized = JSON.stringify(body)
    const maximumRequestBytes = Number(requestOptions.maximumRequestBytes || 3 * 1024 * 1024)
    const maximumResponseBytes = Number(requestOptions.maximumResponseBytes || 64 * 1024)
    const requestBytes = Buffer.byteLength(serialized)
    if (!requestBytes || requestBytes > maximumRequestBytes) {
      throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
    }
    const selected = await resolveEndpoint(endpoint)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value)
      }
      const outgoing = request(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          authorization: `Bearer ${requestOptions.secret}`,
          'content-length': String(requestBytes),
          'content-type': 'application/json',
          'idempotency-key': requestOptions.operationKey,
          'x-mip-payload-sha256': requestOptions.payloadDigest,
          'x-mip-request-id': requestOptions.requestId,
        },
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions?.all) {
            callback(null, [selected])
            return
          }
          callback(null, selected.address, selected.family)
        },
      }, (response) => {
        const status = Number(response.statusCode || 0)
        const contentType = String(response.headers?.['content-type'] || '').toLowerCase()
        const encoding = String(response.headers?.['content-encoding'] || '').toLowerCase()
        const contentLength = Number(response.headers?.['content-length'] || 0)
        if (status >= 300 && status < 400) {
          response.resume()
          finish(new Error('AI_DRAFT_PROVIDER_REDIRECT_REJECTED'))
          return
        }
        if (status !== 200
          || !/^application\/json(?:\s*;|$)/.test(contentType)
          || encoding && encoding !== 'identity'
          || !Number.isSafeInteger(contentLength)
          || contentLength < 0
          || contentLength > maximumResponseBytes) {
          response.resume()
          finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
          return
        }
        const chunks = []
        let received = 0
        response.on('data', (chunk) => {
          received += chunk.length
          if (received > maximumResponseBytes) {
            response.destroy()
            finish(new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (settled) return
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('invalid')
            }
            finish(null, parsed)
          }
          catch {
            finish(new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID'))
          }
        })
        response.on('error', () => finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')))
      })
      outgoing.setTimeout(requestOptions.timeoutMs, () => {
        outgoing.destroy()
        finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE'))
      })
      outgoing.on('error', () => finish(new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')))
      outgoing.end(serialized)
    })
  }

  return { postJson, preflight, resolveEndpoint }
}

function isPublicAddress(value) {
  const address = typeof value === 'string' ? value.split('%')[0].toLowerCase() : ''
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1]
  if (mapped) return isPublicIpv4(mapped)
  const number = ipv6Number(address)
  if (number == null) return false
  return inRange(number, '2000::', 3)
    && !inRange(number, '2001::', 32)
    && !inRange(number, '2001:2::', 48)
    && !inRange(number, '2001:10::', 28)
    && !inRange(number, '2001:20::', 28)
    && !inRange(number, '2001:db8::', 32)
    && !inRange(number, '2002::', 16)
}

function isPublicIpv4(value) {
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some(item => !Number.isInteger(item) || item < 0 || item > 255)) {
    return false
  }
  const number = octets.reduce((result, item) => (result << 8n) | BigInt(item), 0n)
  return ![
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([base, prefix]) => inIpv4Range(number, base, prefix))
}

function inIpv4Range(value, base, prefix) {
  const baseValue = base.split('.').map(Number)
    .reduce((result, item) => (result << 8n) | BigInt(item), 0n)
  const shift = BigInt(32 - prefix)
  return value >> shift === baseValue >> shift
}

function inRange(value, base, prefix) {
  const baseValue = ipv6Number(base)
  const shift = BigInt(128 - prefix)
  return baseValue != null && value >> shift === baseValue >> shift
}

function ipv6Number(value) {
  let address = value
  const ipv4 = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1]
  if (ipv4) {
    const octets = ipv4.split('.').map(Number)
    if (octets.some(item => !Number.isInteger(item) || item < 0 || item > 255)) return null
    const pair = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
    address = address.slice(0, -ipv4.length) + pair
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || halves.length === 1 && missing !== 0) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[a-f0-9]{1,4}$/i.test(group))) return null
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n)
}

module.exports = {
  createHttpsJsonClient,
  isPublicAddress,
  isPublicIpv4,
  ipv6Number,
}
