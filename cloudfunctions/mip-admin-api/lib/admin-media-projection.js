'use strict'
const URL_KEYS = new Set(['imageUrl', 'coverUrl', 'avatarUrl', 'url'])
function createAdminMediaProjection(cloud) {
  return async value => {
    const ids = new Set()
    const walk = (item, visit) => {
      if (Array.isArray(item)) return item.map(child => walk(child, visit))
      if (!item || typeof item !== 'object') return item
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key,
        URL_KEYS.has(key) && typeof child === 'string' && child.startsWith('cloud://') ? visit(child) : walk(child, visit)]))
    }
    walk(value, id => { ids.add(id); return id })
    if (!ids.size) return value
    let urls = new Map()
    try {
      const result = await cloud.getTempFileURL({ fileList: [...ids], maxAge: 600 })
      urls = new Map((result.fileList || []).filter(item => /^https:\/\//.test(item.tempFileURL || '')).map(item => [item.fileID, item.tempFileURL]))
    } catch { /* Optional media failures leave business data usable. */ }
    return walk(value, id => urls.get(id) || '')
  }
}
module.exports = { createAdminMediaProjection }
