import { describe, expect, it } from 'vitest'
import { exactAdminOrigin, resolveAdminLoginCallbacks } from '../scripts/lib/admin-login-target.mjs'

const callback = '/api/internal/auth/challenge/confirm'

describe('admin login deployment targets', () => {
  it.each([
    ['mip-admin-api', 'https://admin.mip.cool'],
    ['mip-t-admin-api', 'https://test.admin.mip.cool'],
  ])('keeps both callback namespaces on the selected %s backend', (name, origin) => {
    expect(resolveAdminLoginCallbacks({}, name)).toEqual({
      confirmUrl: origin + callback,
      migrationUrl: origin + callback,
    })
  })

  it('uses a configured gateway origin for both callbacks', () => {
    expect(resolveAdminLoginCallbacks({ MIP_ADMIN_WEB_CLOUDBASE_ORIGIN: 'https://admin.example.test/' }, 'mip-custom-admin')).toEqual({
      confirmUrl: `https://admin.example.test${callback}`,
      migrationUrl: `https://admin.example.test${callback}`,
    })
  })

  it('preserves explicitly configured legacy routing without choosing it by default', () => {
    expect(resolveAdminLoginCallbacks({
      MIP_ADMIN_WEB_LOGIN_CONFIRM_URL: `https://legacy.example.test${callback}`,
    }, 'mip-admin-api')).toEqual({
      confirmUrl: `https://legacy.example.test${callback}`,
      migrationUrl: `https://admin.mip.cool${callback}`,
    })
  })

  it('requires an explicit destination for an unrecognized backend', () => {
    expect(() => resolveAdminLoginCallbacks({}, 'mip-custom-admin')).toThrow(/MIP_ADMIN_WEB_LOGIN_CONFIRM_URL/)
  })

  it.each(['', 'http://admin.example.test', 'https://user:secret@admin.example.test', 'https://admin.example.test/api', 'https://admin.example.test?x=1', 'https://admin.example.test/#login'])('rejects an unsafe test or gateway origin: %s', (origin) => {
    expect(() => exactAdminOrigin(origin)).toThrow(/exact admin HTTPS origin/)
  })

  it('allows HTTP only for an explicitly selected local smoke server', () => {
    expect(exactAdminOrigin('http://127.0.0.1:8080', { allowLoopback: true })).toBe('http://127.0.0.1:8080')
    expect(() => exactAdminOrigin('http://admin.example.test', { allowLoopback: true })).toThrow()
  })

  it.each([`http://admin.example.test${callback}`, `https://user:secret@admin.example.test${callback}`, `https://admin.example.test${callback}#fragment`])('rejects an unsafe callback override', (url) => {
    expect(() => resolveAdminLoginCallbacks({ MIP_ADMIN_WEB_LOGIN_MIGRATION_URL: url }, 'mip-t-admin-api')).toThrow(/MIP_ADMIN_WEB_LOGIN_MIGRATION_URL/)
  })
})
