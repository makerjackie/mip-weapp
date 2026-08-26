#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { assertAdminOperationContractArtifact } from './lib/admin-operation-contract.mjs'
import { createMipCoreFunctionManifest } from './lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import {
  loadMipMigrationLock,
  MIP_MIGRATION_STEP_TABLE,
  MIP_MIGRATION_TRACKING_TABLE,
} from './lib/mip-migrations.mjs'
import { findLockingReadPrivilegeViolations } from './lib/mip-sql-isolation.mjs'
import { RUNTIME_TABLE_PRIVILEGES } from './lib/mysql-privilege-assert.mjs'
import {
  assertOfficialCustomTabBar,
  assertSemanticIconColors,
  assertValidTDesignIconNames,
} from './lib/ui-contracts.mjs'

const root = path.resolve(import.meta.dirname, '..')

assertAdminOperationContractArtifact(root)

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) {
    return []
  }
  const stat = fs.statSync(absolute)
  if (stat.isFile()) {
    return [relativePath]
  }
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') {
      return []
    }
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function sourceTree(relativePath, extension = /\.(?:js|ts)$/) {
  return sourceFiles(relativePath, extension)
    .map(read)
    .join('\n')
}

function sourceFiles(relativePath, extension = /\.(?:js|ts)$/) {
  return walk(relativePath)
    .filter(file => extension.test(file) && !file.includes(`${path.sep}tests${path.sep}`))
}

function legacySqlReference(source) {
  return /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|REFERENCES|INSERT\s+INTO|UPDATE|JOIN|FROM|DELETE\s+FROM)\s+`?((?:member|dating|sewing)_\w+)`?/i.exec(source)?.[1]
}

const packageJson = JSON.parse(read('package.json'))
const projectConfig = JSON.parse(read('project.config.json'))
const project = JSON.parse(read('config/project.json'))
const runtimeContract = JSON.parse(read('config/runtime-pages.json'))
const appJson = JSON.parse(read('src/app.json'))
const appCss = read('src/app.css')
const buildConfig = read('weapp-vite.config.ts')
const runtimeConfig = read('src/config/runtime.ts')
const tabConfig = read('src/config/tabs.ts')
const customTabBar = read('src/custom-tab-bar/index.wxml')
const customTabBarWxss = read('src/custom-tab-bar/index.wxss')
const customTabBarJson = JSON.parse(read('src/custom-tab-bar/index.json'))
const wxmlFiles = walk('src').filter(file => file.endsWith('.wxml'))
const allWxml = wxmlFiles.map(read).join('\n')
const pageScripts = [
  ...walk('src/pages'),
  ...walk('src/packages/member'),
  ...walk('src/packages/admin'),
].filter(file => /\.(?:js|ts)$/.test(file)).map(read).join('\n')
const clientSources = sourceTree('src')
const deviceAuthAction = ['start', 'auth'].join('_')
const scriptsWithDeviceAuth = walk('scripts')
  .filter(file => file.endsWith('.mjs') && file !== 'scripts/verify-source.mjs')
  .filter(file => read(file).includes(deviceAuthAction))

assert(Number(projectConfig.libVersion.replaceAll('.', '')) >= 3152, 'Mini Program base library must be >= 3.15.2')
for (const route of [
  'pages/index/index',
  'pages/membership/index',
  'pages/events/index',
  'pages/opportunities/index',
  'pages/profile/index',
]) {
  assert(appJson.pages.includes(route), `MIP main route is missing: ${route}`)
}
assert(appJson.subPackages.some(item => item.root === 'packages/member'), 'MIP member subpackage is missing')
assert(appJson.subPackages.some(item => item.root === 'packages/admin'), 'MIP admin subpackage is missing')
const declaredRoutes = [
  ...appJson.pages,
  ...appJson.subPackages.flatMap(item => item.pages.map(page => `${item.root}/${page}`)),
]
assert(project.routes.length === Number(runtimeContract.routeCount)
  && declaredRoutes.length === Number(runtimeContract.routeCount), 'MIP route declarations do not match the runtime contract count')
