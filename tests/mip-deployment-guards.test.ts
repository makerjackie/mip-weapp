import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertLegacyMemberSchemaInvocation,
  LEGACY_SCHEMA_CONFIRMATION,
  TEST_DATABASE_CONFIRMATION,
} from '../scripts/lib/legacy-member-schema-guard.mjs'
import {
  MIP_DEPLOYMENT_STAGES,
  resolveMipDeploymentStage,
} from '../scripts/lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP deployment safety guards', () => {
  it('keeps the legacy member schema runner disabled without both test-only confirmations', () => {
    expect(() => assertLegacyMemberSchemaInvocation([])).toThrow('disabled')
    expect(() => assertLegacyMemberSchemaInvocation([LEGACY_SCHEMA_CONFIRMATION]))
      .toThrow(TEST_DATABASE_CONFIRMATION)
    expect(() => assertLegacyMemberSchemaInvocation([TEST_DATABASE_CONFIRMATION]))
      .toThrow(LEGACY_SCHEMA_CONFIRMATION)
    expect(assertLegacyMemberSchemaInvocation([
      LEGACY_SCHEMA_CONFIRMATION,
      TEST_DATABASE_CONFIRMATION,
    ])).toEqual({ workflow: 'legacy-non-mip', testDatabaseConfirmed: true })
  })

  it('runs the legacy guard before loading local environment or calling CloudBase', () => {
    const source = read('scripts/apply-mysql-schema.mjs')
    const guard = source.indexOf('assertLegacyMemberSchemaInvocation(process.argv.slice(2))')
    const environment = source.indexOf('const env = loadCaseEnv(root)')

    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(environment)
  })

  it('accepts only known local deployment stages and separately confirms production', () => {
    for (const stage of MIP_DEPLOYMENT_STAGES.filter(value => value !== 'production')) {
      expect(resolveMipDeploymentStage(` ${stage.toUpperCase()} `)).toBe(stage)
    }
    expect(() => resolveMipDeploymentStage('')).toThrow('MIP_DEPLOYMENT_STAGE')
    expect(() => resolveMipDeploymentStage('preview')).toThrow('MIP_DEPLOYMENT_STAGE')
    expect(() => resolveMipDeploymentStage('production')).toThrow('--confirm-production')
    expect(resolveMipDeploymentStage('production', ['--confirm-production'])).toBe('production')
  })

  it('injects the validated local stage and documents the production confirmation', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    expect(deployment).toContain('resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE')
    expect(deployment).toContain('MIP_DEPLOYMENT_STAGE: options.deploymentStage')
    expect(deployment).not.toContain('MIP_DEPLOYMENT_STAGE: \'production\'')
    expect(deployment).toContain('function delay(milliseconds)')
    expect(deployment).not.toContain('const delay =')
    expect(deployment).toContain('persistLocalRuntimeConnection(connectionUri)')
    expect(deployment.indexOf('persistLocalRuntimeConnection(connectionUri)'))
      .toBeLessThan(deployment.indexOf('const stagingRoot ='))
    expect(deployment).toContain('managementResponseSummary(creation)')
    expect(deployment).toContain('existingRuntimeGrantsExact')

    for (const document of ['README.md', 'docs/CLOUDBASE.md', 'docs/DEPLOYMENT.md']) {
      expect(read(document), document).toContain('MIP_DEPLOYMENT_STAGE')
      expect(read(document), document).toContain('--confirm-production')
    }
  })

  it('keeps the active MIP operations skill on the isolated schema runner', () => {
    const skill = read('.agents/skills/mip-operations/SKILL.md')
    expect(skill).toContain('scripts/apply-mip-schema.mjs')
    expect(skill).not.toContain('scripts/apply-mysql-schema.mjs')
  })

  it('converges runtime grants only for the confirmed environment-scoped MIP account', () => {
    const source = read('scripts/converge-mip-runtime-grants.mjs')
    expect(source).toContain('--confirm-env=<exact CLOUDBASE_ENV_ID>')
    expect(source).toContain('--confirm-runtime-user=<exact environment-scoped user>')
    expect(source).toContain('runtimeUserForEnvironment(envId)')
    expect(source).toContain('assertRuntimeAccountClaimable')
    expect(source).toContain('assertRuntimePrivilegesExact')
    expect(source).toContain('buildRuntimeRevokeStatements')
    expect(source).toContain('buildRuntimeGrantStatements')
    expect(source).not.toContain('ALL PRIVILEGES')
  })
})
