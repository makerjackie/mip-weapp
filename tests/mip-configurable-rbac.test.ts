import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP configurable RBAC', () => {
  it('keeps role policy storage MIP-only and prevents changing the owner template', () => {
    const migration = fs.readFileSync(
      path.resolve(import.meta.dirname, '../database/mysql/mip/033_configurable_rbac.sql'),
      'utf8',
    )
    const rollback = fs.readFileSync(
      path.resolve(import.meta.dirname, '../database/mysql/mip/rollback/033_configurable_rbac.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_role_capability_policies')
    expect(migration).toContain('policy_mode ENUM(\'CUSTOM\', \'DEFAULT\')')
    expect(migration).not.toMatch(/role_key IN \([^)]*PLATFORM_OWNER/)
    expect(rollback.trim()).toBe('DROP TABLE IF EXISTS mip_role_capability_policies;')
  })

  it('uses roles.change for the dashboard entry and exposes owner policy controls through the module', () => {
    const dashboard = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/packages/admin/dashboard/index.ts'),
      'utf8',
    )
    const page = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/packages/admin/roles/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/packages/admin/roles/index.wxml'),
      'utf8',
    )
    expect(dashboard).toContain('canRoles: hasCapability(grants, \'roles.change\')')
    expect(page).toContain('mipAdminModule.listRoleCapabilityPolicies')
    expect(page).toContain('mipAdminModule.gateway.updateRoleCapabilityPolicy')
    expect(page).toContain('mipAdminModule.gateway.resetRoleCapabilityPolicy')
    expect(page).toContain('role.roleKey === \'PLATFORM_OWNER\'')
    expect(template).toContain('权限模板')
    expect(template).toContain('保存权限')
    expect(template).not.toMatch(/>\s*\{\{item\.key\}\}\s*</)
  })

  it('resets a custom policy through the existing mutation route and returns the default template', () => {
    const service = fs.readFileSync(
      path.resolve(import.meta.dirname, '../cloudfunctions/mip-admin-api/domain/service.js'),
      'utf8',
    )
    const repository = fs.readFileSync(
      path.resolve(import.meta.dirname, '../cloudfunctions/mip-admin-api/domain/role-capability-policies.js'),
      'utf8',
    )
    const gateway = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/modules/mip-admin/cloudbase-gateway.ts'),
      'utf8',
    )
    expect(repository).toContain('SET policy_mode = \'DEFAULT\'')
    expect(repository).not.toContain('DELETE FROM mip_role_capability_policies')
    expect(repository).toContain('AND version = ?')
    expect(service).toContain('\'admin.role_capability_policies.reset\'')
    expect(service).toContain('roleCapabilityPolicyView(roleKey, policy, \'DEFAULT\')')
    expect(gateway).toContain('call(\'mip.admin.rolePolicies.update\', { ...input, reset: true })')
  })
})