assert(new Set(project.routes.map(route => route.pathName)).size === declaredRoutes.length
  && declaredRoutes.every(route => project.routes.some(item => item.pathName === route)), 'Project and app route sets have drifted')
assert(buildConfig.includes('\'packages/member\'') && buildConfig.includes('\'packages/admin\''), 'Business subpackages are missing from the build configuration')
assert(buildConfig.includes('dependencies: [\'tdesign-miniprogram\']'), 'TDesign must be emitted for each business package')
assert(!/env\.MEMBERSHIP_[A-Z0-9_]+/.test(buildConfig), 'MIP build must not inherit legacy MEMBERSHIP_* configuration')
assert(runtimeConfig.includes('membershipFunctionName: __MIP_IDENTITY_FUNCTION_NAME__'), 'Legacy client compatibility must fail closed through the isolated MIP identity function')
assert(appCss.includes('@source "./**/*.{wxml,js,ts}"'), 'Tailwind v4 source glob is missing')
assert(!pageScripts.includes('wx.cloud.') && !pageScripts.includes('wx.requestPayment'), 'Pages must call domain modules instead of platform APIs')
assert(!/\bwx\.(?:saveFile|removeSavedFile)\b/.test(clientSources), 'Client source uses deprecated saved-file APIs')
assert(!/MIP_DB_CONNECTION_URI|MIP_LEDGER_SECRET|MIP_TEST_MEMBERSHIP_HMAC_SECRET|MIP_IDENTITY_PEPPER|MIP_MEDIA_SCOPE_SECRET|MIP_PHONE_ENCRYPTION_KEY/.test(clientSources), 'Server-only MIP configuration entered client source')
assert(packageJson.scripts['cloud:auth'] === 'node scripts/cloudbase-auth.mjs', 'cloud:auth must use the API-key-only entrypoint')
assert(packageJson.scripts['cloud:auth:device'] === 'node scripts/cloudbase-device-auth.mjs', 'Maintainer device authorization entrypoint is missing')
assert(scriptsWithDeviceAuth.length === 1 && scriptsWithDeviceAuth[0] === 'scripts/cloudbase-device-auth.mjs', 'Device authorization must exist only in the explicit maintainer emergency command')
assert(read('scripts/cloudbase-device-auth.mjs').includes('--allow-device-auth'), 'Device authorization must require the explicit maintainer approval flag')

assert(customTabBarJson.styleIsolation === 'isolated', 'Custom TabBar must isolate styles')
for (const icon of ['compass-filled', 'calendar-event-filled', 'work-filled', 'user-filled']) {
  assert(tabConfig.includes(`'${icon}'`), `MIP TabBar icon is missing: ${icon}`)
}
assertOfficialCustomTabBar(customTabBar, appJson, assert, 'MIP custom TabBar', { wxss: customTabBarWxss })
assert(allWxml.includes('<t-icon'), 'MIP UI must use bundled TDesign icons')
assert(!allWxml.includes('nav-chevron') && !/>\s*[›‹✓×＋]\s*</.test(allWxml), 'MIP UI must not use raw text glyphs as interface icons')
assert(!allWxml.includes('<t-loading'), 'Full-page loading must use stable skeletons')
assertValidTDesignIconNames({
  sources: [allWxml],
  declaredNames: [...tabConfig.matchAll(/icon(?:Active)?: '([a-z0-9-]+)'/g)].map(match => match[1]),
  repositoryRoot: root,
  assert,
  label: 'MIP source UI',
})
assertSemanticIconColors({ sources: [allWxml], assert, label: 'MIP source UI' })
for (const route of declaredRoutes.filter(item => item.startsWith('packages/member/') || item.startsWith('packages/admin/'))) {
  const file = `src/${route}.wxml`
  assert(read(file).includes('<app-page-exit'), `${file} must provide a stable way out of its subpackage page`)
}
assert(fs.existsSync(path.join(root, 'src/assets/brand/mip-logo-yellow.png')), 'MIP primary logo is missing')

