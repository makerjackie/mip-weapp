import { createRequire } from 'node:module'
import { camPolicyDocument, camRoleInfo, canonicalJson, parsePolicyDocument, schedulerTrustPolicy } from './message-scheduler-cloud.mjs'

const require = createRequire(import.meta.url)
const { readConfig } = require('../../cloudfunctions/mip-admin-cert-renewer/renewal.js')

export function renewalCron(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Timer cron unavailable')
  }
  if (!value.startsWith('{')) {
    return value
  }
  const parsed = JSON.parse(value)
  if (Object.keys(parsed).length !== 1 || typeof parsed.cron !== 'string') {
    throw new Error('Unexpected timer description')
  }
  return parsed.cron
}

export function renewalCloudConfig(env, info, domain, secret, generation, logOverride) {
  const state = info.Storages?.[0]
  const hosting = info.StaticStorages?.[0]
  const log = logOverride || info.LogServices?.[0]
  const environment = {
    MIP_ADMIN_CERT_DOMAIN: domain,
    MIP_ADMIN_CERT_ENV_ID: env.CLOUDBASE_ENV_ID,
    MIP_ADMIN_CERT_REGION: info.Region,
    MIP_ADMIN_CERT_STATE_BUCKET: state?.Bucket,
    MIP_ADMIN_CERT_HOSTING_BUCKET: hosting?.Bucket,
    MIP_ADMIN_CERT_TRIGGER_SECRET: secret,
    MIP_ADMIN_CERT_GENERATION: generation,
  }
  const runtime = readConfig(environment)
  const resourceUin = String(info.UserInfo?.Uin || '')
  if (info.EnvId !== runtime.envId || state.Region !== runtime.region || hosting.Region !== runtime.region
    || !/^\d{5,20}$/.test(resourceUin) || String(info.UserInfo?.AppId) !== state.Bucket.split('-').at(-1)
    || log?.Region !== runtime.region || !/^[a-f0-9-]{36}$/.test(log?.TopicId || '') || !/^[a-f0-9-]{36}$/.test(log?.LogsetId || '')
    || (env.CLOUDBASE_RESOURCE_UIN && env.CLOUDBASE_RESOURCE_UIN !== resourceUin)) {
    throw new Error('Certificate renewal resource identity is invalid')
  }
  return { ...runtime, environment, resourceUin, logTopicId: log.TopicId, logsetId: log.LogsetId, roleName: 'MIPAdminCertRenewerRole', policyName: 'MIPAdminCertRenewerPolicy' }
}

export function renewalPolicy(config, { includeLogs = true, includeClaims = true, includeCertificateDetail = true } = {}) {
  const cosResource = (bucket, key) => `qcs::cos:${config.region}:uid/${bucket.split('-').at(-1)}:${bucket}/${key}`
  return {
    version: '2.0',
    statement: [
      { effect: 'allow', action: ['ssl:ApplyCertificate'], resource: ['*'] },
      { effect: 'allow', action: ['ssl:DescribeCertificate', ...(includeCertificateDetail ? ['ssl:DescribeCertificateDetail'] : []), 'ssl:CheckCertificateDomainVerification'], resource: [`qcs::ssl::uin/${config.resourceUin}:certificate/*`] },
      { effect: 'allow', action: ['tcb:DescribeHTTPServiceRoute', 'tcb:ModifyHTTPServiceRoute'], resource: [`qcs::tcb:${config.region}:uin/${config.resourceUin}:env/${config.envId}`] },
      { effect: 'allow', action: ['cos:GetObject', 'cos:PutObject'], resource: [cosResource(config.stateBucket, `mip/operations/admin-cert-renewal/${config.domain}/state.json`), ...(includeClaims ? [cosResource(config.stateBucket, `mip/operations/admin-cert-renewal/${config.domain}/applications/*`)] : [])] },
      { effect: 'allow', action: ['cos:PutObject'], resource: [cosResource(config.hostingBucket, `${config.staticPrefix}/.well-known/pki-validation/*`)] },
      ...(includeClaims ? [{ effect: 'allow', action: ['cos:GetBucketVersioning'], resource: [cosResource(config.stateBucket, '*')] }] : []),
      ...(includeLogs
        ? [
            { effect: 'allow', action: ['cls:DescribeTopics'], resource: [`qcs::cls:${config.region}:uin/${config.resourceUin}:topic/*`] },
            { effect: 'allow', action: ['cls:DescribeLogsets'], resource: [`qcs::cls:${config.region}:uin/${config.resourceUin}:logset/*`] },
            { effect: 'allow', action: ['cls:pushLog'], resource: [`qcs::cls:${config.region}:uin/${config.resourceUin}:topic/${config.logTopicId}`] },
          ]
        : []),
    ],
  }
}

