'use strict'

const cloud = require('wx-server-sdk')
const { createAdminApplication } = require('./domain/application')
const { createHandler, normalizeAdminRequest } = require('./domain/handler')
const { configuredAgreements, createFullAccessPolicy } = require('./domain/full-access')
const { createAdminRepository } = require('./domain/repository')
const { createAdminService } = require('./domain/service')
const { createTrustedPrincipalIssuer, resolveTrustedIdentity } = require('./lib/identity')
const { createWebBffRoute, isWebBffEvent } = require('./lib/web-bff-auth')
const { createWebBffReplayGuard } = require('./lib/web-bff-replay-guard')
const {
  isWebBffHttpEvent,
  parseWebBffHttpBody,
  webBffHttpError,
  webBffHttpResponse,
} = require('./lib/web-bff-http')
const { createWebLoginConfirmationClient } = require('./lib/web-login-client')
const { mysqlDatabase } = require('./lib/mysql')
const { createRefundWorkerClient } = require('./lib/refund-worker-client')
const { createCloudExportStorage } = require('./lib/export-storage')
const { createMatchingClient } = require('./lib/matching-client')
const { createTaskAdminClient } = require('./lib/task-admin-client')
const { createBannerAdminClient } = require('./lib/banner-admin-client')
const { createGameAdminClient } = require('./lib/game-admin-client')
const { createMediaAdminClient } = require('./lib/media-admin-client')
const { createOutboxWakeup, trustedContextAppId } = require('./lib/outbox-wakeup')
const {
  MESSAGE_DISPATCH_ACTIONS,
  verifyMessageDispatchRequest,
} = require('./lib/message-dispatch-auth')
const { createMessageDispatchRoute, normalizeDispatchRun } = require('./lib/message-dispatch-route')
const { createMessageSchedulerClient } = require('./lib/message-scheduler-client')
const {
  KNOWLEDGE_SCHEDULER_ACTIONS,
  verifyKnowledgeSchedulerRequest,
} = require('./lib/knowledge-scheduler-auth')
const { createKnowledgeSchedulerClient } = require('./lib/knowledge-scheduler-client')
const { createKnowledgeSchedulerRoute } = require('./lib/knowledge-scheduler-route')
const { createNotificationReconcileClient } = require('./lib/notification-reconcile-client')
const {
  messageScheduleMutationActions,
  outboxMutationActions,
  postCommitAutomationFor,
} = require('./lib/post-commit-automation')
const { createKnowledgeAdminService, configuredHosts, safeExternalUrl } = require('./domain/knowledge')
const {
  createKnowledgeSchedulingRepository,
} = require('./domain/knowledge-scheduling-repository')
const { createKnowledgeSchedulingService } = require('./domain/knowledge-scheduling-service')
const { checkCompleteContentSafety } = require('./lib/content-safety')
const { fetchPinnedHttpsText } = require('./lib/safe-http')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
const knowledgeSourceAllowedHosts = configuredHosts(process.env.MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS)
const knowledgeWebviewAllowedHosts = configuredHosts(process.env.MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS)
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-admin-api',
  logger: console,
})
const messageSchedulerClient = createMessageSchedulerClient({
  cloud,
  functionName: process.env.MIP_MESSAGE_SCHEDULER_FUNCTION_NAME || 'mip-message-scheduler',
  secret: process.env.MIP_MESSAGE_DISPATCH_HMAC_SECRET,
  sourceFunction: 'mip-admin-api',
  logger: console,
})
const knowledgeSchedulerClient = createKnowledgeSchedulerClient({
  cloud,
  functionName: process.env.MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME || 'mip-knowledge-scheduler',
  secret: process.env.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET,
  sourceFunction: 'mip-admin-api',
  logger: console,
})
const notificationReconcileClient = createNotificationReconcileClient({
  cloud,
  functionName: process.env.MIP_NOTIFICATION_FUNCTION_NAME || 'mip-notification-worker',
  secret: process.env.MIP_NOTIFICATION_HMAC_SECRET,
})
const webLoginConfirmationClient = createWebLoginConfirmationClient({
  endpoint: process.env.MIP_ADMIN_WEB_LOGIN_CONFIRM_URL,
  secret: process.env.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET,
})
async function contentSafety(draft, caller) {
  const checker = cloud.openapi?.security?.msgSecCheck
  return checkCompleteContentSafety(draft, caller, checker)
}

