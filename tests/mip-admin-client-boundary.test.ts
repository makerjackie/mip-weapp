import type { MipAdminClientGateway } from '../src/modules/mip-admin/client'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'

const adminPagesRoot = join(process.cwd(), 'src/packages/admin')

function adminPageScripts(directory = adminPagesRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return adminPageScripts(path)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('MIP admin client boundary', () => {
  it('exposes named domain modules without legacy root method aliases', () => {
    const operation = vi.fn()
    const gateway = new Proxy({}, { get: () => operation }) as MipAdminClientGateway
    const module = createMipAdminModule(gateway)

    expect(Object.keys(module).sort()).toEqual([
      'events',
      'runtime',
      'session',
    ])
  })

  it('keeps admin pages on named domain modules', () => {
    const offenders = adminPageScripts().flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return source.match(/mipAdminModule\.[A-Za-z_$][\w$]*\s*\(/g)?.map(match => ({
        file: relative(process.cwd(), path),
        call: match,
      })) || []
    })

    expect(offenders).toEqual([])
  })
})