const shellPresentation = read('src/modules/mip-shell/presentation.ts')
assert(shellPresentation.includes('kind === \'PLAYER\'')
  && shellPresentation.includes('entitlement?.status === \'ACTIVE\'')
  && shellPresentation.includes('label: \'嘉宾\''), '玩家/嘉宾 must derive from a server entitlement projection')
const cooperationCatalog = read('src/config/mip-catalogs.ts')
for (const roleName of ['皮条客', '生意佬', '暴发户', '狗策划', '死美工', '老保姆']) {
  assert(cooperationCatalog.includes(`name: '${roleName}'`), `Cooperation role is missing: ${roleName}`)
}
assert(cooperationCatalog.includes('replaceBeforeProduction: true'), 'Placeholder city and industry catalogs must be explicitly replaceable')

const functionNames = resolveMipFunctionNames({})
const coreManifest = createMipCoreFunctionManifest(functionNames)
assert(!coreManifest.some(item => [functionNames.scheduler, functionNames.knowledgeScheduler].includes(item.name)), 'Raw rolling schedulers must stay outside the ordinary CloudBase core manifest')
const lockingReadDynamicRelationAllowlist = Object.freeze({
  'cloudfunctions/mip-opportunities-api/domain/opportunities.js': {
    tableName: ['mip_opportunities', 'mip_cooperation_cards', 'mip_super_cases'],
  },
  'cloudfunctions/mip-admin-api/domain/knowledge.js': {
    table: [
      'mip_knowledge_sources',
      'mip_knowledge_categories',
      'mip_knowledge_contents',
      'mip_knowledge_products',
      'mip_content_comments',
      'mip_content_comment_reports',
    ],
  },
})
const lockingReadPrivilegeViolations = []
for (const spec of coreManifest) {
  const relativeRoot = path.join('cloudfunctions', spec.source)
  const packageDefinition = JSON.parse(read(path.join(relativeRoot, 'package.json')))
  const functionSourceFiles = sourceFiles(relativeRoot, /\.js$/)
  const source = functionSourceFiles.map(read).join('\n')
  assert(packageDefinition.name === spec.source, `${spec.source} package name drifted`)
  assert(!JSON.stringify(packageDefinition).includes('workspace:'), `${spec.source} cannot use workspace dependencies`)
  assert(!legacySqlReference(source), `${spec.source} references a shared legacy SQL table`)
  assert(!source.includes('process.env.MEMBERSHIP_'), `${spec.source} reads legacy MEMBERSHIP_* configuration`)
  assert(source.includes('MIP_DB_CONNECTION_URI'), `${spec.source} does not use the injected MIP MySQL connection`)
  assert(source.includes('MIP_ALLOWED_APP_IDS'), `${spec.source} does not fail closed on the MIP AppID allowlist`)
  assert(source.includes('persistence: \'cloudbase-mysql\'') && source.includes('SELECT 1 AS ok'), `${spec.source} health does not prove MySQL persistence`)
  for (const sourceFile of functionSourceFiles) {
    const normalizedSourceFile = sourceFile.split(path.sep).join('/')
    lockingReadPrivilegeViolations.push(...findLockingReadPrivilegeViolations(
      read(sourceFile),
      RUNTIME_TABLE_PRIVILEGES,
      { allowedDynamicRelations: lockingReadDynamicRelationAllowlist[normalizedSourceFile] },
    ).map(violation => ({ file: normalizedSourceFile, functionName: spec.name, ...violation })))
  }
}
assert(lockingReadPrivilegeViolations.length === 0, `Locking read exceeds runtime table grants: ${lockingReadPrivilegeViolations
  .map(item => `${item.functionName}:${item.file}:${item.relation}:${item.clause}`)
  .join(', ')}`)