const fullAccessPolicy = createFullAccessPolicy({ agreements: configuredAgreements() })
const repository = createAdminRepository(mysqlDatabase(), { fullAccessPolicy })
const exportStorage = createCloudExportStorage(cloud)
const matchingClient = createMatchingClient({
  cloud,
  functionName: process.env.MIP_OPPORTUNITIES_FUNCTION_NAME || 'mip-opportunities-api',
  secret: process.env.MIP_MATCHING_INTERNAL_HMAC_SECRET,
})
const taskAdminClient = createTaskAdminClient({
  cloud,
  functionName: process.env.MIP_TASKS_FUNCTION_NAME || 'mip-tasks-api',
  secret: process.env.MIP_TASKS_ADMIN_HMAC_SECRET,
})
const bannerAdminClient = createBannerAdminClient({
  cloud,
  functionName: process.env.MIP_BANNERS_FUNCTION_NAME || 'mip-banners-api',
  secret: process.env.MIP_BANNERS_ADMIN_HMAC_SECRET,
})
const gameAdminClient = createGameAdminClient({
  cloud,
  functionName: process.env.MIP_GAME_FUNCTION_NAME || 'mip-game-api',
  secret: process.env.MIP_GAME_ADMIN_HMAC_SECRET,
})
const mediaAdminClient = createMediaAdminClient({
  cloud,
  functionName: process.env.MIP_MEDIA_FUNCTION_NAME || 'mip-media-api',
  secret: process.env.MIP_MEDIA_ADMIN_HMAC_SECRET,
})
let initializedRefundWorkerClient
function dispatchRefund(input) {
  initializedRefundWorkerClient ||= createRefundWorkerClient({
    cloud,
    functionName: process.env.MIP_REFUND_FUNCTION_NAME || 'mip-refund-worker',
    secret: process.env.MIP_REFUND_WORKER_HMAC_SECRET || '',
  })
  return initializedRefundWorkerClient.dispatchRefund(input)
}
function dispatchRefunds(input) {
  initializedRefundWorkerClient ||= createRefundWorkerClient({
    cloud,
    functionName: process.env.MIP_REFUND_FUNCTION_NAME || 'mip-refund-worker',
    secret: process.env.MIP_REFUND_WORKER_HMAC_SECRET || '',
  })
  return initializedRefundWorkerClient.dispatchRefunds(input)
}
const knowledgeModule = createKnowledgeAdminService(mysqlDatabase(), {
  catalogStage: process.env.MIP_CATALOG_STAGE,
  contentSafety,
  defaultTestPriceCents: process.env.MIP_KNOWLEDGE_TEST_PRICE_CENTS,
  fetchSource: fetchKnowledgeSource,
  fullAccessPolicy,
  sourceAllowedHosts: knowledgeSourceAllowedHosts,
  webviewAllowedHosts: knowledgeWebviewAllowedHosts,
})
const service = createAdminService({
  repository,
  phoneEncryptionKey: process.env.MIP_PHONE_ENCRYPTION_KEY,
  contentSafety,
  confirmWebLogin: input => webLoginConfirmationClient.confirm(input),
  dispatchRefund,
  dispatchRefunds,
  exportStorage,
  reconcileNotificationDelivery: input => notificationReconcileClient.reconcile(input),
  recalculateMatching: input => matchingClient.recalculate(input),
  tasksClient: taskAdminClient,
  bannersClient: bannerAdminClient,
  gameClient: gameAdminClient,
  knowledgeModule,
  mediaClient: mediaAdminClient,
  profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
  exportMaxRows: boundedInteger(process.env.MIP_EXPORT_MAX_ROWS, 5_000, 100, 20_000),
  exportMaxBytes: boundedInteger(process.env.MIP_EXPORT_MAX_BYTES, 8 * 1024 * 1024, 1_048_576, 10_485_760),
})
const knowledgeSchedulingRepository = createKnowledgeSchedulingRepository(mysqlDatabase())
const knowledgeSchedulingService = createKnowledgeSchedulingService({
  fetchSource: fetchKnowledgeSource,
  repository: knowledgeSchedulingRepository,
  webviewAllowedHosts: knowledgeWebviewAllowedHosts,
})

