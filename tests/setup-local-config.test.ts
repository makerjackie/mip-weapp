import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildDevtoolsPrivateConfig } from '../scripts/lib/devtools-private-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('local DevTools condition generation', () => {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'config/project.json'), 'utf8'))

  it('generates every tracked route including the onsite workbench pages', () => {
    const config = buildDevtoolsPrivateConfig({
      appid: 'local-test-appid',
      existing: {
        condition: { plugin: { list: [{ name: 'preserved' }] } },
        setting: { urlCheck: false },
      },
      projectName: 'MIP local test',
      routes: project.routes,
    })
    const routes = config.condition.miniprogram.list.map((route: { pathName: string }) => route.pathName)

    expect(routes).toHaveLength(project.routes.length)
    expect(new Set(routes).size).toBe(project.routes.length)
    expect(routes).toContain('packages/member/mip-events/comments/index')
    expect(routes.filter(route => route.startsWith('packages/admin/'))).toEqual([
      'packages/admin/dashboard/index',
      'packages/admin/web-login-confirm/index',
      'packages/admin/managed-events/index',
      'packages/admin/event-console/index',
      'packages/admin/event-registrations/index',
    ])
    expect(config.condition.plugin.list).toEqual([{ name: 'preserved' }])
    expect(config.setting).toMatchObject({ compileHotReLoad: true, urlCheck: false })
  })

  it('keeps project.private.config.json local-only', () => {
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    expect(gitignore.split(/\r?\n/)).toContain('project.private.config.json')
  })
})
