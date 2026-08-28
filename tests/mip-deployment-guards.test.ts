import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MIP_DEPLOYMENT_STAGES,
  resolveMipDeploymentStage,
} from '../scripts/lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP deployment safety guards', () => {
  it('does not retain the Circle schema, cloud functions, assets, or runner', () => {
    for (const relativePath of [
      'assets/demo',
      'cloudfunctions/membership-api',
      'cloudfunctions/membership-admin-api',
      'database/mysql/001_member_schema.sql',
      'database/mysql/migrations.lock.json',
      'database/mysql/rollback',
      'scripts/apply-mysql-schema.mjs',
      'scripts/verify-mysql.mjs',
      'src/assets/brand/tongxinghui-logo.webp',
      'src/modules/admin',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false)
    }
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(packageJson.scripts?.['verify:mysql:legacy']).toBeUndefined()
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
    expect(deployment).toContain('mysqlConnectionInfo ||= callCloudbase(root, \'queryMysqlDatabase\', { action: \'getConnectionInfo\' })')
    expect(deployment).toContain('findString(mysqlConnectionInfo, [\'privatenetaddress\', \'private_net_address\'])')

    const cloudbaseHelper = read('scripts/lib/example-cloudbase.mjs')
    expect(cloudbaseHelper).toContain('\'EnvId\' in value || \'envId\' in value')
    expect(cloudbaseHelper).toContain('if (resolvedId !== envId)')

    for (const document of ['README.md', 'docs/CLOUDBASE.md', 'docs/DEPLOYMENT.md']) {
      expect(read(document), document).toContain('MIP_DEPLOYMENT_STAGE')
      expect(read(document), document).toContain('--confirm-production')
    }
  })

  it('limits a requested single-function deployment to one known core manifest entry', () => {
    const deployment = read('scripts/deploy-functions.mjs')

    expect(deployment).toContain('const requestedFunction = argumentValue(\'--only=\')')
    expect(deployment).toContain('manifest.filter(spec => spec.name === requestedFunction)')
    expect(deployment).toContain('deploymentManifest.length !== 1')
    expect(deployment).toContain('for (const spec of deploymentManifest)')
    expect(deployment).toContain('deploymentScope: requestedFunction ? \'single-function\' : \'all-core-functions\'')
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
    expect(read('scripts/lib/mysql-runtime-account-snapshot.mjs')).toContain('LIMIT $' + '{pageSize} OFFSET $' + '{offset}')
    expect(source).not.toContain('ALL PRIVILEGES')
  })
})
