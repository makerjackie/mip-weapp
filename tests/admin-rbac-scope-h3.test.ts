import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canDelegateAdminRole, scopeTypeForAdminRole } from '../src/modules/mip-admin/role-delegation'

describe('MIP admin role scope', () => {
  it('keeps the platform, branch and event delegation chain narrow', () => {
    const platformOwner = [{ roleKey: 'PLATFORM_OWNER' as const, scopeType: 'PLATFORM' as const, scopeId: null }]
    const branchAdmin = [{ roleKey: 'BRANCH_ADMIN' as const, scopeType: 'BRANCH' as const, scopeId: 'branch-a' }]
    const eventOwner = [{ roleKey: 'EVENT_OWNER' as const, scopeType: 'EVENT' as const, scopeId: 'event-a' }]
    const eventManager = [{ roleKey: 'EVENT_MANAGER' as const, scopeType: 'EVENT' as const, scopeId: 'event-a' }]
    const eventScope = { scopeType: 'EVENT' as const, scopeId: 'event-a', branchId: 'branch-a' }

    expect(scopeTypeForAdminRole('PLATFORM_FINANCE')).toBe('PLATFORM')
    expect(scopeTypeForAdminRole('BRANCH_ADMIN')).toBe('BRANCH')
    expect(scopeTypeForAdminRole('EVENT_STAFF')).toBe('EVENT')
    expect(canDelegateAdminRole(platformOwner, 'BRANCH_ADMIN', {
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      branchId: 'branch-a',
    })).toBe(true)
    expect(canDelegateAdminRole(branchAdmin, 'EVENT_OWNER', eventScope)).toBe(true)
    expect(canDelegateAdminRole(branchAdmin, 'EVENT_OWNER', { ...eventScope, branchId: 'branch-b' })).toBe(false)
    expect(canDelegateAdminRole(eventOwner, 'EVENT_MANAGER', eventScope)).toBe(true)
    expect(canDelegateAdminRole(eventOwner, 'EVENT_OWNER', eventScope)).toBe(false)
    expect(canDelegateAdminRole(eventManager, 'EVENT_STAFF', eventScope)).toBe(true)
    expect(canDelegateAdminRole(eventManager, 'EVENT_MANAGER', eventScope)).toBe(false)
  })

  it('renders all seven roles with explicit scopes and keeps server calls behind the module gateway', () => {
    const pageRoot = path.resolve(import.meta.dirname, '../src/packages/admin/roles')
    const script = fs.readFileSync(path.join(pageRoot, 'index.ts'), 'utf8')
    const template = fs.readFileSync(path.join(pageRoot, 'index.wxml'), 'utf8')
    const roles = [
      'PLATFORM_OWNER',
      'PLATFORM_OPERATIONS',
      'PLATFORM_FINANCE',
      'BRANCH_ADMIN',
      'EVENT_OWNER',
      'EVENT_MANAGER',
      'EVENT_STAFF',
    ]
    for (const role of roles) {
      expect(template).toContain(`data-role="${role}"`)
    }
    expect(template).toContain('授权范围：{{item.scopeLabel}}')
    expect(script).toContain('mipAdminModule.governance.setRole')
    expect(script).not.toMatch(/wx\.cloud|wx\.request/)
  })

  it('records successful workspace entry on the server and displays it as an audit action', () => {
    const service = fs.readFileSync(
      path.resolve(import.meta.dirname, '../cloudfunctions/mip-admin-api/domain/service.js'),
      'utf8',
    )
    const auditPage = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/packages/admin/audit/index.ts'),
      'utf8',
    )
    expect(service).toContain('action: \'admin.session.enter\'')
    expect(service.indexOf('const counts = await repository.dashboard')).toBeLessThan(
      service.indexOf('action: \'admin.session.enter\''),
    )
    expect(auditPage).toContain('\'admin.session.enter\': \'进入运营管理\'')
  })
})
