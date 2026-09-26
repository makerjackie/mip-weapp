import { describe, expect, it } from 'vitest'
import { buildRuntimePrivilegeDeltaStatements, RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const rows = Object.entries(RUNTIME_TABLE_PRIVILEGES).flatMap(([tableName, privileges]) => privileges.map(privilegeType => ({ tableSchema: 'test', tableName, privilegeType })))
const account = '\'runtime\'@\'%\''
describe('runtime privilege convergence', () => {
  it('leaves all currently valid privileges untouched', () => {
    expect(buildRuntimePrivilegeDeltaStatements('test', account, rows)).toEqual([])
  })
  it('grants only the missing permission, without temporarily revoking readers', () => {
    const incomplete = rows.filter(row => row.tableName !== 'mip_profile_card_history' || row.privilegeType !== 'INSERT')
    expect(buildRuntimePrivilegeDeltaStatements('test', account, incomplete)).toEqual(['GRANT INSERT ON `test`.`mip_profile_card_history` TO \'runtime\'@\'%\''])
  })
  it('removes only excessive permissions and rejects foreign schema rows', () => {
    expect(buildRuntimePrivilegeDeltaStatements('test', account, [...rows, { tableSchema: 'test', tableName: 'mip_users', privilegeType: 'DELETE' }])).toEqual(['REVOKE DELETE ON `test`.`mip_users` FROM \'runtime\'@\'%\''])
    expect(() => buildRuntimePrivilegeDeltaStatements('test', account, [{ tableSchema: 'other', tableName: 'mip_users', privilegeType: 'SELECT' }])).toThrow()
  })
})