const eventsSource = sourceTree('cloudfunctions/mip-events-api', /\.js$/)
const identitySource = sourceTree('cloudfunctions/mip-identity-api', /\.js$/)
const mediaSource = sourceTree('cloudfunctions/mip-media-api', /\.js$/)
const mediaConfig = JSON.parse(read('cloudfunctions/mip-media-api/config.json'))
const opportunitiesSource = sourceTree('cloudfunctions/mip-opportunities-api', /\.js$/)
const communitySource = sourceTree('cloudfunctions/mip-community-api', /\.js$/)
const communitySafetySource = read('cloudfunctions/mip-community-api/domain/service.js')
const commerceSource = sourceTree('cloudfunctions/mip-commerce-api', /\.js$/)
const ledgerSource = sourceTree('cloudfunctions/mip-payment-ledger', /\.js$/)
const paySource = sourceTree('cloudfunctions/mip-cloudpay', /\.js$/)
const callbackSource = sourceTree('cloudfunctions/mip-cloudpay-callback', /\.js$/)
const refundSource = sourceTree('cloudfunctions/mip-refund-worker', /\.js$/)
const adminSource = sourceTree('cloudfunctions/mip-admin-api', /\.js$/)
const adminIndex = read('cloudfunctions/mip-admin-api/index.js')
const messageDispatchRoute = read('cloudfunctions/mip-admin-api/lib/message-dispatch-route.js')
const internalDispatchIndex = adminIndex.indexOf('MESSAGE_DISPATCH_ACTIONS.has(event?.action)')
const userHandlerIndex = adminIndex.indexOf('handler(event)')
const growthSource = sourceTree('cloudfunctions/mip-growth-api', /\.js$/)
const notificationsSource = sourceTree('cloudfunctions/mip-notifications-api', /\.js$/)
const notificationSource = sourceTree('cloudfunctions/mip-notification-worker', /\.js$/)
const outboxSource = sourceTree('cloudfunctions/mip-outbox-worker', /\.js$/)
const aiSource = sourceTree('cloudfunctions/mip-ai-api', /\.js$/)

assert(eventsSource.includes('mip_event_registrations')
  && eventsSource.includes('mip_event_checkins')
  && eventsSource.includes('mip_event_hearts')
  && eventsSource.includes('mip_event_feedback'), 'MIP event lifecycle is incomplete')
assert(eventsSource.includes('mip_orders') && !eventsSource.includes('mip_event_orders'), 'Events must use the canonical MIP order ledger')
assert(mediaSource.includes('mip_media_assets')
  && mediaSource.includes('imgSecCheck')
  && mediaConfig.permissions?.openapi?.includes('security.imgSecCheck')
  && mediaSource.includes('MIP_MEDIA_SCOPE_SECRET')
  && mediaSource.includes('mip/' + '$' + '{stage}/' + '$' + '{appScope}/'), 'MIP image upload isolation or fail-closed safety is incomplete')
assert(opportunitiesSource.includes('mip_opportunities')
  && opportunitiesSource.includes('mip_cooperation_cards')
  && opportunitiesSource.includes('mip_super_cases'), 'Opportunity, cooperation card, and super case domains are incomplete')
assert(communitySource.includes('mip_user_blocks')
  && communitySource.includes('mip_reports')
  && communitySource.includes('SELF_TARGET')
  && !communitySafetySource.includes('mip_outbox_events'), 'Community safety isolation, self-protection, or no-notification boundary is incomplete')
assert(commerceSource.includes('mip_orders')
  && commerceSource.includes('REFUND_PENDING')
  && ledgerSource.includes('mip_membership_entitlements'), 'Membership commerce does not preserve server-side entitlement and refund facts')
assert(paySource.includes('cloudPay.unifiedOrder')
  && paySource.includes('callLedger(\'getPayableOrder\'')
  && paySource.includes('cloudPay.queryOrder')
  && paySource.includes('cloudPay.refund'), 'MIP CloudPay adapter must rebuild payment and refund requests through the ledger')