// Console readback is a short-lived fallback when an environment API Key cannot
// read CAM. This evidence never creates or changes a role or its permissions.
export function assertRenewalRoleEvidence(config, evidence, now = Date.now()) {
  const age = now - Date.parse(evidence?.observedAt)
  if (evidence?.source !== 'TENCENT_CAM_CONSOLE' || !Number.isFinite(age) || age < 0 || age > 30 * 60000
    || evidence.roleName !== config.roleName || evidence.resourceUin !== config.resourceUin
    || !/^\d+$/.test(evidence.roleId || '')
    || canonicalJson(evidence.trust) !== canonicalJson(schedulerTrustPolicy())
    || evidence.attachedPolicies?.length !== 1 || evidence.attachedPolicies[0].policyName !== config.policyName
    || !Number.isSafeInteger(evidence.attachedPolicies[0].policyId)
    || canonicalJson(evidence.policy) !== canonicalJson(renewalPolicy(config))) {
    throw new Error('Recent exact CAM console readback required')
  }
}

export function ensureRenewalRole(config, callCam, { allowLogPermissions = false, allowClaimPermissions = false, allowCertificateDetail = false, previousLogTopicId } = {}) {
  const policy = renewalPolicy(config)
  const trust = schedulerTrustPolicy()
  let role
  try {
    role = camRoleInfo(callCam('GetRole', { RoleName: config.roleName }))
  }
  catch (error) {
    if (!/not found|not exist|resourcenotfound/i.test(error.message)) {
      throw error
    }
    callCam('CreateRole', { RoleName: config.roleName, PolicyDocument: JSON.stringify(trust), Description: 'MIP admin free certificate renewal runtime' })
    role = camRoleInfo(callCam('GetRole', { RoleName: config.roleName }))
  }
  if (role?.RoleName !== config.roleName || canonicalJson(parsePolicyDocument(role.PolicyDocument)) !== canonicalJson(trust)) {
    throw new Error('Dedicated certificate role trust drifted; nothing was overwritten')
  }
  const response = value => value?.Response || value?.data || value
  const attached = () => response(callCam('ListAttachedRolePolicies', { RoleName: config.roleName, Page: 1, Rp: 200 })).List || []
  if (attached().some(item => item.PolicyName !== config.policyName)) {
    throw new Error('Dedicated role has unrelated policies')
  }
  const find = () => {
    const list = response(callCam('ListPolicies', { Scope: 'Local', Keyword: config.policyName, Page: 1, Rp: 200 })).List
    if (!Array.isArray(list)) {
      throw new TypeError('Policy inventory unavailable')
    }
    const matches = list.filter(item => item.PolicyName === config.policyName)
    if (matches.length > 1) {
      throw new Error('Policy lookup ambiguous')
    }
    return matches[0]
  }
  let entry = find()
  if (!entry) {
    callCam('CreatePolicy', { PolicyName: config.policyName, PolicyDocument: JSON.stringify(policy), Description: 'Free SSL issuance, exact CloudBase environment and isolated COS objects only' })
    entry = find()
  }
  const policyId = Number(entry?.PolicyId)
  if (!Number.isSafeInteger(policyId)) {
    throw new TypeError('Dedicated certificate policy ID invalid')
  }
  let actual = camPolicyDocument(callCam('GetPolicy', { PolicyId: policyId }))
  const previousPolicy = previousLogTopicId && renewalPolicy({ ...config, logTopicId: previousLogTopicId })
  if ((allowCertificateDetail && canonicalJson(actual) === canonicalJson(renewalPolicy(config, { includeCertificateDetail: false })))
    || (allowClaimPermissions && canonicalJson(actual) === canonicalJson(renewalPolicy(config, { includeClaims: false })))
    || (allowLogPermissions && (canonicalJson(actual) === canonicalJson(renewalPolicy(config, { includeLogs: false }))
      || (previousPolicy && canonicalJson(actual) === canonicalJson(previousPolicy))))) {
    callCam('UpdatePolicy', { PolicyId: policyId, PolicyDocument: JSON.stringify(policy) })
    actual = camPolicyDocument(callCam('GetPolicy', { PolicyId: policyId }))
  }
  if (canonicalJson(actual) !== canonicalJson(policy)) {
    throw new Error('Dedicated certificate policy drifted; nothing was overwritten')
  }
  if (!attached().some(item => Number(item.PolicyId) === policyId)) {
    callCam('AttachRolePolicy', { AttachRoleName: config.roleName, PolicyId: policyId })
  }
  const result = attached()
  if (result.length !== 1 || Number(result[0].PolicyId) !== policyId) {
    throw new Error('Role attachment readback failed')
  }
  return policy
}

