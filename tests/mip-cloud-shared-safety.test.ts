import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertFunctionSecurityRulesConverged,
  assertNoTimerTriggers,
  collectTimerTriggers,
  parseFunctionSecurityRules,
  updateMipFunctionInvocationRule,
} from '../scripts/lib/cloud-function-safety.mjs'
import { findUnsafeMipSqlRelations } from '../scripts/lib/mip-sql-isolation.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('shared CloudBase safety', () => {
  it('fails closed when the environment-level function rule cannot be read exactly', () => {
    expect(() => parseFunctionSecurityRules(undefined)).toThrow('unavailable')
    expect(() => parseFunctionSecurityRules('{')).toThrow('invalid')
    expect(() => parseFunctionSecurityRules(JSON.stringify({
      'another-project-api': { invoke: true },
    }))).toThrow('wildcard')
  })

  it('changes only the named MIP function rule and proves unrelated entries are unchanged', () => {
    const before = parseFunctionSecurityRules(JSON.stringify({
      '*': { invoke: 'auth != null' },
      'another-project-api': { invoke: false, metadata: { owner: 'other' } },
      'mip-outbox-worker': { invoke: false },
    }))
    const after = updateMipFunctionInvocationRule(
      before,
      'mip-identity-api',
      'auth.loginType != \'ANONYMOUS\' && auth != null',
    )

    expect(after['another-project-api']).toEqual(before['another-project-api'])
    expect(after['*']).toEqual(before['*'])
    expect(() => assertFunctionSecurityRulesConverged({
      before,
      after,
      functionName: 'mip-identity-api',
      invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null',
    })).not.toThrow()

    expect(() => assertFunctionSecurityRulesConverged({
      before,
      after: {
        ...after,
        'another-project-api': { invoke: true },
      },
      functionName: 'mip-identity-api',
      invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null',
    })).toThrow('unrelated shared entry')
  })

  it('rejects every timer trigger regardless of its name or nesting', () => {
    const response = {
      Response: {
        TotalCount: 2,
        Triggers: [
          { Type: 'timer', TriggerName: 'renamed-hourly-job' },
          { Type: 'cmq', TriggerName: 'queue-job' },
        ],
      },
    }
    expect(collectTimerTriggers(response)).toEqual([{ name: 'renamed-hourly-job' }])
    expect(() => assertNoTimerTriggers('mip-events-api', response)).toThrow('must not have timer')
    expect(() => assertNoTimerTriggers('mip-events-api', {
      Response: { TotalCount: 1, Triggers: [{ Type: 'cmq', TriggerName: 'queue-job' }] },
    })).not.toThrow()
    expect(() => assertNoTimerTriggers('mip-events-api', {})).toThrow('inventory is unavailable')
    expect(() => assertNoTimerTriggers('mip-events-api', {
      Response: { TotalCount: 2, Triggers: [{ Type: 'cmq', TriggerName: 'queue-job' }] },
    })).toThrow('inventory is incomplete')
  })

  it('allows only MIP and information_schema SQL relations by default', () => {
    const dynamicSql = ['const sql = `SELECT * FROM $', '{tableName}`'].join('')
    const safe = [
      'const sql = `SELECT * FROM mip_users`',
      'const sql = `SELECT * FROM information_schema.tables`',
    ]
    for (const source of safe) {
      expect(findUnsafeMipSqlRelations(source)).toEqual([])
    }
    expect(findUnsafeMipSqlRelations('const sql = `SELECT * FROM oimvp_users`'))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations('const sql = `SELECT * FROM shared.mip_users`'))
      .toEqual([{ kind: 'static', relation: 'shared.mip_users' }])
    expect(findUnsafeMipSqlRelations('const sql = `REPLACE INTO oimvp_users (id) VALUES (?)`'))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(dynamicSql))
      .toEqual([{ kind: 'dynamic', relation: 'tableName' }])
    expect(findUnsafeMipSqlRelations(dynamicSql, {
      allowedDynamicRelations: { tableName: ['mip_users', 'mip_profiles'] },
    })).toEqual([])
  })

  it('wires full timer checks, disabled-payment retirement, and fail-closed permission updates', () => {
    const coreDeploy = read('scripts/deploy-functions.mjs')
    const paymentDeploy = read('scripts/deploy-payment-function.mjs')
    const cloudVerify = read('scripts/verify-cloud.mjs')
    const isolation = read('scripts/mip-isolation-check.mjs')

    for (const source of [coreDeploy, paymentDeploy]) {
      expect(source).toContain('parseFunctionSecurityRules(text)')
      expect(source).toContain('assertFunctionSecurityRulesConverged')
      expect(source).toContain('assertNoFunctionTimers')
      expect(source).toContain('Limit: 100, Offset: 0')
      expect(source).not.toContain('rules = { \'*\':')
    }
    expect(coreDeploy).toMatch(/paymentMode === 'disabled'[\s\S]*disableClientInvocation\(functionName\)/)
    expect(coreDeploy.indexOf('paymentMode === \'disabled\''))
      .toBeLessThan(coreDeploy.indexOf('const requiredTables'))
    expect(coreDeploy).toContain('planExistingFunctionConfigurationUpdate({')
    expect(coreDeploy).toMatch(/configuration already current[\s\S]*action: 'updateFunctionCode'/)
    expect(coreDeploy).toContain('assertExistingFunctionAfterConfiguration({')
    expect(coreDeploy).toContain('assertExistingFunctionAfterCode({')
    expect(coreDeploy).toContain('assertFunctionConfigurationReadback(spec.name, expectedConfiguration, detail)')
    expect(cloudVerify).toMatch(/else \{[\s\S]*assertClientInvocationDisabled\(functionName\)[\s\S]*assertNoFunctionTimers\(functionName\)/)
    expect(cloudVerify).toContain('assertNoFunctionTimers(spec.name)')
    expect(isolation).toContain('findUnsafeMipSqlRelations')
  })
})
