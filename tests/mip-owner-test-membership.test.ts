import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIP_STABLE_SECRET_KEYS } from '../scripts/lib/mip-local-secrets.mjs'
import {
  assertDeployedOwnerTestMembership,
  ownerTestMembershipSummary,
  resolveOwnerTestMembershipCommand,
} from '../scripts/lib/mip-owner-test-membership.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const appId = 'wx0000000000000001'
const baseEnv = {
  CLOUDBASE_ENV_ID: 'test-environment',
  MINI_PROGRAM_APP_ID: appId,
  MIP_ALLOWED_APP_IDS: appId,
  MIP_DEPLOYMENT_STAGE: 'development',
  MIP_CATALOG_STAGE: 'TEST',
  MIP_PAYMENT_MODE: 'disabled',
}
const args = [
  '--operation=grant',
  '--plan-key=annual_test',
  '--confirm-owner',
  '--confirm-env=test-environment',
  `--confirm-app-id=${appId}`,
  '--confirm-ledger=mip-payment-ledger',
  '--confirm-catalog=TEST',
  '--confirm-test-membership=grant',
]

describe('Owner TEST membership operation command', () => {
  it('requires the exact environment, AppID, protected ledger, owner, TEST catalog, and operation confirmations', () => {
    const command = resolveOwnerTestMembershipCommand({
      args,
      env: baseEnv,
      functionName: 'mip-payment-ledger',
    })
    expect(command.action).toBe('grantOwnerTestMembership')
    expect(command.planKey).toBe('annual_test')
    for (const required of args.slice(2)) {
      expect(() => resolveOwnerTestMembershipCommand({
        args: args.filter(value => value !== required),
        env: baseEnv,
        functionName: 'mip-payment-ledger',
      })).toThrow(/requires exact/)
    }
  })

  it('allows staging only with explicit confirmation and fails closed for production, LIVE catalog, live payments, and AppID allowlist mismatch', () => {
    const stagingEnv = { ...baseEnv, CLOUDBASE_ENV_ID: 'staging-environment', MIP_DEPLOYMENT_STAGE: 'staging' }
    const stagingArgs = args.map(value => value.replaceAll('test-environment', 'staging-environment'))
    expect(() => resolveOwnerTestMembershipCommand({ args: stagingArgs, env: stagingEnv, functionName: 'mip-payment-ledger' })).toThrow(/staging requires/)
    const stagingCommand = resolveOwnerTestMembershipCommand({
      args: [...stagingArgs, '--confirm-staging-demo'],
      env: stagingEnv,
      functionName: 'mip-payment-ledger',
    })
    expect(stagingCommand.stagingConfirmed).toBe(true)
    for (const env of [
      { ...baseEnv, MIP_DEPLOYMENT_STAGE: 'production' },
      { ...baseEnv, MIP_CATALOG_STAGE: 'LIVE' },
      { ...baseEnv, MIP_PAYMENT_MODE: 'live' },
      { ...baseEnv, MIP_ALLOWED_APP_IDS: 'wx0000000000000002' },
    ]) {
      expect(() => resolveOwnerTestMembershipCommand({
        args,
        env,
        functionName: 'mip-payment-ledger',
      })).toThrow()
    }
  })

  it('requires the deployed function to repeat every local boundary and use a dedicated HMAC', () => {
    const command = resolveOwnerTestMembershipCommand({
      args,
      env: baseEnv,
      functionName: 'mip-payment-ledger',
    })
    const variables = {
      MIP_ALLOWED_APP_IDS: appId,
      MIP_DEPLOYMENT_STAGE: 'development',
      MIP_CATALOG_STAGE: 'TEST',
      MIP_PAYMENT_MODE: 'disabled',
      MIP_TEST_MEMBERSHIP_HMAC_SECRET: 's'.repeat(48),
    }
    expect(assertDeployedOwnerTestMembership(command, variables)).toHaveLength(48)
    const stagingCommand = resolveOwnerTestMembershipCommand({
      args: [...args.map(value => value.replaceAll('test-environment', 'staging-environment')), '--confirm-staging-demo'],
      env: { ...baseEnv, CLOUDBASE_ENV_ID: 'staging-environment', MIP_DEPLOYMENT_STAGE: 'staging' },
      functionName: 'mip-payment-ledger',
    })
    expect(assertDeployedOwnerTestMembership(stagingCommand, {
      ...variables,
      MIP_DEPLOYMENT_STAGE: 'staging',
    })).toHaveLength(48)
    for (const invalid of [
      { ...variables, MIP_ALLOWED_APP_IDS: 'wx0000000000000002' },
      { ...variables, MIP_DEPLOYMENT_STAGE: 'production' },
      { ...variables, MIP_CATALOG_STAGE: 'LIVE' },
      { ...variables, MIP_PAYMENT_MODE: 'live' },
      { ...variables, MIP_TEST_MEMBERSHIP_HMAC_SECRET: 'short' },
    ]) {
      expect(() => assertDeployedOwnerTestMembership(command, invalid)).toThrow(/not enabled/)
    }
  })

  it('returns only non-sensitive status and keeps all membership writes inside the protected ledger', () => {
    expect(ownerTestMembershipSummary('grant', {
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: true,
      idempotent: false,
      userId: 'must-not-leak',
      orderId: 'must-not-leak',
    })).toEqual({
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: true,
      idempotent: false,
    })
    const runner = read('scripts/manage-owner-test-membership.mjs')
    expect(runner).not.toContain('manageMysqlDatabase')
    expect(runner).not.toContain('mip_membership_entitlements')
    expect(runner).toContain('signInternalRequest(request, secret)')
    expect(runner).toContain('buildOwnerCandidateQuery')
    expect(runner).toContain('selectOwnerCandidateId')
    expect(runner).toContain('MIP_OWNER_PHONE')
    expect(read('package.json')).toContain('"membership:test": "node scripts/manage-owner-test-membership.mjs"')
  })

  it('deploys the dedicated HMAC only into an eligible ledger environment', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    const verification = read('scripts/verify-cloud.mjs')
    expect(MIP_STABLE_SECRET_KEYS).toContain('MIP_TEST_MEMBERSHIP_HMAC_SECRET')
    expect(deployment).toContain('[\'development\', \'test\', \'staging\'].includes(options.deploymentStage)')
    expect(deployment).toContain('options.catalogStage === \'TEST\'')
    expect(deployment).toContain('[\'disabled\', \'test\'].includes(options.paymentMode)')
    expect(deployment).toContain('MIP_TEST_MEMBERSHIP_HMAC_SECRET: options.secrets.testMembershipHmac')
    expect(deployment).toContain('Staging TEST membership maintenance requires')
    expect(deployment).toContain('configuredTestMembershipHmac.length < 32')
    expect(verification).toContain('[\'development\', \'test\', \'staging\'].includes(deploymentStage)')
    expect(verification).toContain('!/[\\r\\n]/.test(configuredSecret)')
  })
})