async function fetchKnowledgeSource(source) {
  if (!['JSON_FEED', 'RSS'].includes(source.source_type)) {
    throw new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
  }
  const endpoint = safeExternalUrl(source.endpoint_url, { allowedHosts: knowledgeSourceAllowedHosts })
  try {
    const body = await fetchPinnedHttpsText(endpoint, {
      accept: source.source_type === 'RSS'
        ? 'application/rss+xml, application/xml, text/xml'
        : 'application/json',
      allowedContentTypes: source.source_type === 'RSS'
        ? ['application/rss+xml', 'application/xml', 'text/xml']
        : ['application/json', 'application/feed+json'],
      maxBytes: 2_000_000,
      timeoutMs: 10_000,
    })
    return source.source_type === 'RSS'
      ? rssItems(body)
      : jsonFeedItems(body, source.fetch_config_json)
  }
  catch (error) {
    if (['KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE', 'KNOWLEDGE_SOURCE_RESPONSE_INVALID'].includes(error?.message)) {
      throw error
    }
    throw new Error('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
  }
}

function jsonFeedItems(body, configValue) {
  let parsed
  let config
  try {
    parsed = JSON.parse(body)
    config = typeof configValue === 'string' ? JSON.parse(configValue) : (configValue || {})
  }
  catch { throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID') }
  const path = typeof config.itemsPath === 'string' ? config.itemsPath.split('.') : []
  const items = path.reduce((value, key) => value?.[key], parsed)
  const rows = Array.isArray(items) ? items : Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : null
  if (!rows) throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
  return rows.slice(0, 50).map((item, index) => ({
    externalId: item.id || item.guid || item.url || `feed-${index}`,
    title: item.title || item.name,
    summary: item.summary || item.description || item.title,
    bodyText: item.content_text || item.content || item.description || item.summary,
    externalUrl: item.url || item.external_url,
    authorName: item.author?.name || item.author_name || item.author,
    publishedAt: item.date_published || item.published_at || item.pubDate,
    contentType: item.contentType || 'HOT_NEWS',
  }))
}

function rssItems(body) {
  const items = [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 50)
  if (!items.length) throw new Error('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
  return items.map((match, index) => {
    const item = match[1]
    const field = tag => decodeXml(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '')
    return {
      externalId: field('guid') || field('link') || `rss-${index}`,
      title: field('title'),
      summary: stripMarkup(field('description')),
      bodyText: stripMarkup(field('description')),
      externalUrl: field('link'),
      authorName: field('author'),
      publishedAt: field('pubDate'),
      contentType: 'HOT_NEWS',
    }
  })
}

function decodeXml(value) {
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim()
}

function stripMarkup(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value || fallback)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

const principalIssuer = createTrustedPrincipalIssuer({
  allowedAppIds,
  pepper: process.env.MIP_IDENTITY_PEPPER,
})
const application = createAdminApplication({
  service,
  assertPrincipal: principalIssuer.assert,
})
const handler = createHandler({
  application,
  getContext: () => cloud.getWXContext(),
  issuePrincipal: principalIssuer.issue,
})
const webBffRoute = createWebBffRoute({
  application,
  issuePrincipal: principalIssuer.issue,
  replayGuard: createWebBffReplayGuard({ database: mysqlDatabase() }),
  afterSuccessfulMutation: ({ action, principal, resultData }) => postCommitAdminMutation({
    appId: principal.appId,
    action,
    resultData,
  }),
  secret: process.env.MIP_ADMIN_WEB_BFF_HMAC_SECRET,
})
const runDueMessageCampaigns = createMessageDispatchRoute({
  allowedAppIds,
  logger: console,
  outboxWakeup,
  repository,
  secret: process.env.MIP_MESSAGE_DISPATCH_HMAC_SECRET,
})
const runDueKnowledgeIngestion = createKnowledgeSchedulerRoute({
  allowedAppIds,
  logger: console,
  secret: process.env.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET,
  service: knowledgeSchedulingService,
})
const knowledgeScheduleMutationActions = new Set([
  'mip.admin.knowledge.schedules.save',
])

exports.main = async (event = {}) => {
  if (isWebBffHttpEvent(event)) {
    try {
      const request = parseWebBffHttpBody(event)
      if (!isWebBffEvent(request)) throw new Error('HTTP_REQUEST_INVALID')
      return webBffHttpResponse(await webBffRoute(request))
    }
    catch (error) {
      return webBffHttpError(error)
    }
  }
  if (isWebBffEvent(event)) {
    return webBffRoute(event)
  }
  if (MESSAGE_DISPATCH_ACTIONS.has(event?.action)) {
    return runDueMessageCampaigns(event)
  }
  if (KNOWLEDGE_SCHEDULER_ACTIONS.has(event?.action)) {
    return runDueKnowledgeIngestion(event)
  }
  const result = await handler(event)
  if (result?.ok === true) {
    const routeAction = normalizeAdminRequest(event).action
    const routeAutomation = postCommitAutomationFor(routeAction, result.data)
    if (routeAutomation.requiresTrustedAppId || knowledgeScheduleMutationActions.has(routeAction)) {
      const postCommit = await postCommitAdminMutation({
        appId: trustedContextAppId(cloud.getWXContext(), allowedAppIds),
        action: routeAction,
        resultData: result.data,
      })
      if (postCommit) return postCommit
    }
  }
  return result
}

async function postCommitAdminMutation({ appId, action, resultData }) {
  const routeAutomation = postCommitAutomationFor(action, resultData)
  if (knowledgeScheduleMutationActions.has(action)) {
    const schedulerAutomation = await knowledgeSchedulerClient.reconcile({
      appId,
      action,
      mutationActions: knowledgeScheduleMutationActions,
    })
    if (schedulerAutomation.status !== 'VERIFIED') {
      return {
        ok: false,
        error: {
          code: 'KNOWLEDGE_SCHEDULE_AUTOMATION_UNVERIFIED',
          message: '热点采集计划已保存，但自动执行状态尚未确认，请使用同一请求重试',
          retryable: true,
        },
      }
    }
  }
  if (routeAutomation.requiresTrustedAppId) {
    if (routeAutomation.messageSchedule) {
      const schedulerAutomation = await messageSchedulerClient.afterSuccessfulMutation({
        appId,
        action,
        mutationActions: messageScheduleMutationActions,
      })
      if (schedulerAutomation.status !== 'VERIFIED') {
        return {
          ok: false,
          error: {
            code: 'MESSAGE_SCHEDULE_AUTOMATION_UNVERIFIED',
            message: '定时计划已保存，但自动执行状态尚未确认，请使用同一请求重试',
            retryable: true,
          },
        }
      }
    }
    if (routeAutomation.outbox) {
      await outboxWakeup.afterSuccessfulMutation({
        appId,
        action,
        mutationActions: outboxMutationActions,
      })
    }
  }
  return null
}

exports._test = {
  configuredAgreements,
  contentSafety,
  fetchKnowledgeSource,
  jsonFeedItems,
  normalizeDispatchRun,
  messageScheduleMutationActions,
  outboxMutationActions,
  resolveTrustedIdentity,
  rssItems,
  runDueMessageCampaigns,
  runDueKnowledgeIngestion,
  knowledgeScheduleMutationActions,
  verifyKnowledgeSchedulerRequest,
  verifyMessageDispatchRequest,
}
