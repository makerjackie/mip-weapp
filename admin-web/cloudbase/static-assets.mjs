/* global Response, URL */
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
const security = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; form-action 'self'",
}
export function createStaticHandler(root) {
  const directory = resolve(root)
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
      const body = await readFile(file)
      return new Response(request.method === 'HEAD' ? null : body, { headers: { ...security, 'content-type': contentType, 'cache-control': relative === 'index.html' ? 'no-store' : 'public, max-age=0, must-revalidate' } })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return new Response('Not found', { status: 404 })
      throw error
    }
  }
}
