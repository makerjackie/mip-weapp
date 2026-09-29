import { describe, expect, it } from 'vitest'
import { roleTemplateBindingFlag } from '../scripts/lib/admin-role-template-deployment.mjs'

describe('admin role-template binding deployment gate', () => {
  it('keeps the deployed gate, starts closed, and allows an explicit controlled override', () => {
    expect(roleTemplateBindingFlag()).toBe('false')
    expect(roleTemplateBindingFlag({ existing: 'true' })).toBe('true')
    expect(roleTemplateBindingFlag({ configured: '', existing: 'true' })).toBe('true')
    expect(roleTemplateBindingFlag({ configured: 'false', existing: 'true' })).toBe('false')
    expect(roleTemplateBindingFlag({ configured: 'true', existing: 'false' })).toBe('true')
  })
  it('rejects an invalid explicit or deployed setting before any configuration update', () => {
    for (const values of [{ configured: '1', existing: 'true' }, { configured: 'yes' }, { existing: 'unknown' }]) {
      expect(() => roleTemplateBindingFlag(values)).toThrow('MIP_ADMIN_ROLE_TEMPLATES_ENABLED')
    }
  })
})
