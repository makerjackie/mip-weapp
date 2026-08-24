'use strict'

const dns = require('node:dns').promises
const https = require('node:https')
const net = require('node:net')
const { createBrotliDecompress, createGunzip, createInflate } = require('node:zlib')

const DEFAULT_MAX_BYTES = 2_000_000

async function fetchPinnedHttpsText(endpoint, options = {}) {
  const url = endpoint instanceof URL ? endpoint : new URL(String(endpoint))
  const addresses = await resolvePublicAddresses(url.hostname, options.lookup || dns.lookup)
  const selected = addresses[0]
  const request = options.request || https.request
  const timeoutMs = Number(options.timeoutMs || 10_000)
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const requestOptions = {
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        accept: options.accept || 'application/json',
        'accept-encoding': 'gzip, deflate, br',
        'user-agent': 'mip-knowledge-ingestion/1.0',
      },
      lookup: pinnedLookup(url.hostname, selected),
      servername: url.hostname,
    }
    const req = request(requestOptions, async (response) => {
      try {
        const status = Number(response.statusCode || 0)
        if (status < 200 || status >= 300) throw new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
        const declaredBytes = Number(response.headers?.['content-length'] || 0)
        if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
          throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
        }
        const contentType = String(response.headers?.['content-type'] || '').toLowerCase()
        if (options.allowedContentTypes?.length
          && !options.allowedContentTypes.some(value => contentType.startsWith(value))) {
          throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
        }
        const body = await readLimitedDecodedBody(response, {
          contentEncoding: response.headers?.['content-encoding'],
          maxBytes,
        })
        finish(null, body)
      }
      catch (error) {
        response.destroy?.()
        finish(error)
      }
    })
    req.once('error', error => finish(normalizeFetchError(error)))
    req.setTimeout?.(timeoutMs, () => req.destroy(new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')))
    req.end()
  })
}

async function resolvePublicAddresses(hostname, lookup = dns.lookup) {
  const normalizedHost = stripIpv6Brackets(String(hostname || '').toLowerCase())
  if (!normalizedHost || net.isIP(normalizedHost)) throw new Error('KNOWLEDGE_SOURCE_URL_INVALID')
  let rows
  try {
    rows = await lookup(normalizedHost, { all: true, verbatim: true })
  }
  catch {
    throw new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
  }
  const addresses = Array.isArray(rows) ? rows : rows ? [rows] : []
  if (!addresses.length || addresses.some(row => !isPublicAddress(row.address))) {
    throw new Error('KNOWLEDGE_SOURCE_URL_INVALID')
  }
  return addresses.map(row => ({
    address: String(row.address),
    family: Number(row.family) || net.isIP(String(row.address)),
  }))
}

function pinnedLookup(expectedHostname, selected) {
  const expected = stripIpv6Brackets(String(expectedHostname || '').toLowerCase())
  return (hostname, options, callback) => {
    if (stripIpv6Brackets(String(hostname || '').toLowerCase()) !== expected) {
      callback(new Error('KNOWLEDGE_SOURCE_URL_INVALID'))
      return
    }
    if (options?.all) {
      callback(null, [{ address: selected.address, family: selected.family }])
      return
    }
    callback(null, selected.address, selected.family)
  }
}

async function readLimitedDecodedBody(stream, options = {}) {
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES)
  const encoding = String(options.contentEncoding || '').trim().toLowerCase()
  const decoded = decodingStream(stream, encoding)
  const chunks = []
  let total = 0
  try {
    for await (const value of decoded) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      total += chunk.length
      if (total > maxBytes) throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
      chunks.push(chunk)
    }
  }
  catch (error) {
    decoded.destroy?.()
    stream.destroy?.()
    throw normalizeResponseError(error)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function decodingStream(stream, encoding) {
  if (!encoding || encoding === 'identity') return stream
  if (encoding === 'gzip' || encoding === 'x-gzip') return stream.pipe(createGunzip())
  if (encoding === 'deflate') return stream.pipe(createInflate())
  if (encoding === 'br') return stream.pipe(createBrotliDecompress())
  throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
}

function isPublicAddress(value) {
  const address = stripIpv6Brackets(String(value || '').toLowerCase())
  const family = net.isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address) {
  const words = ipv6Words(address)
  if (!words) return false
  // Only globally routable unicast (2000::/3) is accepted. This excludes
  // loopback, ULA, link-local, multicast, documentation and IPv4-mapped forms.
  if ((words[0] & 0xe000) !== 0x2000) return false
  if (words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8)) return false
  return ![0x2002, 0x3ffe].includes(words[0])
}

function ipv6Words(address) {
  if (net.isIP(address) !== 6 || address.includes('.')) return null
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : []
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const values = [...left, ...Array(missing).fill('0'), ...right].map(value => Number.parseInt(value, 16))
  return values.length === 8 && values.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : null
}

function stripIpv6Brackets(value) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function normalizeFetchError(error) {
  return ['KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE', 'KNOWLEDGE_SOURCE_RESPONSE_INVALID', 'KNOWLEDGE_SOURCE_URL_INVALID']
    .includes(error?.message) ? error : new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
}

function normalizeResponseError(error) {
  return error?.message === 'KNOWLEDGE_SOURCE_RESPONSE_INVALID'
    ? error
    : new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
}

module.exports = {
  fetchPinnedHttpsText,
  isPublicAddress,
  pinnedLookup,
  readLimitedDecodedBody,
  resolvePublicAddresses,
}
