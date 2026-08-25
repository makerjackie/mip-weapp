import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP admin responsive foundation', () => {
  it('allows the WeChat desktop window to be resized', () => {
    const app = JSON.parse(read('src/app.json')) as { resizable?: boolean }

    expect(app.resizable).toBe(true)
  })

  it('defines phone, medium, and desktop layout ranges without changing runtime state', () => {
    const styles = read('src/app.css')

    expect(styles).toContain('@media (max-width: 599px)')
    expect(styles).toContain('@media (min-width: 600px) and (max-width: 959px)')
    expect(styles).toContain('@media (min-width: 960px)')
    expect(styles).toContain('max-width: 1280px')
    expect(styles).toContain('.mip-admin-card-list')
    expect(styles).toContain('.mip-admin-form-grid')
    expect(styles).toContain('.mip-admin-menu-grid')
  })

  it('applies the shared layout only to representative admin pages', () => {
    const pages = [
      'dashboard',
      'profiles',
      'managed-events',
      'event-console',
      'events',
      'event-registrations',
      'orders',
    ]

    for (const page of pages) {
      expect(read(`src/packages/admin/${page}/index.wxml`)).toContain('mip-admin-page')
    }

    expect(read('src/packages/admin/dashboard/index.wxml')).toContain('mip-admin-metric-grid')
    expect(read('src/packages/admin/profiles/index.wxml')).toContain('mip-admin-card-list')
    expect(read('src/packages/admin/managed-events/index.wxml')).toContain('mip-admin-card-list')
    expect(read('src/packages/admin/event-console/index.wxml')).toContain('mip-admin-menu-grid')
    expect(read('src/packages/admin/events/index.wxml')).toContain('mip-admin-form-grid')
    expect(read('src/packages/admin/event-registrations/index.wxml')).toContain('mip-admin-card-list')
    expect(read('src/packages/admin/orders/index.wxml')).toContain('mip-admin-summary-grid')
  })
})