assert(callbackSource.includes('callLedger(\'applyPaymentCallback\'')
  && callbackSource.includes('callLedger(\'applyRefundCallback\'')
  && callbackSource.includes('errcode: -1'), 'CloudPay callback must persist before acknowledging and remain retryable')
assert(refundSource.includes('cloudPay.refund')
  && refundSource.includes('cloudPay.queryRefund')
  && refundSource.includes('getRefundRequestForProvider')
  && refundSource.includes('listPendingRefunds')
  && refundSource.includes('MIP_REFUND_WORKER_HMAC_SECRET')
  && refundSource.includes('timingSafeEqual'), 'Refund worker must use ledger facts, durable recovery, and internal authentication')
assert(ledgerSource.includes('mip_payment_callbacks')
  && ledgerSource.includes('MIP_LEDGER_SECRET')
  && ledgerSource.includes('timingSafeEqual'), 'Payment ledger internal authentication or callback idempotency is incomplete')
assert(adminSource.includes('PLATFORM_OWNER')
  && adminSource.includes('BRANCH_ADMIN')
  && adminSource.includes('EVENT_STAFF')
  && adminSource.includes('MIP_PHONE_ENCRYPTION_KEY')
  && adminSource.includes('mip/exports/'), 'Scoped admin RBAC, private phone access, or exports are incomplete')
assert(adminSource.includes('MIP_MESSAGE_DISPATCH_HMAC_SECRET')
  && adminSource.includes('runDueMessageCampaigns')
  && adminSource.includes('FOR UPDATE SKIP LOCKED')
  && adminSource.includes('MESSAGE_SCHEDULE_AUTH_REVOKED')
  && adminSource.includes('timingSafeEqual'), 'Scheduled message dispatch is not durably claimed or internally authenticated')
assert(internalDispatchIndex >= 0 && userHandlerIndex > internalDispatchIndex
  && messageDispatchRoute.includes('outboxWakeup.afterSuccessfulMutation')
  && !messageDispatchRoute.includes('data.completed > 0'), 'Internal message dispatch must run before user identity and always retry outbox wakeup')
assert(!/DELETE\s+FROM\s+mip_(?:users|orders|audit_logs|events|membership_entitlements)\b/i.test(adminSource), 'Admin API must not physically delete durable business facts')
assert(growthSource.includes('mip_growth_entries') && growthSource.includes('MIP_GROWTH_HMAC_SECRET'), 'Growth ledger is incomplete')
assert(notificationsSource.includes('mip_inbox_messages')
  && notificationsSource.includes('mip_notification_grants')
  && notificationsSource.includes('recordCustomerServiceInteraction')
  && notificationsSource.includes('recordSubscriptionDecision')
  && !notificationsSource.includes('publishMessage')
  && !notificationsSource.includes('runDeliveryBatch'), 'Client notification API boundary is incomplete')
assert(notificationSource.includes('mip_inbox_messages')
  && notificationSource.includes('subscribeMessage.send')
  && notificationSource.includes('customerServiceMessage.send')
  && notificationSource.includes('MIP_NOTIFICATION_HMAC_SECRET')
  && notificationSource.includes('MIP_NOTIFICATION_ENCRYPTION_KEY')
  && notificationSource.includes('MIP_SERVICE_ACCOUNT_ADAPTER_SECRET')
  && !notificationSource.includes('listInbox')
  && !notificationSource.includes('markRead')
  && !notificationSource.includes('recordSubscriptionDecision'), 'Protected notification delivery boundary is incomplete')
assert(outboxSource.includes('mip_outbox_events')
  && outboxSource.includes('FOR UPDATE SKIP LOCKED')
  && outboxSource.includes('MIP_OUTBOX_HMAC_SECRET')
  && outboxSource.includes('MIP_NOTIFICATION_HMAC_SECRET')
  && outboxSource.includes('MIP_GROWTH_HMAC_SECRET')
  && outboxSource.includes('status = \'CANCELLED\'')
  && outboxSource.includes('OUTBOX_EVENT_UNSUPPORTED'), 'Durable outbox consumption or internal projection is incomplete')
