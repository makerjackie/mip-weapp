import { describe, expect, it } from 'vitest'
import {
  assertSupportedMySqlVersion,
  isSupportedMySqlVersion,
  parseMySqlVersion,
} from '../scripts/lib/mysql-version.mjs'

describe('MIP MySQL version gate', () => {
  it('rejects versions older than MySQL 8.0.22', () => {
    expect(isSupportedMySqlVersion('8.0.21')).toBe(false)
    expect(() => assertSupportedMySqlVersion('8.0.21')).toThrow('8.0.22')
  })

  it('accepts the minimum, CloudBase CynosDB, and newer MySQL versions', () => {
    expect(assertSupportedMySqlVersion('8.0.22')).toMatchObject({ major: 8, minor: 0, patch: 22 })
    expect(assertSupportedMySqlVersion('8.0.30-cynos-3.1.16.006')).toMatchObject({
      major: 8,
      minor: 0,
      patch: 30,
    })
    expect(assertSupportedMySqlVersion('8.4')).toMatchObject({ major: 8, minor: 4, patch: 0 })
  })

  it('fails closed for MariaDB, missing, and malformed versions', () => {
    for (const value of ['10.6.12-MariaDB', '', null, undefined, 'mysql-8.0.30', '8.0.22foo']) {
      expect(parseMySqlVersion(value)).toBeNull()
      expect(isSupportedMySqlVersion(value)).toBe(false)
      expect(() => assertSupportedMySqlVersion(value)).toThrow('8.0.22')
    }
  })
})
