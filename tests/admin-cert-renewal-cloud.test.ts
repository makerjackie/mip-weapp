import assert from 'node:assert/strict'
import { it } from 'vitest'
import { assertRenewalRoleEvidence, ensureRenewalLogs, ensureRenewalRole, renewalCloudConfig, renewalCron, renewalPolicy } from '../scripts/lib/admin-cert-renewal-cloud.mjs'
import { schedulerTrustPolicy } from '../scripts/lib/message-scheduler-cloud.mjs'

const config = renewalCloudConfig({ CLOUDBASE_ENV_ID: 'cloud1-example' }, {
  EnvId: 'cloud1-example',
  Region: 'ap-shanghai',
  UserInfo: { Uin: '12345678901', AppId: '1234567890' },
  Storages: [{ Bucket: 'private-1234567890', Region: 'ap-shanghai' }],
  StaticStorages: [{ Bucket: 'static-1234567890', Region: 'ap-shanghai' }],
  LogServices: [{ LogsetId: '00000000-0000-0000-0000-000000000001', TopicId: '00000000-0000-0000-0000-000000000002', Region: 'ap-shanghai' }],
}, 'admin.example.test', 'a'.repeat(64), 'b'.repeat(32))
it('CloudBase timer cron readback accepts the documented wrapper without ignoring extra fields', () => {
  assert.equal(renewalCron('{"cron":"0 17 3 * * * *"}'), '0 17 3 * * * *')
  assert.equal(renewalCron('0 17 3 * * * *'), '0 17 3 * * * *')
  assert.throws(() => renewalCron('{"cron":"0 17 3 * * * *","other":1}'), /Unexpected/)
})
it('renewal policy isolates state and verification objects; only free issuance is operation wide', () => {
  const statements = renewalPolicy(config).statement
  assert.deepEqual(statements.filter(item => item.resource.includes('*')).flatMap(item => item.action), ['ssl:ApplyCertificate'])
  assert.deepEqual(statements.find(item => item.action.includes('cos:GetObject')).resource, ['qcs::cos:ap-shanghai:uid/1234567890:private-1234567890/mip/operations/admin-cert-renewal/admin.example.test/state.json', 'qcs::cos:ap-shanghai:uid/1234567890:private-1234567890/mip/operations/admin-cert-renewal/admin.example.test/applications/*'])
  assert.deepEqual(statements.find(item => item.action.includes('tcb:ModifyHTTPServiceRoute')).resource, ['qcs::tcb:ap-shanghai:uin/12345678901:env/cloud1-example'])
  assert.ok(!JSON.stringify(statements).match(/Delete|Purchase|scf:|mysql|cdb:|cam:/))
  assert.deepEqual(statements.find(item => item.action.includes('cls:pushLog')).resource, ['qcs::cls:ap-shanghai:uin/12345678901:topic/00000000-0000-0000-0000-000000000002'])
  assert.ok(!JSON.stringify(statements).includes('SearchLog'))
})
it('test renewal has an independent role and cannot write production validation or state objects', () => {
  const testConfig = renewalCloudConfig({ CLOUDBASE_ENV_ID: config.envId }, {
    EnvId: config.envId,
    Region: config.region,
    UserInfo: { Uin: config.resourceUin, AppId: '1234567890' },
    Storages: [{ Bucket: config.stateBucket, Region: config.region }],
    StaticStorages: [{ Bucket: config.hostingBucket, Region: config.region }],
    LogServices: [{ LogsetId: config.logsetId, TopicId: config.logTopicId, Region: config.region }],
  }, 'test.admin.example.test', 'c'.repeat(64), 'd'.repeat(32))
  assert.equal(testConfig.roleName, 'MIPTestAdminCertRenewerRole')
  assert.equal(testConfig.policyName, 'MIPTestAdminCertRenewerPolicy')
  const resources = renewalPolicy(testConfig).statement.flatMap(item => item.resource)
  assert.ok(resources.some(value => value.endsWith('/mip-admin-console-test/.well-known/pki-validation/*')))
  assert.ok(resources.some(value => value.endsWith('/admin-cert-renewal/test.admin.example.test/state.json')))
  assert.ok(resources.every(value => !value.includes('/mip-admin-console/') && !value.includes('/admin-cert-renewal/admin.example.test/')))
})
it('log permission migration only upgrades the exact previously isolated policy with explicit scope', () => {
  let policy = renewalPolicy(config, { includeLogs: false })
  const writes: string[] = []
  const cloud = (action: string) => {
    if (action === 'GetRole') {
      return { RoleInfo: { RoleName: config.roleName, PolicyDocument: JSON.stringify(schedulerTrustPolicy()) } }
    }
    if (action === 'ListAttachedRolePolicies' || action === 'ListPolicies') {
      return { List: [{ PolicyId: 100, PolicyName: config.policyName }] }
    }
    if (action === 'GetPolicy') {
      return { PolicyDocument: JSON.stringify(policy) }
    }
    if (action === 'UpdatePolicy') {
      writes.push(action)
      policy = renewalPolicy(config)
      return {}
    }
    throw new Error('Unexpected mutation')
  }
  assert.throws(() => ensureRenewalRole(config, cloud), /drifted/)
  assert.deepEqual(writes, [])
  assert.deepEqual(ensureRenewalRole(config, cloud, { allowLogPermissions: true }), renewalPolicy(config))
  assert.deepEqual(writes, ['UpdatePolicy'])
})
it('application guard migration requires the exact prior policy and explicit scope', () => {
  let policy = renewalPolicy(config, { includeClaims: false })
  const cloud = (action: string) => {
    if (action === 'GetRole') {
      return { RoleInfo: { RoleName: config.roleName, PolicyDocument: JSON.stringify(schedulerTrustPolicy()) } }
    }
    if (action === 'ListAttachedRolePolicies' || action === 'ListPolicies') {
      return { List: [{ PolicyId: 100, PolicyName: config.policyName }] }
    }
    if (action === 'GetPolicy') {
      return { PolicyDocument: JSON.stringify(policy) }
    }
    if (action === 'UpdatePolicy') {
      policy = renewalPolicy(config)
      return {}
    }
    throw new Error('Unexpected mutation')
  }
  assert.throws(() => ensureRenewalRole(config, cloud), /drifted/)
  assert.deepEqual(ensureRenewalRole(config, cloud, { allowClaimPermissions: true }), renewalPolicy(config))
})
it('certificate detail permission replaces the exact prior read scope and refuses unrelated drift', () => {
  let policy = renewalPolicy(config, { includeCertificateDetail: false })
  let writes = 0
  const cloud = (action: string) => {
    if (action === 'GetRole') {
      return { RoleInfo: { RoleName: config.roleName, PolicyDocument: JSON.stringify(schedulerTrustPolicy()) } }
    }
    if (action === 'ListAttachedRolePolicies' || action === 'ListPolicies') {
      return { List: [{ PolicyId: 100, PolicyName: config.policyName }] }
    }
    if (action === 'GetPolicy') {
      return { PolicyDocument: JSON.stringify(policy) }
    }
    if (action === 'UpdatePolicy') {
      writes++
      policy = renewalPolicy(config)
      return {}
    }
    throw new Error('Unexpected mutation')
  }
  assert.throws(() => ensureRenewalRole(config, cloud), /drifted/)
  assert.equal(writes, 0)
  assert.deepEqual(ensureRenewalRole(config, cloud, { allowCertificateDetail: true }), renewalPolicy(config))
  assert.equal(writes, 1)
  policy = renewalPolicy(config, { includeCertificateDetail: false })
  policy.statement[0].action.push('ssl:DeleteCertificate')
  assert.throws(() => ensureRenewalRole(config, cloud, { allowCertificateDetail: true }), /drifted/)
  assert.equal(writes, 1)
})
it('existing role with other policies is preserved and rejected before any mutation', () => {
  const writes: string[] = []
  const cloud = (action: string) => {
    if (action === 'GetRole') {
      return { RoleInfo: { RoleName: config.roleName, PolicyDocument: JSON.stringify(schedulerTrustPolicy()) } }
    }
    if (action === 'ListAttachedRolePolicies') {
      return { List: [{ PolicyId: 100, PolicyName: 'UnrelatedPolicy' }] }
    }
    writes.push(action)
    throw new Error('Unexpected mutation')
  }
  assert.throws(() => ensureRenewalRole(config, cloud), /unrelated policies/)
  assert.deepEqual(writes, [])
})
it('a dedicated role with matching trust and policy is verified without writes', () => {
  const cloud = (action: string) => {
    if (action === 'GetRole') {
      return { RoleInfo: { RoleName: config.roleName, PolicyDocument: JSON.stringify(schedulerTrustPolicy()) } }
    }
    if (action === 'ListAttachedRolePolicies' || action === 'ListPolicies') {
      return { List: [{ PolicyId: 100, PolicyName: config.policyName }] }
    }
    if (action === 'GetPolicy') {
      return { PolicyDocument: JSON.stringify(renewalPolicy(config)) }
    }
    throw new Error('Unexpected mutation')
  }
  assert.deepEqual(ensureRenewalRole(config, cloud), renewalPolicy(config))
})
it('console fallback requires fresh exact trust, owner and a single matching policy', () => {
  const now = Date.now()
  const evidence = { source: 'TENCENT_CAM_CONSOLE', observedAt: new Date(now).toISOString(), roleName: config.roleName, roleId: '123456', resourceUin: config.resourceUin, trust: schedulerTrustPolicy(), policy: renewalPolicy(config), attachedPolicies: [{ policyName: config.policyName, policyId: 100 }] }
  assert.doesNotThrow(() => assertRenewalRoleEvidence(config, evidence, now))
  assert.throws(() => assertRenewalRoleEvidence(config, evidence, now + 31 * 60000), /readback/)
  assert.throws(() => assertRenewalRoleEvidence(config, { ...evidence, resourceUin: '999999999' }, now), /readback/)
  assert.throws(() => assertRenewalRoleEvidence(config, { ...evidence, attachedPolicies: [...evidence.attachedPolicies, { policyName: 'Other', policyId: 200 }] }, now), /readback/)
  assert.throws(() => assertRenewalRoleEvidence(config, { ...evidence, policy: { version: '2.0', statement: [] } }, now), /readback/)
})
it('dedicated log creation verifies the selected topic without rewriting existing resources', async () => {
  const topic = { TopicId: config.logTopicId, LogsetId: config.logsetId, TopicName: config.functionName, Period: 7, Status: true }
  const cloud = async (_service: string, action: string) => {
    if (action === 'DescribeLogsets') {
      return { Logsets: [
        { LogsetId: 'service-owned', LogsetName: 'mip-admin-cert-admin-example-test', AssumerName: 'TCB', AssumerUin: 10000 },
        { LogsetId: config.logsetId, LogsetName: 'mip-admin-cert-admin-example-test', AssumerName: '', AssumerUin: 0 },
      ] }
    }
    if (action === 'DescribeTopics') {
      return { Topics: [topic] }
    }
    throw new Error('Unexpected mutation')
  }
  const logs = await ensureRenewalLogs(config, cloud)
  assert.equal(logs.logTopicId, config.logTopicId)
  assert.equal(logs.period, 7)
})
it('rejects a service-owned topic even when its name and IDs match', async () => {
  const cloud = async (_service: string, action: string) => {
    if (action === 'DescribeLogsets') {
      return { Logsets: [{ LogsetId: config.logsetId, LogsetName: 'mip-admin-cert-admin-example-test' }] }
    }
    if (action === 'CreateTopic') {
      return { TopicId: config.logTopicId }
    }
    if (action === 'DescribeTopics') {
      return { Topics: [{ TopicId: config.logTopicId, LogsetId: config.logsetId, TopicName: config.functionName, Period: 7, Status: true, AssumerName: 'TCB', AssumerUin: 10000 }] }
    }
    throw new Error('Unexpected mutation')
  }
  await assert.rejects(ensureRenewalLogs(config, cloud), /readback failed/)
})
it('unexpected log retention is rejected before any write', async () => {
  const cloud = async (_service: string, action: string) => {
    if (action === 'DescribeLogsets') {
      return { Logsets: [{ LogsetId: config.logsetId, LogsetName: 'mip-admin-cert-admin-example-test' }] }
    }
    if (action === 'DescribeTopics') {
      return { Topics: [{ TopicId: config.logTopicId, LogsetId: config.logsetId, TopicName: config.functionName, Period: 30, Status: true }] }
    }
    throw new Error('Unexpected mutation')
  }
  await assert.rejects(ensureRenewalLogs(config, cloud), /drifted/)
})
