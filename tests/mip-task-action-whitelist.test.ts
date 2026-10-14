import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

const { TASK_JUMP_TARGET_WHITELIST } = require('../cloudfunctions/mip-tasks-api/domain/task-action-targets') as {
  TASK_JUMP_TARGET_WHITELIST: string[]
}

interface RuntimePageRoute { path: string, name: string, tab?: boolean, query?: string[] }

const runtime = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-pages.json'), 'utf8')) as {
  routes: RuntimePageRoute[]
}

// MIW-97：服务端白名单 = runtime-pages.json 按 admin-web 同款过滤派生
// （排除 packages/admin/ 前缀与必须带 query 才可达的页面）。
const expectedTargets = runtime.routes
  .filter(route => !route.path.startsWith('packages/admin/') && !(route.query && route.query.length > 0))
  .map(route => route.path)

describe('MIW-97 task jump target whitelist parity', () => {
  it('cloud constant matches the runtime-pages.json derived whitelist item by item', () => {
    expect([...TASK_JUMP_TARGET_WHITELIST].sort()).toEqual([...expectedTargets].sort())
  })

  it('keeps every tab page reachable (switchTab targets, no query)', () => {
    const tabs = runtime.routes.filter(route => route.tab).map(route => route.path)
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) {
      expect(TASK_JUMP_TARGET_WHITELIST).toContain(tab)
    }
  })

  it('stores targets in the canonical page format (no leading slash, no query, no dupes)', () => {
    for (const target of TASK_JUMP_TARGET_WHITELIST) {
      expect(target).not.toMatch(/^\//)
      expect(target).not.toContain('?')
    }
    expect(new Set(TASK_JUMP_TARGET_WHITELIST).size).toBe(TASK_JUMP_TARGET_WHITELIST.length)
  })

  it('pins the admin-web filter rule so a rule change forces a whitelist sync', () => {
    const adminSource = fs.readFileSync(path.join(root, 'admin-web/src/modules/admin-task-management.ts'), 'utf8')
    expect(adminSource).toContain('!route.path.startsWith(\'packages/admin/\')')
    expect(adminSource).toContain('!(route.query && route.query.length > 0)')
  })
})
