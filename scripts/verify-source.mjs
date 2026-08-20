#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { assertMembershipApiActivityDomainPackage } from './lib/membership-api-package.mjs'
import { loadVerifiedMigrations } from './lib/migrations.mjs'
import {
  assertSemanticIconColors,
  assertTabBarParity,
  assertValidTDesignIconNames,
} from './lib/ui-contracts.mjs'

const root = path.resolve(import.meta.dirname, '..')
const repositoryRoot = root

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) {
    return []
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

const packageJson = JSON.parse(read('package.json'))
const projectConfig = JSON.parse(read('project.config.json'))
const buildConfig = read('weapp-vite.config.ts')
const migrations = loadVerifiedMigrations(root)
const appJson = JSON.parse(read('src/app.json'))
const appCss = read('src/app.css')
const pages = walk('src/pages').filter(file => /\.(?:ts|wxml)$/.test(file)).map(read).join('\n')
const clientScripts = walk('src').filter(file => /\.(?:js|ts)$/.test(file)).map(read).join('\n')
const wxmlFiles = walk('src').filter(file => file.endsWith('.wxml'))
const allWxml = wxmlFiles.map(read).join('\n')
const membershipClient = read('src/modules/membership/cloudbase-gateway.ts')
const membershipModule = read('src/modules/membership/module.ts')
const queryCache = fs.readFileSync(path.join(root, 'src/shared/cache.ts'), 'utf8')
const appHome = read('src/pages/index/index.wxml')
const profileEdit = read('src/packages/member/profile-edit/index.wxml')
const accessPage = read('src/packages/member/access/index.wxml')
const customTabBar = read('src/custom-tab-bar/index.wxml')
const caseTabBar = read('src/components/case-tab-bar/index.wxml')
const membershipApi = read('cloudfunctions/membership-api/index.js')
const membershipAdminApi = read('cloudfunctions/membership-admin-api/index.js')
const membershipAdminWorkflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
const membershipWorkflows = read('cloudfunctions/membership-api/lib/workflows.js')
const paymentLedger = read('cloudfunctions/membership-payment-ledger/domain/ledger.js')
const paymentLedgerEntry = read('cloudfunctions/membership-payment-ledger/index.js')
const paymentFunction = read('cloudfunctions/membership-cloudpay/index.js')
const paymentDomain = read('cloudfunctions/membership-cloudpay/domain/payment.js')
const paymentCallback = read('cloudfunctions/membership-cloudpay-callback/index.js')
const paymentCallbackDomain = read('cloudfunctions/membership-cloudpay-callback/domain/callback.js')
const paymentLedgerClient = read('cloudfunctions/membership-cloudpay/lib/ledger-client.js')
const adminRbac = read('cloudfunctions/membership-admin-api/domain/rbac.js')
const notificationsDomain = read('cloudfunctions/membership-api/domain/notifications.js')
const notificationWorker = read('cloudfunctions/membership-notification-worker/domain/worker.js')
const notificationWorkerEntry = read('cloudfunctions/membership-notification-worker/index.js')
const subscriptionClient = read('src/modules/platform/subscription-messages.ts')
const operationalExceptions = read('cloudfunctions/membership-admin-api/domain/operational-exceptions.js')
const cloudDeploy = read('scripts/deploy-functions.mjs')
const paymentDeploy = read('scripts/deploy-payment-function.mjs')
const ownerBootstrap = read('scripts/bootstrap-owner.mjs')
const demoSeed = read('scripts/seed-demo.mjs')
const demoSql = read('database/mysql/seed.dev.sql')
const cloudVerify = read('scripts/verify-cloud.mjs')
const cloudbaseMcp = fs.readFileSync(path.join(root, 'scripts', 'lib', 'example-cloudbase.mjs'), 'utf8')
const safeBuild = fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8')
const runtimeVerifier = read('scripts/verify-runtime.mjs')
const mysqlSchema = read('database/mysql/001_member_schema.sql')
const dataContract = read('docs/data-contract.md')
const dataModel = read('docs/data-model.md')
const serverSources = walk('cloudfunctions')
  .filter(file => file.endsWith('.js'))
  .map(read)
  .join('\n')

assert(Number(projectConfig.libVersion.replaceAll('.', '')) >= 3152, 'Mini Program base library must be >= 3.15.2')
assert(appJson.pages.includes('pages/membership/index'), 'Membership checkout page is missing')
assert(appJson.pages.includes('pages/profile/index'), 'Profile page is missing')
assert(appJson.subPackages.some(item => item.root === 'packages/member'), 'Member detail subpackage is missing')
assert(appJson.subPackages.some(item => item.root === 'packages/admin'), 'Mobile admin subpackage is missing')
assert(
  buildConfig.includes('\'packages/member\'')
  && buildConfig.includes('\'packages/admin\'')
  && buildConfig.includes('dependencies: [\'tdesign-miniprogram\']'),
  'TDesign npm dependencies must be emitted in the business subpackage that uses them',
)
assert(appCss.includes('@source "./**/*.{wxml,js,ts}"'), 'Tailwind v4 source glob is missing')
assert(!pages.includes('wx.cloud.') && !pages.includes('wx.requestPayment'), 'Pages must use MembershipModule instead of platform APIs')
assert(!/\bwx\.(?:saveFile|removeSavedFile)\b/.test(clientScripts), 'Client source must use FileSystemManager or the CloudBase media resolver instead of deprecated saved-file APIs')
assert(membershipClient.includes('data: { action: \'createPayment\', orderId }'), 'Payment client must submit only action and orderId')
assert(!membershipClient.includes('amount:') && !membershipClient.includes('out_trade_no'), 'Client must not choose payment amount or merchant order number')
assert(membershipModule.includes('order.status === \'PAID\''), 'Client must wait for server PAID state')
assert(queryCache.includes('entry?.pending') && queryCache.includes('options.force') && queryCache.includes('invalidate(prefix'), 'Module cache must deduplicate, force refresh, and invalidate by prefix')
assert(membershipModule.includes('peekOverview') && membershipModule.includes('peekEvents'), 'Pages need cache-first module reads')
assert(!appHome.includes('open-type="getPhoneNumber"') && !appHome.includes('open-type="chooseAvatar"'), 'Public home must not request identity data on first entry')
assert(accessPage.includes('open-type="getPhoneNumber"') && profileEdit.includes('open-type="chooseAvatar"') && profileEdit.includes('type="nickname"'), 'Situational native identity flow is incomplete')
for (const icon of ['home-filled', 'usergroup-filled', 'calendar-event-filled', 'user-filled']) {
  assert(customTabBar.includes(`'${icon}'`), `Custom TabBar TDesign icon ${icon} is missing`)
}
assert(customTabBar.includes('--td-tab-bar-height: 84rpx') && customTabBar.includes('--td-font-body-extraSmall: 20rpx/28rpx'), 'Custom TabBar must preserve the compact TDesign scale')
assert(!customTabBar.includes('<image') && !customTabBar.includes('assets/tab'), 'Standard TabBar icons must not regress to custom raster assets')
assert(allWxml.includes('<t-icon'), 'Case UI must use the bundled TDesign icon component for standard interface symbols')
assert(!allWxml.includes('nav-chevron') && !/>\s*[›‹✓×＋]\s*</.test(allWxml), 'Case UI must not use raw text glyphs as interface icons')
assertValidTDesignIconNames({
  sources: [allWxml],
  repositoryRoot,
  assert,
  label: 'Membership source UI',
})
assertSemanticIconColors({ sources: [allWxml], assert, label: 'Membership source UI' })
assertTabBarParity(customTabBar, caseTabBar, assert, 'Membership primary TabBar')
assert(!allWxml.includes('<t-loading'), 'Full-page text loading must use stable skeletons instead')
const paymentIdentity = read('cloudfunctions/membership-cloudpay/lib/identity.js')
assert(
  paymentFunction.includes('cloud.getWXContext()')
  && paymentFunction.includes('resolveTrustedIdentity')
  && paymentIdentity.includes('FROM_OPENID')
  && paymentIdentity.includes('FROM_APPID')
  && paymentIdentity.includes('hasAnyFrom'),
  'Payment function must use platform-injected atomic identity',
)
assert(paymentDomain.includes('cloudPay.unifiedOrder') && paymentDomain.includes('callLedger(\'getPayableOrder\''), 'Native CloudPay checkout must rebuild the trusted order through the ledger')
assert(paymentDomain.includes('cloudPay.queryOrder') && !paymentDomain.includes('cloudPay.orderQuery'), 'Native CloudPay compensation must use the supported queryOrder method name')
assert(paymentDomain.includes('cloudPay.refund') && paymentDomain.includes('callLedger(\'getRefundRequest\''), 'Native CloudPay refund must rebuild the trusted full refund through the ledger')
assert(paymentDomain.includes('refund.amountCents !== refund.totalCents'), 'Case refund must remain full amount only')
assert(paymentCallbackDomain.includes('await callLedger(\'applyPaymentCallback\'') && paymentCallbackDomain.includes('await callLedger(\'applyRefundCallback\''), 'Payment callbacks must persist before acknowledging')
assert(paymentCallback.includes('errcode: -1') && paymentCallback.includes('errcode: 0'), 'Payment callback must return an explicit retryable protocol result')
assert(paymentLedger.includes('[\'owner\', \'manager\', \'support\']'), 'Refund ledger must enforce server-side admin roles')
assert(paymentDomain.includes('callLedger(\'getPayableOrder\'') && paymentLedger.includes('order.environment !== input.paymentMode'), 'Test and live product catalogs must be isolated server-side')
assert(membershipApi.includes('createMembershipOrder(db()'), 'Checkout must use the trusted MySQL transaction workflow')
assert(membershipWorkflows.includes('member_private_profiles') && membershipWorkflows.includes('throw new Error(\'PHONE_REQUIRED\')'), 'Checkout must require a server-verified private phone binding')
assert(membershipApi.includes('registerEvent') && membershipApi.includes('updateProfile'), 'Case core profile and event actions are missing')
assert(membershipApi.includes('listMembers') && membershipApi.includes('listEventFeed'), 'Member filters and event views must query on the server')
assert(membershipApi.includes('MEMBERSHIP_ALLOWED_APP_IDS') && membershipAdminApi.includes('MEMBERSHIP_ALLOWED_APP_IDS'), 'Every business function must reject unknown source AppIDs')
assert(membershipApi.includes('mediaMap(caller.appId') && membershipApi.includes('WHERE app_id = ?'), 'Media resolution must remain scoped to the trusted app identity')
assert(membershipApi.includes('requestAccountDeletion') && membershipApi.includes('listOrders'), 'Member account and history actions are missing')
assert(membershipAdminApi.includes('createRefund') && membershipAdminApi.includes('reviewProfile'), 'Mobile admin workflows are missing')
assert(
  membershipAdminApi.includes('EVENT_VERSION_CONFLICT')
  && membershipAdminApi.includes('EVENT_CAPACITY_BELOW_REGISTRATIONS')
  && membershipAdminApi.includes('EVENT_ELIGIBILITY_LOCKED')
  && membershipAdminApi.includes('EVENT_DATA_INTEGRITY')
  && membershipAdminApi.includes('expectedVersion')
  && membershipAdminWorkflows.includes('version = version + 1')
  && membershipAdminWorkflows.includes('assertEventPublishable')
  && membershipAdminWorkflows.includes('EVENT_ELIGIBILITY_LOCKED')
  && membershipAdminWorkflows.includes('kind = \'event-cover\'')
  && membershipAdminWorkflows.includes('venue_name')
  && membershipAdminWorkflows.includes('cancellation_policy')
  && membershipAdminWorkflows.includes('EVENT_CAPACITY_BELOW_REGISTRATIONS'),
  'Admin event authoring must persist full free-event fields with optimistic locking',
)
assert(
  membershipWorkflows.includes('status = \'CANCELLED\'')
  && membershipWorkflows.includes('cancelled_at = NULL')
  && membershipWorkflows.includes('cancelled_by_type = NULL')
  && membershipWorkflows.includes('cancellation_reason = NULL')
  && membershipApi.includes('registration.status')
  && membershipApi.includes('status: registration.status'),
  'Member registration must return real status and clear cancel metadata on reactivation',
)
assert(
  membershipAdminWorkflows.includes('async function cancelEvent')
  && membershipAdminWorkflows.includes('cancelled_by_type = \'EVENT\'')
  && membershipAdminWorkflows.includes('EVENT_CANCEL_REQUIRES_ACTION')
  && membershipAdminApi.includes('cancelEvent:')
  && membershipAdminApi.includes('INVALID_CANCELLATION_REASON')
  && membershipAdminApi.includes('EVENT_ALREADY_STARTED'),
  'Admin cancelEvent must converge REGISTERED rows in one audited transaction',
)
assert(
  membershipApi.includes('publicRegistrationHistory')
  && membershipApi.includes('cancelledByType')
  && membershipApi.includes('INNER JOIN member_events')
  && membershipWorkflows.includes('cancelled_by_type = \'MEMBER\''),
  'Member registration history must join events and expose cancel provenance without operator IDs',
)
const adminEventPage = read('src/packages/admin/events/index.wxml')
const adminEventScript = read('src/packages/admin/events/index.ts')
const adminTypes = read('src/modules/admin/types.ts')
const adminClient = read('src/modules/admin/client.ts')
const memberRegistrations = read('src/packages/member/registrations/index.ts')
const memberTicket = read('src/packages/member/ticket/index.ts')
const membershipAdminRoster = read('cloudfunctions/membership-admin-api/domain/roster.js')
const membershipAdminExportStorage = read('cloudfunctions/membership-admin-api/lib/export-storage.js')
const adminRosterPage = read('src/packages/admin/event-registrations/index.ts')
const adminRosterWxml = read('src/packages/admin/event-registrations/index.wxml')
assert(
  adminTypes.includes('activityType')
  && adminTypes.includes('registrationDeadline')
  && adminTypes.includes('cancellationPolicy')
  && adminTypes.includes('cancelEvent:')
  && adminTypes.includes('expectedVersion: number')
  && adminEventScript.includes('EVENT_VERSION_CONFLICT')
  && adminEventScript.includes('adminModule.cancelEvent')
  && adminEventScript.includes('if (this.data.conflict)')
  && adminEventScript.includes('refreshAfterConflict')
  && adminEventScript.includes('cancelConflict')
  && adminEventScript.includes('refreshAfterCancelConflict')
  && adminEventScript.includes('applyEventToForm(latest)')
  && adminEventScript.includes('await adminModule.setEventStatus(')
  && adminEventScript.includes('status as \'PUBLISHED\' | \'COMPLETED\'')
  && !adminEventScript.includes('setEventStatus(eventId, \'CANCELLED\')')
  && !/cancelEventVersion:\s*latest\.version/.test(adminEventScript)
  && adminEventPage.includes('公开免费')
  && adminEventPage.includes('会员包含')
  && adminEventPage.includes('独立付费')
  && adminEventPage.includes('报名价格（元）')
  && adminEventScript.includes('this.data.activityType === \'PAID\'')
  && membershipWorkflows.includes('async function createEventReservationOrder')
  && paymentLedger.includes('\'EVENT_PAYMENT_CONFIRMED\'')
  && adminEventPage.includes('刷新并载入最新版本')
  && adminEventPage.includes('取消原因（必填）')
  && adminEventPage.includes('refreshAfterCancelConflict')
  && adminEventPage.includes('box-border')
  && adminEventPage.includes('max-w-full')
  && adminClient.includes('membershipModule.invalidateEventCaches()')
  && memberRegistrations.includes('主办方已取消')
  && memberRegistrations.includes('你已取消')
  && memberTicket.includes('主办方已取消'),
  'Admin event editor must support free/paid activity types, trusted reservations, cancel dialog, conflict recovery, and native control sizing',
)
assert(
  membershipAdminApi.includes('listEventRegistrations')
  && membershipAdminApi.includes('checkInRegistration')
  && membershipAdminApi.includes('undoCheckIn')
  && membershipAdminApi.includes('createRosterExport')
  && membershipAdminApi.includes('downloadRosterExport')
  && membershipAdminWorkflows.includes('async function listEventRegistrations')
  && membershipAdminWorkflows.includes('async function checkInRegistration')
  && membershipAdminWorkflows.includes('async function undoCheckIn')
  && membershipAdminWorkflows.includes('async function createRosterExport')
  && membershipAdminWorkflows.includes('EVENT_ROSTER_EXPORTED')
  && membershipAdminWorkflows.includes('REGISTRATION_VERSION_CONFLICT')
  && membershipAdminWorkflows.includes('EXPORT_TOO_LARGE')
  && membershipAdminWorkflows.includes('member_export_tickets')
  && membershipAdminRoster.includes('maskTicketCode')
  && membershipAdminRoster.includes('escapeLikePattern')
  && membershipAdminRoster.includes('rosterCursorSignature')
  && membershipAdminExportStorage.includes('EXPORT_STORAGE_NOT_CONFIGURED')
  && membershipAdminExportStorage.includes('createMemoryExportStorage')
  && membershipAdminExportStorage.includes('createCloudBaseExportStorage')
  && adminTypes.includes('listEventRegistrations')
  && adminTypes.includes('ticketCodeMasked')
  && adminClient.includes('invalidateRosterCaches')
  && adminClient.includes('checkInRegistration')
  && adminRosterPage.includes('requestSeq')
  && adminRosterPage.includes('patchLocalItem')
  && adminRosterPage.includes('confirmationBusy')
  && adminRosterPage.includes('loadingMoreSeq')
  && adminRosterPage.includes('fileType: \'xlsx\'')
  && adminRosterPage.includes('canOverrideCheckIn')
  && !adminRosterPage.includes('phoneMasked')
  && !adminTypes.includes('phoneMasked')
  && !adminRosterWxml.includes('phoneMasked')
  && adminRosterWxml.includes('签到')
  && adminRosterWxml.includes('撤销签到')
  && adminRosterWxml.includes('导出名单（含手机号）')
  && adminRosterWxml.includes('box-border')
  && adminRosterWxml.includes('max-w-full')
  && appJson.subPackages.some(item =>
    item.root === 'packages/admin'
    && item.pages.includes('event-registrations/index'),
  )
  && membershipWorkflows.includes('ticket_code')
  && membershipWorkflows.includes('// Zero-write fact read')
  && membershipAdminWorkflows.includes('existing.starts_at')
  && membershipAdminWorkflows.includes('EVENT_ALREADY_STARTED')
  && membershipAdminRoster.includes('statusRank,registeredAtDesc,idDesc')
  && membershipApi.includes('ticketCodeMasked')
  && memberTicket.includes('ticketCodeMasked')
  && memberRegistrations.includes('已签到'),
  'Admin roster must support paginated list, check-in/undo, secure export, and masked ticket recovery',
)

// Phase 9 structural contracts: mutation retry isolation, CSV injection, audit rollback surfaces.
function extractSetLiteral(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  if (!match) {
    return []
  }
  return [...match[1].matchAll(/'([a-z]+)'/gi)].map(item => item[1])
}

function extractHandlerKeys(source) {
  const match = source.match(/const handlers = \{([\s\S]*?)\n\}/)
  if (!match) {
    return []
  }
  return [...match[1].matchAll(/^\s*([a-z]+)\s*:/gim)].map(item => item[1])
}

const adminGatewaySource = read('src/modules/admin/cloudbase-gateway.ts')
const memberGatewaySource = membershipClient
const adminRetryable = extractSetLiteral(adminGatewaySource, 'retryableReadActions')
const memberRetryable = extractSetLiteral(memberGatewaySource, 'retryableReadActions')
const adminHandlers = extractHandlerKeys(membershipAdminApi)
const mutationActions = [
  'saveEvent',
  'setEventStatus',
  'cancelEvent',
  'checkInRegistration',
  'undoCheckIn',
  'createRosterExport',
  'downloadRosterExport',
  'createRefund',
  'reviewProfile',
  'registerEvent',
  'cancelRegistration',
  'createCheckout',
  'updateProfile',
  'bindPhone',
]
for (const action of mutationActions) {
  assert(!adminRetryable.includes(action), `Admin gateway must not retry mutation ${action}`)
  assert(!memberRetryable.includes(action), `Membership gateway must not retry mutation ${action}`)
}
assert(
  adminGatewaySource.includes('retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }')
  && memberGatewaySource.includes('retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }'),
  'Gateway transport must use single-shot attempts for non-read actions',
)
assert(
  adminHandlers.includes('listEventRegistrations')
  && adminHandlers.includes('checkInRegistration')
  && adminHandlers.includes('undoCheckIn')
  && adminHandlers.includes('createRosterExport')
  && adminHandlers.includes('cancelEvent')
  && !adminHandlers.includes('createEventOrder')
  && !adminHandlers.includes('grantPaidRegistration'),
  'Admin handlers must expose free-activity roster mutations without paid-event grant actions',
)
assert(
  membershipAdminRoster.includes('CSV_FORMULA_RE')
  && membershipAdminRoster.includes('function escapeCsvCell')
  && membershipAdminRoster.includes('CSV_FORMULA_RE.test(text)')
  && membershipAdminRoster.includes('text = `')
  && membershipAdminRoster.includes('text.replace(/[\\r\\n\\t]+/g, \' \')')
  && membershipAdminRoster.includes('[=+'),
  'Roster CSV exporter must neutralize formula prefixes and control characters',
)
assert(
  membershipAdminWorkflows.includes('affectedRows !== 1')
  && membershipAdminWorkflows.includes('REGISTRATION_VERSION_CONFLICT')
  && membershipAdminWorkflows.includes('EVENT_VERSION_CONFLICT')
  && membershipAdminWorkflows.includes('INSERT INTO member_audit_logs')
  && membershipWorkflows.includes('affectedRows !== 1')
  && membershipWorkflows.includes('REGISTRATION_CONFLICT'),
  'Mutations must check affectedRows and write audits inside the same transaction boundary',
)
assert(
  (adminRosterPage.includes('if (this.data.processingId || this.data.undoing || this.data.exporting || this.confirmationBusy)')
    || adminRosterPage.includes('if (this.data.processingId || this.data.undoing || this.data.exporting)'))
  && adminRosterPage.includes('confirmationBusy')
  && adminEventScript.includes('if (this.data.saving)')
  && adminEventScript.includes('if (this.data.conflict)')
  && read('src/packages/member/registration-confirm/index.ts').includes('this.data.busy')
  && read('src/packages/member/ticket/index.ts').includes('this.data.busy'),
  'Mutation pages must gate double-submit with local busy/processing flags',
)
assert(
  fs.existsSync(path.join(root, 'cloudfunctions/membership-admin-api/tests/phase9-matrix.test.js'))
  && fs.existsSync(path.join(root, 'cloudfunctions/membership-api/tests/phase9-matrix.test.js'))
  && fs.existsSync(path.join(root, 'tests/phase9-client-matrix.test.ts')),
  'Phase 9 transaction/fault matrix tests must remain checked in',
)
assert(adminRbac.includes('assertCapability') && adminRbac.includes('ROLE_CAPABILITIES'), 'Admin RBAC contract is missing')
assert(!serverSources.includes('cloud.database()'), 'Membership business data must not fall back to legacy NoSQL')
assert(serverSources.includes('MEMBERSHIP_DB_CONNECTION_URI'), 'Server MySQL adapter must use an injected private connection URI')
assert(!pages.includes('MEMBERSHIP_DB_CONNECTION_URI'), 'Database credentials must never enter Mini Program pages')
assert(mysqlSchema.includes('ENGINE=InnoDB') && mysqlSchema.includes('member_entitlements'), 'MySQL schema must use InnoDB and an explicit entitlement table')
assert(membershipWorkflows.includes('db.transaction') && membershipWorkflows.includes('deleteMemberAccount'), 'Account deletion must be atomic at the database boundary')
const numberedMigrations = fs
  .readdirSync(path.join(root, 'database', 'mysql'))
  .filter(name => /^\d{3}_.+\.sql$/.test(name))
  .sort()
assert(
  migrations.length === numberedMigrations.length
  && migrations.some(item => item.name === 'member_mysql_schema')
  && migrations.some(item => item.name === 'activity_operations' && item.version === '20260723220000')
  && migrations.some(item => item.name === 'notifications_and_operations' && item.version === '20260725050000')
  && migrations.some(item => item.name === 'media_failure_tracking' && item.version === '20260725060000'),
  'The checked-in MySQL migration lock must cover every case migration',
)
assert(
  appJson.subPackages.some(item => item.root === 'packages/member' && item.pages.includes('notifications/index'))
  && appJson.subPackages.some(item => item.root === 'packages/admin' && item.pages.includes('exceptions/index')),
  'Notification inbox and operational exception center routes are missing',
)
assert(
  subscriptionClient.includes('wx.requestSubscribeMessage')
  && subscriptionClient.includes('.slice(0, 5)')
  && notificationsDomain.includes('recordSubscriptions')
  && notificationWorker.includes('consumed_at IS NULL'),
  'Subscription-message consent must be gesture-triggered, bounded, persisted, and consumable',
)
assert(
  notificationWorker.includes('member_notification_outbox')
  && notificationWorker.includes('lease_expires_at')
  && notificationWorker.includes('IN_APP_ONLY')
  && notificationWorker.includes('attempts < 3')
  && notificationWorkerEntry.includes('cloud.openapi.subscribeMessage.send'),
  'Notification delivery must use a durable bounded outbox with an in-app fallback',
)
assert(
  cloudDeploy.includes('isDuplicateTriggerError')
  && cloudDeploy.includes('相同的触发器已经存在')
  && cloudDeploy.includes('TriggerDesc: \'0 */5 * * * * *\''),
  'Notification timer deployment must update existing Chinese/English trigger responses with the raw cron contract',
)
assert(
  operationalExceptions.includes('member_refunds')
  && operationalExceptions.includes('member_media_cleanup_outbox')
  && operationalExceptions.includes('member_media_assets')
  && operationalExceptions.includes('member_notification_outbox')
  && operationalExceptions.includes('member_operational_failures')
  && membershipApi.includes('recordMediaFailure')
  && membershipApi.includes('cleanupUploadedOrphan')
  && membershipApi.includes('resolveDeleteFileResults'),
  'Operational exception center must aggregate refund, media, cleanup, review, and notification failures',
)
assert(
  dataModel.includes('venue_name')
  && dataModel.includes('ticket_code')
  && dataContract.includes('PUBLIC_FREE')
  && dataContract.includes('乐观锁'),
  'Data model/contract must describe activity fulfillment fields and optimistic locking',
)
assert(paymentLedger.includes('recomputeEntitlement') && paymentLedger.includes('status = \'REFUNDED\''), 'Refunds must recompute entitlements across all remaining paid orders')
assert(dataContract.includes('MySQL') && dataContract.includes('可信云函数边界'), 'Data contract must describe the trusted MySQL server boundary')
assert(dataModel.includes('MySQL 8') && !dataModel.includes('8 个集合'), 'Data model must stay aligned with MySQL migrations')
assert(paymentLedgerClient.includes('createHmac(\'sha256\'') && paymentLedgerEntry.includes('timingSafeEqual'), 'Internal payment ledger calls must be HMAC authenticated')
assert(paymentLedgerEntry.includes('signedFieldsByAction') && paymentLedgerEntry.includes('signedPayload(event)'), 'Ledger HMAC must canonicalize an action-specific business field allowlist')
assert(cloudDeploy.includes('--confirm-env=') && paymentDeploy.includes('--confirm-function=') && paymentDeploy.includes('--confirm-callback='), 'Cloud deploy scripts require exact target confirmation')
assert(!packageJson.dependencies?.['@01mvp/weapp-core'] && !JSON.stringify(packageJson).includes(['workspace', '*'].join(':')), 'Standalone template must not use workspace packages')
const leftoverWorkspaceYaml = ['pnpm', 'workspace.yaml'].join('-')
if (fs.existsSync(path.join(root, leftoverWorkspaceYaml))) {
  assert(!/^\s*packages\s*:/m.test(read(leftoverWorkspaceYaml)), 'Standalone template must not declare workspace packages')
}
assert(packageJson.scripts.build === 'node scripts/build.mjs' && packageJson.scripts['setup:local'] === 'node scripts/setup-local.mjs', 'Build and local-config automation must live in this repository')
assert(safeBuild.includes('fs.mkdtempSync') && safeBuild.includes('os.tmpdir()') && safeBuild.includes('synchronizeDirectory') && safeBuild.includes('--project-config') && safeBuild.includes('miniprogramRoot: absoluteStagingDir'), 'Full builds must stage outside the watched project through a temporary project config before synchronizing dist')
assert(fs.existsSync(path.join(root, 'src/shared/cache.ts')) && fs.existsSync(path.join(root, 'src/shared/retry.ts')), 'Cache/retry primitives must live in src/shared')
assert(!demoSeed.includes('支付联调') && !demoSeed.includes('开发环境真机验证') && !demoSql.includes('支付联调') && !demoSql.includes('开发环境真机验证'), 'Demo catalog copy must remain user-facing even in test payment mode')
assert(read('src/pages/explore/index.wxml').includes('member-discovery-list') && !read('src/pages/explore/index.wxml').includes('grid grid-cols-2'), 'Profile discovery must use a readable single-column list when cards contain metadata')
for (const signature of ['missing-app-json', 'missing-compiled-file', 'update-app-code-error', 'hot-reload-error']) {
  assert(runtimeVerifier.includes(`name: '${signature}'`), `Runtime verification must detect the ${signature} DevTools compiler failure`)
}
assert(ownerBootstrap.includes('is_demo = 0') && ownerBootstrap.includes('OpenID was not printed'), 'Owner bootstrap must reject demo identities and suppress OpenID')
for (const [name, artifactSource] of [
  ['cloud deploy', cloudDeploy],
  ['payment deploy', paymentDeploy],
  ['owner bootstrap', ownerBootstrap],
  ['demo seed', demoSeed],
  ['cloud verification', cloudVerify],
]) {
  const artifactBlock = artifactSource.slice(artifactSource.lastIndexOf('fs.writeFileSync'))
  assert(!/\benvId\b|\bappId\b|cloudFileId|profileId/.test(artifactBlock), `${name} artifact must not persist environment or identity values`)
}
assert(fs.existsSync(path.join(root, 'src/components/event-card/index.wxml')), 'Shared event card is missing')
for (const componentConfig of walk('src/components').filter(file => file.endsWith('.json'))) {
  assert(JSON.parse(read(componentConfig)).styleIsolation === 'apply-shared', `${componentConfig} must opt in to shared Tailwind styles`)
}
assert(!pages.match(/class="[^"]*\{\{/), 'Tailwind classes must remain complete static literals')
assert(!allWxml.match(/class="[^"]*\{\{/), 'All Tailwind classes must remain complete static literals')
assert(!/\b(?:Harness|Prompt|CloudBase|OpenID|AppID|RBAC|Mock)\b/i.test(allWxml), 'User-visible WXML must not expose internal implementation language')
assert(!allWxml.match(/\bspace-y-\S+/), 'WXML lists must use flex/grid gap; space-y child selectors are unreliable across custom-component hosts')
for (const wxmlFile of wxmlFiles) {
  const source = read(wxmlFile)
  const nativeControls = source.matchAll(/<(?:input|textarea)\b[^>]+>/g)
  for (const match of nativeControls) {
    const className = match[0].match(/class="([^"]+)"/)?.[1] || ''
    if (!className.split(/\s+/).includes('w-full')) {
      continue
    }
    assert(className.includes('box-border'), `${wxmlFile} full-width native controls must declare box-border explicitly`)
    assert(className.includes('max-w-full'), `${wxmlFile} full-width native controls must declare max-w-full explicitly`)
  }
}
const compactEventCard = read('src/components/event-card/index.wxml')
assert(compactEventCard.includes('class="flex h-[210rpx]') && compactEventCard.includes('class="h-[210rpx] w-[210rpx]'), 'Compact event cards need explicit native image/card dimensions')
const eventsPage = read('src/pages/events/index.wxml')
assert(eventsPage.includes('id="events-list"') && eventsPage.includes('event-list-item'), 'Event list spacing needs queryable wrapper nodes for runtime geometry checks')
for (const sourceFile of walk('src').filter(file => file.endsWith('.ts'))) {
  const source = read(sourceFile)
  if (!source.includes(`state: 'loading' as 'loading' | 'ready' | 'error'`)) {
    continue
  }
  const templateFile = sourceFile.replace(/\.ts$/, '.wxml')
  const template = read(templateFile)
  assert(template.includes(`state === 'loading'`) && template.includes(`state === 'error'`), `${templateFile} must render loading and error states`)
}
assert(fs.existsSync(path.join(root, '.mcp.json')), 'Case MCP config is missing')
assert(!JSON.parse(read('.mcp.json')).mcpServers?.cloudbase, 'Case editor config must not start a second CloudBase MCP')
assert(fs.existsSync(path.join(root, 'config', 'mcporter.json')), 'CloudBase MCP config is missing')
assert(!cloudbaseMcp.includes(`'..', '..', '.env.local'`), 'Case CloudBase automation must not inherit the root app identity')
assert(fs.existsSync(path.join(root, '.agents/skills/mip-membership-domain/SKILL.md')), 'Membership domain skill is missing')
assert(fs.existsSync(path.join(root, '.agents/skills/mip-operations/SKILL.md')), 'Operations skill is missing')
// CloudBase uploads only the function directory; pure domain must be package-local.
assertMembershipApiActivityDomainPackage({
  caseRoot: root,
  repositoryRoot,
  assert,
})

console.log('mip-weapp source contract passed')
