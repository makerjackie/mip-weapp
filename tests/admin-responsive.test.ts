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

  it('applies the shared shell to every registered admin page', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages?: Array<{ root: string, pages: string[] }>
    }
    const adminPackage = app.subPackages?.find(item => item.root === 'packages/admin')

    expect(adminPackage).toBeDefined()
    if (!adminPackage) {
      return
    }
    expect(adminPackage.pages.length).toBeGreaterThan(0)
    for (const page of adminPackage.pages) {
      const routeName = page.replace(/\/index$/, '').replaceAll('/', '-')
      const source = read(`src/${adminPackage.root}/${page}.wxml`)
      const rootView = source.match(/^\s*<view\b[^>]*>/)?.[0] || ''
      const className = rootView.match(/\bclass="([^"]+)"/)?.[1] || ''
      const classTokens = className.split(/\s+/)

      expect(rootView).toContain(`id="admin-${routeName}-page"`)
      expect(classTokens).toContain('mip-admin-page')
      expect(classTokens).toContain('min-h-screen')
      expect(className).toContain('pb-[calc(env(safe-area-inset-bottom)+48rpx)]')
    }
  })
})
