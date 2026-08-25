import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertExistingFunctionAfterCode,
  assertExistingFunctionAfterConfiguration,
  assertScfRegion,
  existingFunctionCodeConverged,
  existingFunctionConfigurationConverged,
  functionConfigurationSnapshot,
  planExistingFunctionConfigurationUpdate,
} from '../scripts/lib/core-function-config-update.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    environment: {
      MIP_ALLOWED_APP_IDS: 'wx0000000000000000',
      MIP_DB_CONNECTION_URI: 'mysql://runtime:placeholder@private.example/mip',
    },
    handler: 'index.main',
    role: 'TCB_QcsRole',
    runtime: 'Nodejs20.19',
    subnetId: 'subnet-baseline',
    timeout: 60,
    vpcId: 'vpc-baseline',
    ...overrides,
  }
}

describe('existing core-function configuration updates', () => {
  it('sends the complete environment through the strict raw SCF allowlist', () => {
    const current = configuration()
    const expected = configuration({
      environment: {
        MIP_ALLOWED_APP_IDS: 'wx0000000000000000',
        MIP_DB_CONNECTION_URI: 'mysql://runtime:placeholder@private.example/mip',
        MIP_MESSAGE_SCHEDULER_FUNCTION_NAME: 'mip-message-scheduler',
      },
    })

    const plan = planExistingFunctionConfigurationUpdate({
      current,
      expected,
      functionName: 'mip-admin-api',
      namespace: 'mip-test-environment',
      region: 'ap-guangzhou',
    })

    expect(plan.configurationCall).toEqual({
      action: 'UpdateFunctionConfiguration',
      params: {
        Environment: {
          Variables: [
            { Key: 'MIP_ALLOWED_APP_IDS', Value: 'wx0000000000000000' },
            { Key: 'MIP_DB_CONNECTION_URI', Value: 'mysql://runtime:placeholder@private.example/mip' },
            { Key: 'MIP_MESSAGE_SCHEDULER_FUNCTION_NAME', Value: 'mip-message-scheduler' },
          ],
        },
        FunctionName: 'mip-admin-api',
        Namespace: 'mip-test-environment',
      },
      region: 'ap-guangzhou',
      service: 'scf',
    })
    expect(Object.keys(plan.configurationCall!.params).sort())
      .toEqual(['Environment', 'FunctionName', 'Namespace'])
    for (const forbidden of ['VpcConfig', 'Role', 'MemorySize', 'ClsLogsetId', 'ClsTopicId', 'Handler']) {
      expect(plan.configurationCall!.params).not.toHaveProperty(forbidden)
    }
  })

  it('adds Timeout only when it drifts and leaves Handler to the code update', () => {
    const current = configuration({ handler: 'legacy.main', timeout: 30 })
    const expected = configuration()
    const plan = planExistingFunctionConfigurationUpdate({
      current,
      expected,
      functionName: 'mip-events-api',
      namespace: 'mip-test-environment',
      region: 'ap-guangzhou',
    })

    expect(plan.configurationCall?.params.Timeout).toBe(60)
    expect(plan.configurationCall?.params).not.toHaveProperty('Handler')
    expect(plan.handlerChanged).toBe(true)
    expect(plan.timeoutChanged).toBe(true)
  })

  it('skips the raw configuration request when only Handler needs the code update', () => {
    const plan = planExistingFunctionConfigurationUpdate({
      current: configuration({ handler: 'legacy.main' }),
      expected: configuration(),
      functionName: 'mip-events-api',
      namespace: 'mip-test-environment',
      region: '',
    })

    expect(plan.configurationCall).toBeNull()
    expect(plan.handlerChanged).toBe(true)
  })

  it('requires a valid explicit SCF region before deployment writes', () => {
    expect(assertScfRegion('ap-guangzhou')).toBe('ap-guangzhou')
    expect(() => assertScfRegion('')).toThrow('SCF region is required')
    expect(() => assertScfRegion('guangzhou')).toThrow('SCF region is required')
  })

  it('fails closed before planning writes for runtime, VPC, subnet, or role drift', () => {
    const cases = [
      configuration({ runtime: 'Nodejs16.13' }),
      configuration({ vpcId: 'vpc-unexpected-sensitive-id' }),
      configuration({ subnetId: 'subnet-unexpected-sensitive-id' }),
      configuration({ role: 'unexpected-sensitive-role' }),
    ]
    for (const current of cases) {
      let message = ''
      try {
        planExistingFunctionConfigurationUpdate({
          current,
          expected: configuration(),
          functionName: 'mip-admin-api',
          namespace: 'mip-test-environment',
          region: 'ap-guangzhou',
        })
      }
      catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toMatch(/runtime drift|VPC configuration drift|execution role drift/)
      expect(message).not.toContain('vpc-unexpected-sensitive-id')
      expect(message).not.toContain('subnet-unexpected-sensitive-id')
      expect(message).not.toContain('unexpected-sensitive-role')
    }
  })

  it('rejects unreadable Handler and Timeout during preflight', () => {
    for (const current of [configuration({ handler: '' }), configuration({ timeout: Number.NaN })]) {
      expect(() => planExistingFunctionConfigurationUpdate({
        current,
        expected: configuration(),
        functionName: 'mip-admin-api',
        namespace: 'mip-test-environment',
        region: 'ap-guangzhou',
      })).toThrow('current Cloud Function configuration is invalid')
    }
  })

  it('proves network and role stability after configuration and code updates', () => {
    const before = configuration({ handler: 'legacy.main' })
    const expected = configuration()
    const configured = configuration({ handler: 'legacy.main' })

    expect(() => assertExistingFunctionAfterConfiguration({
      actual: configured,
      before,
      expected,
      functionName: 'mip-admin-api',
    })).not.toThrow()
    expect(() => assertExistingFunctionAfterCode({
      actual: expected,
      before,
      expected,
      functionName: 'mip-admin-api',
    })).not.toThrow()

    expect(() => assertExistingFunctionAfterConfiguration({
      actual: configuration({ handler: 'legacy.main', role: 'unexpected-role' }),
      before,
      expected,
      functionName: 'mip-admin-api',
    })).toThrow('execution role changed')
    expect(() => assertExistingFunctionAfterCode({
      actual: configuration({ subnetId: 'subnet-unexpected' }),
      before,
      expected,
      functionName: 'mip-admin-api',
    })).toThrow('VPC configuration changed')
  })

  it('treats stale safe readbacks as pending but rejects stability violations immediately', () => {
    const before = configuration({
      environment: { MIP_VERSION: 'before' },
      handler: 'legacy.main',
      timeout: 30,
    })
    const expected = configuration({
      environment: { MIP_VERSION: 'expected' },
      timeout: 60,
    })

    expect(existingFunctionConfigurationConverged({
      actual: before,
      before,
      expected,
      functionName: 'mip-admin-api',
    })).toBe(false)
    expect(existingFunctionCodeConverged({
      actual: configuration({
        environment: expected.environment,
        handler: 'legacy.main',
      }),
      before,
      expected,
      functionName: 'mip-admin-api',
    })).toBe(false)
    expect(() => existingFunctionConfigurationConverged({
      actual: configuration({
        environment: before.environment,
        handler: 'legacy.main',
        role: 'unexpected-role',
        timeout: 30,
      }),
      before,
      expected,
      functionName: 'mip-admin-api',
    })).toThrow('execution role changed')
  })

  it('normalizes GetFunction readback without exposing environment values in errors', () => {
    const snapshot = functionConfigurationSnapshot({
      Response: {
        Environment: {
          Variables: [
            { Key: 'MIP_SECOND', Value: 'second-value' },
            { Key: 'MIP_FIRST', Value: 'first-value' },
          ],
        },
        Handler: 'index.main',
        Role: 'TCB_QcsRole',
        Runtime: 'Nodejs20.19',
        Timeout: 60,
        VpcConfig: { SubnetId: 'subnet-baseline', VpcId: 'vpc-baseline' },
      },
    })
    expect(snapshot.environment).toEqual({ MIP_SECOND: 'second-value', MIP_FIRST: 'first-value' })

    let message = ''
    try {
      assertExistingFunctionAfterCode({
        actual: snapshot,
        before: configuration({ environment: snapshot.environment }),
        expected: configuration({ environment: { MIP_FIRST: 'different-sensitive-value' } }),
        functionName: 'mip-admin-api',
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('code readback did not converge')
    expect(message).not.toContain('second-value')
    expect(message).not.toContain('different-sensitive-value')
  })

  it('keeps the runtime order config, readback, code, readback and masks raw errors', () => {
    const source = read('scripts/deploy-functions.mjs')
    const configurationWrite = source.indexOf('updateExistingFunctionConfiguration(spec.name')
    const configurationReadback = source.indexOf('assertExistingFunctionAfterConfiguration({')
    const codeWrite = source.indexOf('action: \'updateFunctionCode\'')
    const codeReadback = source.indexOf('assertExistingFunctionAfterCode({')
    const configurationActive = source.indexOf('await waitForExistingFunctionConfiguration({', configurationWrite)
    const codeActive = source.indexOf('await waitForExistingFunctionCode({', codeWrite)
    const boundedWait = source.indexOf('async function waitForExistingFunctionConvergence')
    const stabilityCheck = source.indexOf('const readbackConverged = converged({', boundedWait)
    const activeCheck = source.indexOf('if (value?.Status === \'Active\'', boundedWait)

    expect(configurationWrite).toBeGreaterThan(0)
    expect(configurationWrite).toBeLessThan(configurationActive)
    expect(configurationActive).toBeLessThan(configurationReadback)
    expect(configurationReadback).toBeLessThan(codeWrite)
    expect(codeWrite).toBeLessThan(codeActive)
    expect(codeActive).toBeLessThan(codeReadback)
    expect(source.indexOf('preflightExistingFunction(spec.name'))
      .toBeLessThan(source.indexOf('removeOwnedLegacyTimer(spec.name'))
    expect(source.indexOf('assertScfRegion(scfRegion)'))
      .toBeLessThan(source.indexOf('removeOwnedLegacyTimer(spec.name'))
    expect(source.indexOf('assertScfRegion(scfRegion)'))
      .toBeLessThan(source.indexOf('runMysqlStatements(['))
    expect(boundedWait).toBeGreaterThan(codeReadback)
    expect(stabilityCheck).toBeLessThan(activeCheck)
    expect(source).toContain('...(existingUpdatePlan?.handlerChanged ? { handler: expectedConfiguration.handler } : {})')
    expect(source).toMatch(/function updateExistingFunctionConfiguration[\s\S]*catch \{[\s\S]*configuration update failed/)
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*configurationCall/)
    expect(source).toMatch(/if \(!currentDetail\) \{[\s\S]*action: 'createFunction'[\s\S]*vpc: \{ vpcId, subnetId \}/)
    expect(source.slice(boundedWait)).toMatch(/for \(let attempt = 0; attempt < 30; attempt \+= 1\)[\s\S]*readback did not converge/)
  })
})