assert(aiSource.includes('mip_ai_drafts')
  && aiSource.includes('MIP_AI_HMAC_SECRET')
  && aiSource.includes('mip/')
  && !aiSource.includes('markConfirmed'), 'AI draft workflow, isolated storage, or confirmation boundary is incomplete')
assert(identitySource.includes('status = \'CONFIRMED\'')
  && identitySource.includes('confirmed_resource_type = \'PROFILE\'')
  && opportunitiesSource.includes('status = \'CONFIRMED\'')
  && opportunitiesSource.includes('FOR UPDATE'), 'Official resource saves must confirm AI drafts in their own MySQL transaction')

const commerceGateway = read('src/modules/mip-commerce/gateway.ts')
const commerceModule = read('src/modules/mip-commerce/module.ts')
assert(commerceGateway.includes('createPayment(orderId)')
  && commerceGateway.includes('payment(\'createPayment\', { orderId })')
  && !commerceGateway.includes('amountCents'), 'Payment client must submit only the trusted order identity')
assert(commerceModule.includes('return interpretClientPayment(requestResult, order)')
  && commerceModule.includes('gateway.reconcileOrder(order.id)'), 'Client payment acceptance must remain pending until server reconciliation')

const migrations = loadMipMigrationLock(root)
const nonRuntimeTables = new Set([
  MIP_MIGRATION_TRACKING_TABLE,
  MIP_MIGRATION_STEP_TABLE,
])
const lockedRuntimeTables = migrations.requiredTables.filter(table => !nonRuntimeTables.has(table)).sort()
const grantedRuntimeTables = Object.keys(RUNTIME_TABLE_PRIVILEGES).sort()
assert(JSON.stringify(lockedRuntimeTables) === JSON.stringify(grantedRuntimeTables), 'Migration lock and exact runtime grants must cover the same MIP tables')
const migrationSource = migrations.migrations.map(item => fs.readFileSync(item.sqlPath, 'utf8')).join('\n')
assert((migrationSource.match(/CREATE TABLE IF NOT EXISTS mip_orders\b/g) || []).length === 1, 'Canonical mip_orders must be created exactly once')
assert(!migrationSource.includes('mip_event_orders'), 'Split event order tables must not reappear')
assert(!legacySqlReference(migrationSource), 'MIP migration chain references a legacy shared table')

