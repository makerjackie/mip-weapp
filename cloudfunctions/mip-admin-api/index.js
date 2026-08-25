'use strict'

const cloud = require('wx-server-sdk')
const { createAdminApplication } = require('./domain/application')
const { createHandler, normalizeAdminRequest } = require('./domain/handler')
const { configuredAgreements, createFullAccessPolicy } = require('./domain/full-access')
const { outboxMutationActions } = require('./domain/operation-registry')
const { createAdminRepository } = require('./domain/repository')
const { createAdminService } = require('./domain/service')
const { createTrustedPrincipalIssuer, resolveTrustedIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createRefundWorkerClient } = require('./lib/refund-worker-client')
const { createCloudExportStorage } = require('./lib/export-storage')
const { createMatchingClient } = require('./lib/matching-client')
const { createOutboxWakeup, trustedContextAppId } = require('./lib/outbox-wakeup')
const {
  RUN_DUE_ACTION,
  verifyMessageDispatchRequest,
} = require('./lib/message-dispatch-auth')
const { createMessageDispatchRoute, normalizeDispatchRun } = require('./lib/message-dispatch-route')
const { createKnowledgeAdminService, configuredHosts, safeExternalUrl } = require('./domain/knowledge')
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
const service = createAdminService({
  repository,
  phoneEncryptionKey: process.env.MIP_PHONE_ENCRYPTION_KEY,
  contentSafety,
  dispatchRefund,
  dispatchRefunds,
  exportStorage,
  recalculateMatching: input => matchingClient.recalculate(input),
  profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
  exportMaxRows: boundedInteger(process.env.MIP_EXPORT_MAX_ROWS, 5_000, 100, 20_000),
  exportMaxBytes: boundedInteger(process.env.MIP_EXPORT_MAX_BYTES, 8 * 1024 * 1024, 1_048_576, 10_485_760),
})
Object.assign(service, createKnowledgeAdminService(mysqlDatabase(), {
  catalogStage: process.env.MIP_CATALOG_STAGE,
  contentSafety,
  defaultTestPriceCents: process.env.MIP_KNOWLEDGE_TEST_PRICE_CENTS,
  fetchSource: fetchKnowledgeSource,
  fullAccessPolicy,
  sourceAllowedHosts: knowledgeSourceAllowedHosts,
  webviewAllowedHosts: knowledgeWebviewAllowedHosts,
}))

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
const runDueMessageCampaigns = createMessageDispatchRoute({
  allowedAppIds,
  logger: console,
  outboxWakeup,
  repository,
  secret: process.env.MIP_MESSAGE_DISPATCH_HMAC_SECRET,
})

exports.main = async (event = {}) => {
  if (event?.action === RUN_DUE_ACTION) {
    return runDueMessageCampaigns(event)
  }
  const result = await handler(event)
  if (result?.ok === true) {
    const routeAction = normalizeAdminRequest(event).action
    if (outboxMutationActions.has(routeAction)) {
      await outboxWakeup.afterSuccessfulMutation({
        appId: trustedContextAppId(cloud.getWXContext(), allowedAppIds),
        action: routeAction,
        mutationActions: outboxMutationActions,
      })
    }
  }
  return result
}

exports._test = {
  configuredAgreements,
  contentSafety,
  fetchKnowledgeSource,
  jsonFeedItems,
  normalizeDispatchRun,
  outboxMutationActions,
  resolveTrustedIdentity,
  rssItems,
  runDueMessageCampaigns,
  verifyMessageDispatchRequest,
}
