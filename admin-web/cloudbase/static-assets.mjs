/* global Response, URL */
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { gzipSync } from 'node:zlib'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
const security = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; form-action 'self'",
}
export function createStaticHandler(root) {
  const directory = resolve(root)
  const compressed = new Map()
  let compressedBytes = 0
  return async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
    const path = decodeURIComponent(new URL(request.url).pathname)
    const relative = path === '/' ? 'index.html' : path.slice(1)
    // Only browser asset types; never source maps, dot files or deployment files.
    const contentType = types[extname(relative)]
    if (!contentType || relative.split('/').some(part => part.startsWith('.') || part.includes('\\'))) return new Response('Not found', { status: 404 })
    const file = resolve(directory, relative)
    if (!file.startsWith(`${directory}/`)) return new Response('Not found', { status: 404 })
    try {
      let body = await readFile(file)
      const hashed = /-[\w-]{8,}\.(?:js|css|woff2|png|jpe?g|webp|svg)$/.test(relative)
      const headers = { ...security, 'content-type': contentType, 'cache-control': relative === 'index.html' ? 'no-store' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' }
      if (body.length >= 1024 && /^(?:text\/|application\/json|image\/svg)/.test(contentType)) {
        headers.vary = 'Accept-Encoding'
        if (acceptsGzip(request.headers.get('accept-encoding'))) {
          let encoded = compressed.get(file)
          if (!encoded) {
            encoded = gzipSync(body)
            // A warm instance reuses compressed immutable assets, with bounded memory.
            if (hashed && compressedBytes + encoded.length <= 16 * 1024 * 1024) {
              compressed.set(file, encoded)
              compressedBytes += encoded.length
            }
          }
          body = encoded
          headers['content-encoding'] = 'gzip'
        }
      }
      headers['content-length'] = String(body.length)
      return new Response(request.method === 'HEAD' ? null : body, { headers })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return new Response('Not found', { status: 404 })
      throw error
    }
  }
}

function acceptsGzip(value) {
  const encodings = new Map(String(value || '').toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';')
    const quality = parameters.map(item => item.trim()).find(item => item.startsWith('q='))
    const q = quality ? Number(quality.slice(2)) : 1
    return [name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0]
  }))
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0
}