const cloudDeploy = read('scripts/deploy-functions.mjs')
const paymentDeploy = read('scripts/deploy-payment-function.mjs')
const refundRecovery = read('scripts/run-refunds.mjs')
const messageDispatchRecovery = read('scripts/run-message-campaigns.mjs')
const messageSchedulerRecovery = read('scripts/lib/message-scheduler-recovery.mjs')
const schedulerRoleSetup = read('scripts/configure-message-scheduler-role.mjs')
const schedulerDeploy = read('scripts/deploy-message-scheduler.mjs')
const schedulerVerify = read('scripts/verify-message-scheduler.mjs')
const schedulerCloudContract = read('scripts/lib/message-scheduler-cloud.mjs')
const localSecretContract = read('scripts/lib/mip-local-secrets.mjs')
const secretInit = read('scripts/init-mip-secrets.mjs')
const cloudVerify = read('scripts/verify-cloud.mjs')
const demoSeed = read('scripts/seed-demo.mjs')
const ownerBootstrap = read('scripts/bootstrap-owner.mjs')
const ownerTestMembership = read('scripts/manage-owner-test-membership.mjs')
const ownerTestMembershipContract = `${ownerTestMembership}\n${read('scripts/lib/mip-owner-test-membership.mjs')}`
const removedLegacyArtifacts = [
  'assets/demo',
  'cloudfunctions/membership-api',
  'cloudfunctions/membership-admin-api',
  'cloudfunctions/membership-cloudpay',
  'cloudfunctions/membership-cloudpay-callback',
  'cloudfunctions/membership-payment-ledger',
  'cloudfunctions/membership-notification-worker',
  'database/mysql/001_member_schema.sql',
  'database/mysql/migrations.lock.json',
  'database/mysql/rollback',
  'docs/component-map.md',
  'docs/page-specs.md',
  'scripts/apply-mysql-schema.mjs',
  'scripts/verify-mysql.mjs',
  'src/assets/brand/tongxinghui-logo.webp',
  'src/modules/admin',
]
for (const [label, source] of [
  ['core deploy', cloudDeploy],
  ['payment deploy', paymentDeploy],
  ['refund recovery', refundRecovery],
  ['message dispatch recovery', messageDispatchRecovery],
  ['message scheduler recovery', messageSchedulerRecovery],
  ['cloud verification', cloudVerify],
  ['demo seed', demoSeed],
  ['owner bootstrap', ownerBootstrap],
  ['owner test membership', ownerTestMembership],
]) {
  assert(!legacySqlReference(source), `${label} references a legacy shared SQL table`)
  assert(!/(?:^|[^A-Z0-9_])MEMBERSHIP_[A-Z0-9_]+/.test(source), `${label} reads legacy MEMBERSHIP_* configuration`)
}
assert(cloudDeploy.includes('createMipCoreFunctionManifest')
  && cloudDeploy.includes('buildRuntimeRevokeStatements')
  && cloudDeploy.includes('assertRuntimeAccountClaimable')
  && cloudDeploy.includes('--confirm-runtime-user=')
  && !cloudDeploy.includes('REVOKE ALL PRIVILEGES')
  && cloudDeploy.includes('assertRuntimePrivilegesExact')
  && cloudDeploy.includes('mip-notification-every-5m')
  && cloudDeploy.includes('mip-outbox-every-5m')
  && cloudDeploy.includes('--replace-legacy-runtime'), 'Core deploy must enforce direct sources, least privilege, and worker timer removal')
assert(cloudDeploy.includes('resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE')
  && cloudDeploy.includes('MIP_DEPLOYMENT_STAGE: options.deploymentStage')
  && !cloudDeploy.includes('MIP_DEPLOYMENT_STAGE: \'production\''), 'Core deploy must inject a validated local deployment stage')
for (const relativePath of removedLegacyArtifacts) {
  assert(!fs.existsSync(path.join(root, relativePath)), `Legacy Circle artifact must not remain in MIP: ${relativePath}`)
}
assert(!packageJson.scripts['verify:mysql:legacy'], 'MIP package scripts must not expose the removed legacy schema workflow')
assert(paymentDeploy.includes('--confirm-function=')
  && paymentDeploy.includes('--confirm-callback=')
  && paymentDeploy.includes('--confirm-refund=')
  && paymentDeploy.includes('MIP_LEDGER_SECRET')
  && paymentDeploy.includes('MIP_REFUND_WORKER_HMAC_SECRET')
  && paymentDeploy.includes('mip-refund-every-5m')
  && paymentDeploy.includes('disableClientInvocation'), 'Payment deploy confirmation or protected invocation contract is incomplete')
assert(refundRecovery.includes('--confirm-env=')
  && refundRecovery.includes('--confirm-refund=')
  && refundRecovery.includes('MIP_REFUND_WORKER_HMAC_SECRET')
  && refundRecovery.includes('action: \'runBatch\''), 'Refund recovery command must require exact environment confirmation and signed bounded dispatch')
assert(messageDispatchRecovery.includes('--confirm-env=')
  && messageDispatchRecovery.includes('--confirm-message-dispatch=')
  && messageDispatchRecovery.includes('--confirm-message-scheduler=')
  && messageDispatchRecovery.includes('MIP_MESSAGE_DISPATCH_HMAC_SECRET')
  && messageDispatchRecovery.includes('action: \'runDueMessageCampaigns\'')
  && messageDispatchRecovery.includes('reconcileMessageScheduler({')
  && messageSchedulerRecovery.includes('signSchedulerReconcile(request, secret)')
  && messageSchedulerRecovery.includes('result?.data?.verified !== true')
  && messageDispatchRecovery.includes('MIP_OUTBOX_HMAC_SECRET')
  && messageDispatchRecovery.includes('output.outboxWakeup === \'FAILED\''), 'Message scheduling recovery must require exact confirmation and controlled outbox wakeup')
