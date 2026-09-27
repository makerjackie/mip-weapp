import { createHash } from 'node:crypto'
/** Parallel CloudBase deployment. Does not change Cloudflare or production DNS. */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { environmentVariables, functionDetail } from './lib/ai-draft-provider-cloud.mjs'
import { assertFunctionSecurityRulesConverged, assertNoTimerTriggers, parseFunctionSecurityRules, updateMipFunctionInvocationRule } from './lib/cloud-function-safety.mjs'
import { parseMcpOutput, runMcporter } from './lib/cloudbase-mcp-runner.mjs'
import { assertExistingFunctionAfterCode, functionConfigurationSnapshot, planExistingFunctionConfigurationUpdate } from './lib/core-function-config-update.mjs'
import { bindAndRequireCloudbaseEnvironment, callCloudbase, loadCaseEnv } from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const name = 'mip-admin-web-api'
if (!env.CLOUDBASE_ENV_ID || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`) || !process.argv.includes(`--confirm-function=${name}`)) {
  throw new Error('Exact deployment confirmations required')
}
const artifact = path.join(root, '.tmp/admin-cloudbase-function')
if (!fs.existsSync(path.join(artifact, 'index.js'))) {
  throw new Error('Run admin cloudbase build first')
}
const targetEnvironment = bindAndRequireCloudbaseEnvironment(root, env.CLOUDBASE_ENV_ID)
function get(functionName) {
  const response = callCloudbase(root, 'callCloudApi', { service: 'scf', action: 'GetFunction', params: { FunctionName: functionName, Namespace: env.CLOUDBASE_ENV_ID, ShowCode: 'FALSE' } })
  if (response.success === false) {
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(response.message))) {
      throw new Error('Function not found')
    }
    throw new Error('Function read failed')
  }
  return normalizeFunctionDetail(response)
}
const admin = get('mip-admin-api')
const upstream = environmentVariables(admin)
const routes = callCloudbase(root, 'queryGateway', { action: 'listRoutes' }).data.routes
const api = routes.find(r => r.UpstreamResourceName === 'mip-admin-api' && r.DomainType === 'HTTPSERVICE' && r.IsDefault)
if (!api) {
  throw new Error('Existing default admin upstream route required')
}
const upstreamOrigin = `https://${api.Domain}`
const origin = env.MIP_ADMIN_WEB_CLOUDBASE_ORIGIN || upstreamOrigin
const targetUrl = new URL(origin)
if (targetUrl.origin !== origin || targetUrl.protocol !== 'https:') {
  throw new Error('Exact HTTPS admin origin required')
}
const targetDomain = targetUrl.hostname
const routePath = '/api'
if (origin !== upstreamOrigin) {
  throw new Error('Use the existing default HTTP gateway origin for this parallel deployment')
}
const staticPrefix = '/mip-admin-console'
const rootRoute = routes.find(r => r.Domain === targetDomain && r.Path === '/')
if (rootRoute && rootRoute.UpstreamResourceName !== name && !(rootRoute.UpstreamResourceType === 'STATIC_STORE' && rootRoute.PathRewrite?.StaticStorePrefix === staticPrefix)) {
  throw new Error('Gateway root belongs to another application')
}
const region = env.MIP_SCF_REGION || env.CLOUDBASE_REGION || targetEnvironment.Region || targetEnvironment.region || api.Domain.match(/\.([a-z]{2,12}-[a-z0-9-]+)\.app\.tcloudbase\.com$/)?.[1]
if (!region || !/^[a-z]+-[a-z0-9-]+$/.test(region)) {
  throw new Error('MIP_SCF_REGION is required')
}
const occupied = routes.find(r => r.Domain === targetDomain && r.Path === routePath && r.UpstreamResourceName !== name)
if (occupied) {
  throw new Error('Default gateway root is occupied; refuse to replace another service')
}
const user = `mipauth_${createHash('sha256').update(env.CLOUDBASE_ENV_ID).digest('hex').slice(0, 12)}`
if (env.MIP_ADMIN_AUTH_SCHEMA_OWNER !== `${env.CLOUDBASE_ENV_ID}:mip_admin_auth:${user}`) {
  throw new Error('Auth schema ownership missing')
}
if (!env.MIP_ADMIN_AUTH_DB_PASSWORD || !env.MIP_ADMIN_AUTH_SESSION_SECRET || env.MIP_ADMIN_AUTH_SESSION_SECRET.length < 32) {
  throw new Error('Auth database password and session secret required')
}
const uri = new URL(upstream.MIP_DB_CONNECTION_URI)
uri.username = user
uri.password = env.MIP_ADMIN_AUTH_DB_PASSWORD
uri.pathname = '/mip_admin_auth'
const variables = {
  MIP_ADMIN_AUTH_MYSQL_URI: uri.toString(),
  MIP_WEB_SESSION_SECRET: env.MIP_ADMIN_AUTH_SESSION_SECRET,
  MIP_ADMIN_UPSTREAM_URL: `${upstreamOrigin}${api.Path}`,
  MIP_ADMIN_UPSTREAM_HMAC_SECRET: upstream.MIP_ADMIN_WEB_BFF_HMAC_SECRET,
  MIP_ADMIN_WEB_LOGIN_HMAC_SECRET: upstream.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET,
  MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET: upstream.MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET,
  MIP_WEB_ALLOWED_APP_IDS: upstream.MIP_ALLOWED_APP_IDS,
  MIP_WEB_LOGIN_MINIPROGRAM_APP_ID: env.MINI_PROGRAM_APP_ID,
  MIP_WEB_ALLOWED_ORIGIN: origin,
  MIP_WEB_LOGIN_NAMESPACE: 'cloudbase',
  MIP_ADMIN_WEB_CODE_SHA256: createHash('sha256').update(fs.readFileSync(path.join(artifact, 'index.js'))).digest('hex'),
}
if (Object.values(variables).some(v => typeof v !== 'string' || !v)) {
  throw new Error('Required server configuration missing')
}
if (!admin.VpcConfig?.VpcId || !admin.VpcConfig.SubnetId) {
  throw new Error('Source MySQL VPC unavailable')
}
const staging = path.join(root, '.tmp/admin-cloudbase-deploy')
fs.mkdirSync(staging, { recursive: true })
fs.rmSync(path.join(staging, name), { recursive: true, force: true })
fs.cpSync(artifact, path.join(staging, name), { recursive: true })
const existing = callCloudbase(root, 'queryFunctions', { action: 'listFunctions', limit: 100 })
fs.writeFileSync(path.join(staging, 'inventory.private.json'), JSON.stringify(existing), { mode: 0o600 })
let prior = null
try {
  prior = get(name)
}
catch (error) {
  if (!/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
    throw new Error('Cannot determine existing function identity')
  }
}
let expected, before
if (prior) {
  before = functionConfigurationSnapshot(prior)
  expected = { ...before, environment: { ...before.environment, ...variables }, handler: 'index.main', runtime: 'Nodejs20.19', timeout: 70, vpcId: admin.VpcConfig.VpcId, subnetId: admin.VpcConfig.SubnetId }
  const plan = planExistingFunctionConfigurationUpdate({ current: before, expected, functionName: name, namespace: env.CLOUDBASE_ENV_ID, region })
  if (plan.handlerChanged) {
    throw new Error('Existing function handler mismatch; refusing implicit identity change')
  }
  assertNoTimerTriggers(name, callCloudbase(root, 'callCloudApi', { service: 'scf', action: 'ListTriggers', params: { FunctionName: name, Namespace: env.CLOUDBASE_ENV_ID, Limit: 100, Offset: 0 } }))
  if (plan.configurationCall) {
    management('callCloudApi', plan.configurationCall, 300000)
    await waitActive(detail => Object.entries(expected.environment).every(([k, v]) => environmentVariables(detail)[k] === v) && detail.Timeout === 70)
  }
}
else {
  management('manageFunctions', { action: 'createFunction', functionRootPath: staging, func: { name, type: 'Event', runtime: 'Nodejs20.19', handler: 'index.main', timeout: 70, memorySize: 256, envVariables: variables, vpc: { vpcId: admin.VpcConfig.VpcId, subnetId: admin.VpcConfig.SubnetId }, isWaitInstall: false } }, 300000)
  prior = await waitActive()
  before = functionConfigurationSnapshot(prior)
  expected = { ...before, environment: variables, handler: 'index.main', runtime: 'Nodejs20.19', timeout: 70, vpcId: admin.VpcConfig.VpcId, subnetId: admin.VpcConfig.SubnetId }
}
// Creation/configuration convergence is not code publication; always upload code.
management('manageFunctions', { action: 'updateFunctionCode', functionName: name, functionRootPath: staging, force: true }, 300000)
let deployed = await waitActive()
assertExistingFunctionAfterCode({ actual: functionConfigurationSnapshot(deployed), before, expected, functionName: name })
// BFF invokes the HTTPS admin endpoint; VPC alone does not provide Internet egress.
if (deployed.PublicNetConfig?.PublicNetStatus !== 'ENABLE') {
  management('callCloudApi', { service: 'scf', action: 'UpdateFunctionConfiguration', region, params: { FunctionName: name, Namespace: env.CLOUDBASE_ENV_ID, PublicNetConfig: { PublicNetStatus: 'ENABLE', EipConfig: { EipStatus: 'DISABLE' } } } }, 300000)
  deployed = await waitActive(detail => detail.PublicNetConfig?.PublicNetStatus === 'ENABLE')
  assertExistingFunctionAfterCode({ actual: functionConfigurationSnapshot(deployed), before, expected, functionName: name })
}
assertNoTimerTriggers(name, callCloudbase(root, 'callCloudApi', { service: 'scf', action: 'ListTriggers', params: { FunctionName: name, Namespace: env.CLOUDBASE_ENV_ID, Limit: 100, Offset: 0 } }))
const permissions = () => parseFunctionSecurityRules(callCloudbase(root, 'queryPermissions', { action: 'getResourcePermission', resourceType: 'function', resourceId: name })?.data?.permissions?.[0]?.SecurityRule)
const permissionBefore = permissions()
management('managePermissions', { action: 'updateResourcePermission', resourceType: 'function', resourceId: name, permission: 'CUSTOM', securityRule: JSON.stringify(updateMipFunctionInvocationRule(permissionBefore, name, false)) })
assertFunctionSecurityRulesConverged({ before: permissionBefore, after: permissions(), functionName: name, invoke: false })
const routeBefore = callCloudbase(root, 'queryGateway', { action: 'listRoutes' }).data.routes
if (routeBefore.some(r => r.Domain === targetDomain && r.Path === routePath && r.UpstreamResourceName !== name)) {
  throw new Error('Gateway root ownership changed; refusing update')
}
management('manageGateway', { action: routeBefore.some(r => r.Domain === targetDomain && r.Path === routePath) ? 'updateRoute' : 'createRoute', targetName: name, path: routePath, domain: targetDomain, upstreamResourceType: 'SCF', auth: false, enablePathTransmission: true })
const latestRoot = routeBefore.find(r => r.Domain === targetDomain && r.Path === '/')
if (latestRoot && latestRoot.UpstreamResourceName !== name && !(latestRoot.UpstreamResourceType === 'STATIC_STORE' && latestRoot.PathRewrite?.StaticStorePrefix === staticPrefix)) {
  throw new Error('Gateway root ownership changed during function deployment')
}
management('callCloudApi', { service: 'tcb', action: latestRoot ? 'ModifyHTTPServiceRoute' : 'CreateHTTPServiceRoute', params: { EnvId: env.CLOUDBASE_ENV_ID, Domain: { Domain: targetDomain, Routes: [{ Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'staticstore', PathRewrite: { StaticStorePrefix: staticPrefix }, EnablePathTransmission: false, EnableAuth: false, Enable: true }] } } })
const final = callCloudbase(root, 'queryGateway', { action: 'listRoutes' }).data.routes
if (!final.some(r => r.Domain === targetDomain && r.Path === routePath && r.UpstreamResourceName === name && r.UpstreamResourceType === 'SCF' && r.Enable && r.EnablePathTransmission && !r.EnableAuth)) {
  throw new Error('Gateway route readback failed')
}
for (const route of routeBefore.filter(r => !(r.Domain === targetDomain && (r.Path === routePath || r.Path === '/')))) {
  if (!final.some(r => r.Domain === route.Domain && r.Path === route.Path && r.UpstreamResourceName === route.UpstreamResourceName && r.Enable === route.Enable)) {
    throw new Error('Existing gateway route changed during deployment')
  }
}
if (!final.some(r => r.Domain === targetDomain && r.Path === '/' && r.UpstreamResourceType === 'STATIC_STORE' && r.PathRewrite?.StaticStorePrefix === staticPrefix && r.Enable && !r.EnableAuth)) {
  throw new Error('Static prefix route readback failed')
}
fs.writeFileSync(path.join(staging, 'target.private.json'), JSON.stringify({ origin, functionName: name }), { mode: 0o600 })
console.log(JSON.stringify({ functionName: name, active: true, clientInvocation: false, timers: 0, cloudflareUnchanged: true, privateTarget: path.relative(root, path.join(staging, 'target.private.json')) }))

async function waitActive(matches = () => true) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const detail = get(name)
    if (detail.Status === 'Active' && matches(detail)) {
      return detail
    }
    if (/failed|error/i.test(String(detail.Status))) {
      throw new Error('Function entered failed state')
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error('CloudBase function configuration did not converge')
}

function management(tool, args, timeout) {
  try {
    const raw = runMcporter(root, ['call', `cloudbase.${tool}`, '--args', JSON.stringify(args), '--output', 'json', '--timeout', String(timeout || 120000)], (timeout || 120000) + 5000)
    fs.writeFileSync(path.join(staging, `${tool}-${args.action}.raw.private.json`), raw, { mode: 0o600 })
    const result = parseMcpOutput(raw)
    fs.writeFileSync(path.join(staging, `${tool}-${args.action}.private.json`), JSON.stringify(result), { mode: 0o600 })
    if (result?.success === false || result?.isError || result?.Response?.Error) {
      throw new Error('Rejected')
    }
    return result
  }
  catch (error) {
    fs.writeFileSync(path.join(staging, `${tool}-${args.action}.error.private.txt`), String(error?.message || error), { mode: 0o600 })
    throw new Error(`CloudBase ${tool}/${args.action} failed; inspect private control-plane evidence without printing credentials`)
  }
}

function normalizeFunctionDetail(value) {
  const detail = functionDetail(value)
  const vpc = detail?.VpcConfig || {}
  return {
    ...detail,
    VpcConfig: {
      ...vpc,
      VpcId: vpc.VpcId || vpc.vpcId || vpc.vpc || '',
      SubnetId: vpc.SubnetId || vpc.subnetId || vpc.subnet || '',
    },
  }
}