export async function ensureRenewalLogs(config, cloud) {
  const name = `mip-admin-cert-${config.domain.replaceAll('.', '-')}`
  const sets = await cloud('cls', 'DescribeLogsets', { Filters: [{ Key: 'logsetName', Values: [name] }], Limit: 100 })
  if (!Array.isArray(sets.Logsets)) {
    throw new TypeError('Dedicated log inventory unavailable')
  }
  const exactSets = sets.Logsets.filter(item => item.LogsetName === name)
  if (exactSets.length > 1) {
    throw new Error('Dedicated logset ambiguous')
  }
  const logsetId = exactSets[0]?.LogsetId || (await cloud('cls', 'CreateLogset', { LogsetName: name })).LogsetId
  if (!/^[a-f0-9-]{36}$/.test(logsetId || '')) {
    throw new Error('Dedicated logset ID invalid')
  }
  const topics = await cloud('cls', 'DescribeTopics', { Filters: [{ Key: 'logsetId', Values: [logsetId] }], Limit: 100 })
  if (!Array.isArray(topics.Topics)) {
    throw new TypeError('Dedicated topic inventory unavailable')
  }
  const matches = topics.Topics.filter(item => item.TopicName === config.functionName)
  if (matches.length > 1) {
    throw new Error('Dedicated log topic ambiguous')
  }
  if (matches[0] && (matches[0].Period !== 7 || !matches[0].Status || matches[0].LogsetId !== logsetId)) {
    throw new Error('Existing log topic drifted; nothing was overwritten')
  }
  const logTopicId = matches[0]?.TopicId || (await cloud('cls', 'CreateTopic', { LogsetId: logsetId, TopicName: config.functionName, PartitionCount: 1, AutoSplit: false, Period: 7, StorageType: 'hot', Describes: 'MIP admin certificate renewal only; no business data', BizType: 0 })).TopicId
  const actual = await cloud('cls', 'DescribeTopics', { Filters: [{ Key: 'topicId', Values: [logTopicId] }] })
  if (actual.Topics?.length !== 1 || actual.Topics[0].TopicId !== logTopicId || actual.Topics[0].LogsetId !== logsetId
    || actual.Topics[0].TopicName !== config.functionName || actual.Topics[0].Period !== 7 || !actual.Topics[0].Status) {
    throw new Error('Dedicated log topic readback failed')
  }
  return { domain: config.domain, envId: config.envId, region: config.region, resourceUin: config.resourceUin, logsetId, logTopicId, period: 7, observedAt: new Date().toISOString() }
}