assert([schedulerRoleSetup, schedulerDeploy, schedulerVerify]
  .every(source => source.includes('resolveSchedulerOperationsSpec(process.argv.slice(2))'))
  && schedulerDeploy.includes('assertRollingSchedulerEnvironmentContract(expectedEnvironment')
  && schedulerDeploy.includes('disableClientInvocation()')
  && schedulerDeploy.includes('invoke: false')
  && schedulerVerify.includes('rules?.[config.functionName]?.invoke !== false')
  && schedulerCloudContract.includes('KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC')
  && schedulerCloudContract.includes('Knowledge scheduling requires a role separate from the message scheduler')
  && localSecretContract.includes('assertMipSchedulerHmacSecretsIsolated(values)')
  && schedulerCloudContract.includes('assertMipSchedulerHmacSecretsIsolated(environment)')
  && secretInit.includes('assertMipSchedulerHmacSecretsIsolated(resolved.values)')
  && cloudDeploy.includes('assertMipSchedulerHmacSecretsIsolated(stableSecretValues)')
  && cloudVerify.includes('assertMipSchedulerHmacSecretsIsolated(variables)'), 'Knowledge scheduler operations must reuse the fail-closed raw SCF control plane with an isolated HMAC domain')
assert(cloudVerify.includes('assertRuntimePrivilegesExact')
  && !cloudVerify.includes('tableCounts'), 'Cloud verification must prove isolation without persisting business rows')
assert(demoSeed.includes('MIP_CATALOG_STAGE=TEST')
  && read('database/mysql/mip/seed.demo.json').includes('"replaceBeforeProduction": true'), 'Demo data must stay replaceable and TEST-only')
assert(ownerBootstrap.includes('\'PLATFORM_OWNER\'')
  && ownerBootstrap.includes('mip_audit_logs'), 'Owner bootstrap must create an audited MIP platform role')
assert(ownerTestMembershipContract.includes('--confirm-test-membership=')
  && ownerTestMembershipContract.includes('--confirm-app-id=')
  && ownerTestMembershipContract.includes('--confirm-ledger=')
  && ownerTestMembership.includes('signInternalRequest(request, secret)')
  && !ownerTestMembershipContract.includes('manageMysqlDatabase'), 'Owner TEST membership must use the protected ledger instead of direct SQL')

for (const [script, expected] of [
  ['database:setup', 'node scripts/apply-mip-schema.mjs'],
  ['cloud:deploy', 'node scripts/deploy-functions.mjs'],
  ['cloud:deploy-payment', 'node scripts/deploy-payment-function.mjs'],
  ['cloud:verify', 'node scripts/verify-cloud.mjs'],
  ['cloud:knowledge-scheduler:role', 'node scripts/configure-message-scheduler-role.mjs --scheduler-kind=knowledge'],
  ['cloud:knowledge-scheduler:deploy', 'node scripts/deploy-message-scheduler.mjs --scheduler-kind=knowledge'],
  ['cloud:knowledge-scheduler:verify', 'node scripts/verify-message-scheduler.mjs --scheduler-kind=knowledge'],
  ['outbox:run', 'node scripts/run-outbox.mjs'],
  ['message-campaigns:run-due', 'node scripts/run-message-campaigns.mjs'],
  ['refunds:run', 'node scripts/run-refunds.mjs'],
  ['membership:test', 'node scripts/manage-owner-test-membership.mjs'],
]) {
  assert(packageJson.scripts[script] === expected, `${script} does not use the isolated MIP workflow`)
}

console.log(`MIP source contract passed (${wxmlFiles.length} views, ${coreManifest.length} core functions, ${migrations.migrations.length} locked migrations)`)
