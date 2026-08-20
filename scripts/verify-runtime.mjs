#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  acquireSharedMiniProgram,
  closeSharedMiniProgram,
  resolveProjectAutomatorPort,
} from 'weapp-ide-cli'
import {
  clearStaleAutomatorPortLease,
  isLocalPortListening,
} from './lib/devtools-automator-session.mjs'
import { warmWechatDevtoolsProject } from './lib/devtools-project-warmup.mjs'
import { installMiniprogramAutomatorCompatibility } from './lib/miniprogram-automator-compat.mjs'
import {
  createRuntimeDiagnostics,
  isRecoverableRuntimeConnectionError,
  readRuntimeWarningAllowlist,
  sanitizeRuntimeValue,
} from './lib/runtime-observability.mjs'
import { assertRuntimePreflight } from './lib/runtime-preflight.mjs'
import { comparePngBuffers } from './lib/visual-diff.mjs'

const root = path.resolve(import.meta.dirname, '..')
const devtoolsRoot = process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT
  ? path.resolve(process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT)
  : root
const outputDir = path.join(root, '.tmp', 'runtime')
const baselineDir = path.join(root, '.screenshots', 'baseline')
const reportPath = path.join(outputDir, 'report.json')
const consolePath = path.join(outputDir, 'console.json')
const warningAllowlistPath = path.join(root, 'config', 'runtime-warning-allowlist.json')
const runtimePagesPath = path.join(root, 'config', 'runtime-pages.json')
const devToolsCompilerPatterns = [
  { name: 'missing-app-json', pattern: /app\.json doesn't exist/i },
  { name: 'missing-compiled-file', pattern: /summer-compiler miss .*dist/i },
  { name: 'update-app-code-error', pattern: /updateAppCode .*Error/i },
  { name: 'hot-reload-error', pattern: /hotreload error/i },
]
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const updateBaseline = args.includes('--update-baseline')
const requireBaseline = args.includes('--require-baseline')
const sessionId = '01mvp-membership-runtime'
const fallbackUuid = '00000000-0000-4000-8000-000000000000'
installMiniprogramAutomatorCompatibility()

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const runtimePages = JSON.parse(fs.readFileSync(runtimePagesPath, 'utf8'))
const sensitivePatterns = Array.isArray(runtimePages.sensitivePatterns) ? runtimePages.sensitivePatterns : []
const deviceRequiredCapabilities = Array.isArray(runtimePages.deviceRequiredCapabilities)
  ? runtimePages.deviceRequiredCapabilities
  : []
const rawPhoneLikePattern = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/

/** Route-specific data/layout checks keyed by path; merged with runtime-pages.json. */
const pageCaseDetails = {
  'pages/index/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Home did not load real data')
      assert(typeof data.profileCompletion === 'number', 'Home profile completion is missing')
      assert(typeof data.overviewSignature === 'string' && data.overviewSignature, 'Home presentation signature is missing')
      assertResolvedMediaUrls(data)
      assertLocalMediaUrl(data.avatarUrl, 'Home avatar')
      data.recommendations.forEach((item, index) => assertLocalMediaUrl(item.avatarUrl, `Home recommendation ${index + 1}`))
    },
  },
  'pages/explore/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Explore did not load real data')
      assert(['recommended', 'same-city', 'new'].includes(data.filter), 'Explore filter state is invalid')
      assertResolvedMediaUrls(data.recommendations)
      data.recommendations.forEach((item, index) => assertLocalMediaUrl(item.avatarUrl, `Explore recommendation ${index + 1}`))
    },
    assertLayout: assertMemberDiscoveryLayout,
  },
  'pages/events/index': {
    visualSettleMs: 6000,
    assertData(data) {
      assert(data.state === 'ready', 'Events did not load real data')
      assert(['upcoming', 'mine'].includes(data.view), 'Event view state is invalid')
      assert(typeof data.eventSignature === 'string' && data.eventSignature, 'Event presentation signature is missing')
      assertResolvedMediaUrls(data.events)
      data.events.forEach((item, index) => assertLocalMediaUrl(item.coverUrl, `Event cover ${index + 1}`))
    },
    assertLayout: assertEventListLayout,
  },
  'pages/membership/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Membership checkout did not load real data')
      assert(typeof data.paymentEnabled === 'boolean', 'Payment capability state is missing')
    },
  },
  'pages/profile/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Profile did not load real data')
      assert(typeof data.adminEnabled === 'boolean', 'Admin capability state is missing')
      assert(typeof data.profileSignature === 'string' && data.profileSignature, 'Profile presentation signature is missing')
      assertResolvedMediaUrls(data.avatarUrl)
      assertLocalMediaUrl(data.avatarUrl, 'Profile avatar')
    },
    assertLayout: assertProfileServiceActionsLayout,
  },
  'packages/member/access/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Access page did not load real data')
      assert(typeof data.complete === 'boolean', 'Access completion state is missing')
    },
    assertLayout: assertAccessLayout,
  },
  'packages/member/profile-edit/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Profile edit did not load real data')
      assert(data.saving === false, 'Profile edit started in a saving state')
      assert(typeof data.draftNickname === 'string', 'Profile draft is missing')
    },
    assertLayout: assertProfileEditLayout,
  },
  'packages/member/member-detail/index': {
    query(context) {
      return `memberId=${encodeURIComponent(context.memberId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Member detail did not load real data')
    },
  },
  'packages/member/connections/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Member connections did not load real data')
      assert(['following', 'followers'].includes(data.direction), 'Member connection direction is invalid')
    },
  },
  'packages/member/announcements/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Community announcements did not load real data')
      assert(Array.isArray(data.items), 'Community announcement list is missing')
    },
  },
  'packages/member/announcement-detail/index': {
    query(context) {
      return `announcementId=${encodeURIComponent(context.announcementId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Community announcement detail did not load real data')
      assert(typeof data.item?.body === 'string', 'Community announcement body is missing')
    },
  },
  'packages/member/blocked-members/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Blocked member list did not load real data')
      assert(Array.isArray(data.items), 'Blocked member list is missing')
      assert(data.processingId === '', 'Blocked member list started in a mutation state')
    },
  },
  'packages/member/event-detail/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event detail did not load real data')
    },
  },
  'packages/member/event-participants/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event participants did not load real data')
      assert(Array.isArray(data.items), 'Event participant list is missing')
      assert(
        Number(data.visibleParticipantCount || 0) >= data.items.length,
        'Visible participant count is smaller than the rendered list',
      )
    },
  },
  'packages/member/event-album/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event album did not load real data')
    },
  },
  'packages/member/registration-confirm/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Registration confirmation did not load real data')
    },
  },
  'packages/member/ticket/index': {
    visualSettleMs: 1800,
    query(context) {
      return `eventId=${encodeURIComponent(context.registrationEventId || context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event ticket did not load real data')
      if (data.registration?.registrationState === 'REGISTERED') {
        assert(
          typeof data.passValue === 'string' && data.passValue.startsWith('mbr-checkin:v1:'),
          'Registered event ticket did not issue a dynamic check-in credential',
        )
        assert(typeof data.passExpiresText === 'string' && data.passExpiresText, 'Check-in credential expiry copy is missing')
        assert(data.passRendered === true, 'Registered event ticket did not render its QR matrix')
      }
    },
  },
  'packages/member/orders/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Member orders did not load real data')
    },
    assertLayout: page => assertQuietFilterTabs(page, '#order-filter-tabs'),
  },
  'packages/member/order-detail/index': {
    query(context) {
      return `orderId=${encodeURIComponent(context.orderId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Order detail did not load real data')
    },
  },
  'packages/member/payment-result/index': {
    query(context) {
      return `orderId=${encodeURIComponent(context.orderId || fallbackUuid)}`
    },
    assertData(data) {
      assert(['checking', 'success', 'pending', 'failed'].includes(data.result), 'Payment result state is invalid')
    },
  },
  'packages/member/registrations/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Member registrations did not load real data')
    },
  },
  'packages/member/notifications/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Member notifications did not load real data')
      assert(Array.isArray(data.items), 'Member notification list is missing')
    },
  },
  'packages/member/benefits/index': {
    assertData(data) {
      assert(typeof data.membershipActive === 'boolean', 'Membership benefit state is missing')
    },
  },
  'packages/member/privacy/index': {
    assertData(data) {
      assert(data.deleting === false, 'Privacy page started in a destructive state')
    },
  },
  'packages/member/help/index': {
    assertData(data) {
      assert(data && typeof data === 'object', 'Help page data is missing')
    },
  },
  'packages/member/about/index': {
    assertData(data) {
      assert(data && typeof data === 'object', 'About page data is missing')
    },
  },
  'packages/admin/dashboard/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin dashboard did not load real data')
    },
  },
  'packages/admin/managed-events/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Managed events did not load real data')
    },
  },
  'packages/admin/event-console/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event operations console did not load real data')
      assert(data.item && data.item.id, 'Event operations console is missing its event context')
    },
  },
  'packages/admin/events/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Admin events did not load real data')
      assert(data.saving === false, 'Admin events started in a saving state')
    },
  },
  'packages/admin/event-registrations/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Admin event registrations did not load real data')
      assert(data.state !== 'error' && data.state !== 'forbidden', 'Admin event registrations cannot treat error/forbidden as success')
    },
  },
  'packages/admin/event-managers/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Event managers did not load real data')
      assert(data.saving === false, 'Event managers started in a saving state')
    },
  },
  'packages/admin/event-album/index': {
    query(context) {
      return `eventId=${encodeURIComponent(context.eventId || fallbackUuid)}`
    },
    assertData(data) {
      assert(data.state === 'ready', 'Admin event album did not load real data')
    },
  },
  'packages/admin/profiles/index': {
    assertData(data) {
      assert(
        data.state === 'ready' || data.state === 'empty',
        'Admin profiles did not load real data',
      )
      assert(Array.isArray(data.profiles), 'Admin profile list is missing')
    },
  },
  'packages/admin/orders/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin orders did not load real data')
    },
  },
  'packages/admin/exceptions/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Operational exception center did not load real data')
      assert(Array.isArray(data.items), 'Operational exception list is missing')
      assert(data.retryingId === '', 'Operational exception center started in a mutation state')
    },
  },
  'packages/admin/announcements/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin announcements did not load real data')
      assert(Array.isArray(data.items), 'Admin announcement list is missing')
      assert(data.processingId === '', 'Admin announcements started in a mutation state')
    },
  },
  'packages/admin/announcement-editor/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin announcement editor did not become ready')
      assert(data.saving === false, 'Admin announcement editor started in a saving state')
    },
  },
  'packages/admin/reports/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Member report queue did not load real data')
      assert(Array.isArray(data.items), 'Member report queue is missing')
      assert(data.processingId === '', 'Member report queue started in a mutation state')
    },
  },
  'packages/admin/audit/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin audit did not load real data')
    },
  },
  'packages/admin/roles/index': {
    assertData(data) {
      assert(data.state === 'ready', 'Admin roles did not load real data')
      assert(Array.isArray(data.roles), 'Admin roles list is missing')
      assert(Array.isArray(data.profiles), 'Admin role candidates are missing')
      assert(data.busyId === '', 'Admin roles started in a mutation state')
    },
  },
}

function matchesSensitivePattern(text) {
  const lower = String(text).toLowerCase()
  const matched = []
  for (const pattern of sensitivePatterns) {
    const needle = String(pattern).toLowerCase()
    if (needle && lower.includes(needle)) {
      matched.push(String(pattern))
    }
  }
  return matched
}

function normalizeIdentifier(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function matchesSensitiveKey(key) {
  const normalizedKey = normalizeIdentifier(key)
  // Masked presentation fields are the permitted consumer-facing projection.
  // Their values are still recursively scanned below for configured secrets
  // and raw phone-number shapes.
  if (normalizedKey.endsWith('_masked')) {
    return []
  }
  return sensitivePatterns.filter((pattern) => {
    const normalizedPattern = normalizeIdentifier(pattern)
    return normalizedPattern
      && (
        normalizedKey === normalizedPattern
        || normalizedKey.startsWith(`${normalizedPattern}_`)
        || normalizedKey.endsWith(`_${normalizedPattern}`)
        || normalizedKey.includes(`_${normalizedPattern}_`)
      )
  })
}

function assertNoSensitivePageData(data, route = '<unknown>') {
  const hits = []
  const walk = (value, keyPath) => {
    if (typeof value === 'string') {
      for (const pattern of matchesSensitivePattern(value)) {
        hits.push({ path: keyPath || '(root)', pattern })
      }
      if (rawPhoneLikePattern.test(value)) {
        hits.push({ path: keyPath || '(root)', pattern: 'raw-phone-like' })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${keyPath}[${index}]`))
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        const nextPath = keyPath ? `${keyPath}.${key}` : key
        for (const pattern of matchesSensitiveKey(key)) {
          hits.push({ path: nextPath, pattern: `key:${pattern}` })
        }
        walk(entry, nextPath)
      }
    }
  }
  walk(data, '')
  const unauthorizedHits = hits.filter((hit) => {
    const isAuthorizedRosterPhone = route === 'packages/admin/event-registrations/index'
      && data?.canViewSensitiveRoster === true
      && /^items\[\d+\]\.phoneNumber$/.test(hit.path)
      && ['key:phonenumber', 'key:phone_number', 'raw-phone-like'].includes(hit.pattern)
    return !isAuthorizedRosterPhone
  })
  assert(
    unauthorizedHits.length === 0,
    `${route} page data contains sensitive values: ${JSON.stringify(unauthorizedHits.slice(0, 8))}`,
  )
}

function enforceRouteReadyContract(routeConfig, data) {
  if (routeConfig.kind === 'result') {
    assert(
      ['checking', 'success', 'pending', 'failed'].includes(data.result),
      `${routeConfig.path} payment/result state is invalid (error is not success)`,
    )
    return
  }
  if (routeConfig.kind === 'data') {
    const acceptedStates = Array.isArray(routeConfig.acceptStates)
      ? routeConfig.acceptStates
      : ['ready']
    assert(
      acceptedStates.length > 0
      && acceptedStates.every(state => !['loading', 'error', 'forbidden'].includes(state)),
      `${routeConfig.path} contract contains a state that cannot count as runtime success`,
    )
    assert(
      acceptedStates.includes(data.state),
      `${routeConfig.path} did not reach ${acceptedStates.join(' or ')}; error/forbidden/loading are not runtime success states`,
    )
  }
  if (typeof data.state === 'string') {
    assert(
      data.state !== 'error',
      `${routeConfig.path} settled on error, which cannot count as runtime success`,
    )
  }
}

function wrapAssertData(routeConfig, detailAssertData) {
  return (data) => {
    assertNoSensitivePageData(data, routeConfig.path)
    if (typeof detailAssertData === 'function') {
      detailAssertData(data)
    }
    enforceRouteReadyContract(routeConfig, data)
  }
}

function buildPageCases() {
  assert(Array.isArray(runtimePages.routes), 'runtime-pages.json routes[] is required')
  assert(
    runtimePages.routeCount === 41 && runtimePages.routes.length === 41,
    `runtime-pages.json must declare exactly 41 routes, got routeCount=${runtimePages.routeCount} length=${runtimePages.routes.length}`,
  )
  const seen = new Set()
  const cases = runtimePages.routes.map((routeConfig) => {
    assert(routeConfig?.path && routeConfig?.selector, `runtime-pages route is incomplete: ${JSON.stringify(routeConfig)}`)
    assert(!seen.has(routeConfig.path), `duplicate runtime route: ${routeConfig.path}`)
    seen.add(routeConfig.path)
    const detail = pageCaseDetails[routeConfig.path]
    assert(detail, `Missing page case detail for contracted route ${routeConfig.path}`)
    return {
      route: routeConfig.path,
      selector: routeConfig.selector,
      kind: routeConfig.kind,
      contract: routeConfig,
      visualSettleMs: detail.visualSettleMs,
      query: detail.query,
      assertLayout: detail.assertLayout,
      assertData: wrapAssertData(routeConfig, detail.assertData),
    }
  })
  for (const pathName of Object.keys(pageCaseDetails)) {
    assert(seen.has(pathName), `pageCaseDetails has uncontracted route ${pathName}`)
  }
  return cases
}

function buildDeviceRequiredReport() {
  return deviceRequiredCapabilities.map(capability => ({
    id: capability.id,
    label: capability.label,
    routes: capability.routes || [],
    reason: capability.reason,
    status: 'DEVICE_REQUIRED_NOT_VERIFIED',
  }))
}

const pageCases = buildPageCases()
const runtimeRoutes = pageCases.map(item => item.route)

function pageCaseByRoute(route) {
  const found = pageCases.find(item => item.route === route)
  assert(found, `Missing page case for ${route}`)
  return found
}

function assertResolvedMediaUrls(value) {
  if (typeof value === 'string') {
    assert(!value.startsWith('cloud://'), 'CloudBase file ID reached a native image instead of a temporary HTTPS URL')
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertResolvedMediaUrls)
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertResolvedMediaUrls)
  }
}

function assertLocalMediaUrl(value, label) {
  if (!value) {
    return
  }
  assert(
    value.startsWith('wxfile://') || value.startsWith('http://tmp/'),
    `${label} stayed remote instead of using the process-local media cache`,
  )
}

function rounded(value) {
  return Math.round(Number(value) * 10) / 10
}

async function assertProfileEditLayout(page) {
  const [card] = await page.renderedNodes('#profile-edit-form-card')
  const fields = await page.renderedNodes('.profile-edit-field')
  const [headline] = await page.renderedNodes('#profile-edit-headline')
  const singleLineFields = await page.renderedNodes('.profile-edit-single-line')
  assert(card && headline && fields.length === 10, 'Profile editor geometry nodes are incomplete')
  assert(singleLineFields.length === 8, 'Profile editor single-line fields are incomplete')
  for (const [index, field] of fields.entries()) {
    assert(field.left >= card.left + 12, `Profile field ${index + 1} escaped the left card padding`)
    assert(field.right <= card.right - 12, `Profile field ${index + 1} escaped the right card padding`)
    assert(field.width <= card.width - 24, `Profile field ${index + 1} is wider than its card content area`)
  }
  assert(headline.height >= 90 && headline.height <= 120, `Profile headline height is unreasonable: ${headline.height}`)
  for (const [index, field] of singleLineFields.entries()) {
    assert(field.height >= 42 && field.height <= 50, `Profile single-line field ${index + 1} height is unreasonable: ${field.height}`)
  }
  return {
    cardWidth: rounded(card.width),
    fieldCount: fields.length,
    minimumRightInset: rounded(Math.min(...fields.map(field => card.right - field.right))),
    headlineHeight: rounded(headline.height),
    singleLineHeights: singleLineFields.map(field => rounded(field.height)),
  }
}

async function assertMemberDiscoveryLayout(page) {
  const filterTabs = await assertQuietFilterTabs(page, '#explore-filter-tabs')
  const items = await page.renderedNodes('.member-discovery-item')
  assert(items.length >= 2, 'Member discovery verification needs at least two real profiles')
  const gaps = items.slice(1).map((item, index) => item.top - items[index].bottom)
  for (const [index, item] of items.entries()) {
    assert(item.width >= 340, `Member discovery item ${index + 1} is too narrow for profile metadata: ${item.width}px`)
  }
  for (const [index, gap] of gaps.entries()) {
    assert(gap >= 10, `Member discovery items ${index + 1}/${index + 2} are visually stuck together: ${gap}px`)
  }
  return {
    itemCount: items.length,
    minimumWidth: rounded(Math.min(...items.map(item => item.width))),
    minimumGap: rounded(Math.min(...gaps)),
    filterTabs,
  }
}

async function assertQuietFilterTabs(page, selector) {
  const [tabs] = await page.renderedNodes(selector)
  assert(tabs, `Filter tabs are missing: ${selector}`)
  assert(tabs.width >= 340, `Filter tabs are too narrow: ${tabs.width}px`)
  assert(tabs.height >= 42 && tabs.height <= 58, `Filter tabs height is visually excessive: ${tabs.height}px`)
  return { width: rounded(tabs.width), height: rounded(tabs.height) }
}

async function assertProfileServiceActionsLayout(page) {
  const [panel] = await page.renderedNodes('#profile-service-actions')
  const actions = await page.renderedNodes('.profile-service-action')
  const icons = await page.renderedNodes('.profile-service-icon')
  assert(panel && actions.length === 3 && icons.length === 3, 'Profile service actions are incomplete')
  for (const [index, action] of actions.entries()) {
    assert(action.width >= 340, `Profile service action ${index + 1} is too narrow: ${action.width}px`)
    assert(action.height >= 54 && action.height <= 64, `Profile service action ${index + 1} height is unreasonable: ${action.height}px`)
    assert(icons[index].width >= 34 && icons[index].width <= 40, `Profile service icon ${index + 1} width is unreasonable: ${icons[index].width}px`)
    assert(Math.abs((icons[index].top + icons[index].height / 2) - (action.top + action.height / 2)) <= 2, `Profile service icon ${index + 1} is not vertically centered`)
  }
  return {
    actionHeights: actions.map(action => rounded(action.height)),
    iconWidths: icons.map(icon => rounded(icon.width)),
  }
}

async function assertAccessLayout(page) {
  const [action] = await page.renderedNodes('#access-primary-action')
  assert(action, 'Access page primary action is missing')
  assert(action.height >= 40 && action.height <= 52, `Access primary action height is unreasonable: ${action.height}px`)
  assert(action.width >= 150 && action.width <= 360, `Access primary action width is unreasonable: ${action.width}px`)
  return {
    actionWidth: rounded(action.width),
    actionHeight: rounded(action.height),
  }
}

async function assertEventListLayout(page) {
  const filterTabs = await assertQuietFilterTabs(page, '#event-filter-tabs')
  const cards = await page.renderedNodes('.event-list-item')
  assert(cards.length >= 2, 'Event geometry verification needs at least two real event cards')
  const gaps = cards.slice(1).map((card, index) => card.top - cards[index].bottom)
  for (const [index, gap] of gaps.entries()) {
    assert(gap >= 12, `Event cards ${index + 1}/${index + 2} are visually stuck together: ${gap}px`)
  }
  for (const [index, card] of cards.entries()) {
    assert(card.height >= 104 && card.height <= 116, `Event card ${index + 1} height is unreasonable: ${card.height}px`)
  }
  return {
    cardCount: cards.length,
    cardHeights: cards.map(card => rounded(card.height)),
    minimumGap: rounded(Math.min(...gaps)),
    filterTabs,
  }
}

function isScreenshotCaptureError(error) {
  return error instanceof Error && error.message.includes('fail to capture screenshot')
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WEAPP_VITE_MCP: '0' },
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${commandArgs.join(' ')}`)
  }
}

function outputName(page) {
  return page.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
}

async function retry(label, operation, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (isRecoverableRuntimeConnectionError(error) || attempt === attempts) {
        break
      }
      console.warn(`WARN  ${label} failed (${attempt}/${attempts}); retrying in the same automator session`)
      await new Promise(resolve => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

async function withProtocolTimeout(label, operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`DEVTOOLS_PROTOCOL_TIMEOUT: ${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function captureScreenshot(label, miniProgram, screenshotPath, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await miniProgram.screenshot({ path: screenshotPath, timeout: 60000 })
    }
    catch (error) {
      lastError = error
      if (isRecoverableRuntimeConnectionError(error) || attempt === attempts) {
        throw error
      }
      console.warn(`WARN  ${label} capture failed (${attempt}/${attempts}); retrying`)
      await new Promise(resolve => setTimeout(resolve, attempt * 400))
    }
  }
  throw lastError
}

async function waitForPageData(page, item, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastData
  let lastError
  while (Date.now() < deadline) {
    lastData = await retry(`read data ${item.route}`, () => page.data())
    try {
      item.assertData(lastData)
      return lastData
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  const state = sanitizeRuntimeValue(lastData)
  throw new Error(`${lastError instanceof Error ? lastError.message : 'Page did not settle'}; last page data: ${state}`)
}

function compare(baselinePath, currentPath, diffPath) {
  const result = comparePngBuffers(fs.readFileSync(baselinePath), fs.readFileSync(currentPath))
  fs.writeFileSync(diffPath, result.diffBuffer)
  assert(result.diffRatio <= 0.001, `Visual regression exceeded 0.1%: ${(result.diffRatio * 100).toFixed(3)}%`)
  return result
}

function publicPageState(data) {
  const result = {}
  for (const key of ['state', 'result', 'filter', 'view', 'paymentEnabled', 'membershipActive', 'complete', 'saving', 'deleting', 'adminEnabled']) {
    if (['string', 'boolean', 'number'].includes(typeof data[key])) {
      result[key] = data[key]
    }
  }
  for (const key of ['events', 'recommendations', 'plans', 'profiles', 'orders', 'items']) {
    if (Array.isArray(data[key])) {
      result[`${key}Count`] = data[key].length
    }
  }
  if (typeof data.message === 'string' && data.message) {
    result.message = sanitizeRuntimeValue(data.message)
  }
  return result
}

function writeArtifacts(report, diagnostics) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(consolePath, `${JSON.stringify({
    summary: diagnostics.summary(),
    entries: diagnostics.entries(),
  }, null, 2)}\n`)
}

function listDevToolsLogFiles() {
  if (process.platform !== 'darwin') {
    return []
  }
  const profilesRoot = path.join(os.homedir(), 'Library', 'Application Support', '微信开发者工具')
  if (!fs.existsSync(profilesRoot)) {
    return []
  }
  const files = []
  for (const profile of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!profile.isDirectory()) {
      continue
    }
    const logsDir = path.join(profilesRoot, profile.name, 'WeappLog', 'logs')
    if (!fs.existsSync(logsDir)) {
      continue
    }
    for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.log')) {
        files.push(path.join(logsDir, entry.name))
      }
    }
  }
  return files
}

function snapshotDevToolsLogs() {
  return new Map(listDevToolsLogFiles().map(filePath => [filePath, fs.statSync(filePath).size]))
}

function inspectDevToolsCompilerLogs(snapshot) {
  const matches = []
  let inspectedBytes = 0
  for (const filePath of listDevToolsLogFiles()) {
    const start = snapshot.get(filePath) ?? 0
    const size = fs.statSync(filePath).size
    if (size <= start) {
      continue
    }
    const descriptor = fs.openSync(filePath, 'r')
    try {
      const chunk = Buffer.alloc(size - start)
      fs.readSync(descriptor, chunk, 0, chunk.length, start)
      inspectedBytes += chunk.length
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        for (const signature of devToolsCompilerPatterns) {
          if (signature.pattern.test(line)) {
            matches.push({ signature: signature.name, file: path.basename(filePath) })
          }
        }
      }
    }
    finally {
      fs.closeSync(descriptor)
    }
  }
  return {
    available: process.platform === 'darwin',
    inspectedBytes,
    failures: matches.length,
    matches,
  }
}

fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(baselineDir, { recursive: true })
for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
  if (entry.isFile()) {
    fs.rmSync(path.join(outputDir, entry.name))
  }
}
if (requireBaseline && !updateBaseline) {
  for (const item of pageCases) {
    assert(fs.existsSync(path.join(baselineDir, `${outputName(item.route)}.png`)), `Missing baseline for ${item.route}`)
  }
}
// The wrapper has just synchronized the compiled DevTools host. Let the IDE
// file watcher finish that setup before establishing the diagnostic baseline;
// post-baseline compiler errors and every final route still fail the suite.
await new Promise(resolve => setTimeout(resolve, 1500))
const devToolsLogSnapshot = snapshotDevToolsLogs()
if (!skipBuild) {
  run('pnpm', ['build'])
}

const report = {
  status: 'running',
  updateBaseline,
  pages: [],
  attempts: [],
  recoveries: [],
  deviceRequired: buildDeviceRequiredReport(),
  routeContract: {
    source: 'config/runtime-pages.json',
    routeCount: pageCases.length,
    routes: runtimeRoutes,
  },
}
const baseRuntimeOptions = {
  port: resolveProjectAutomatorPort(devtoolsRoot),
  projectPath: devtoolsRoot,
  preserveProjectRoot: true,
  sessionId,
  sharedSession: true,
  timeout: 60000,
  trustProject: true,
}
const warningAllowlist = readRuntimeWarningAllowlist(warningAllowlistPath)
const diagnostics = createRuntimeDiagnostics({ allowlist: warningAllowlist })
let miniProgram
const runtimeContext = {
  memberId: '',
  eventId: '',
  registrationEventId: '',
  orderId: '',
  announcementId: '',
}

async function runRuntimeAttempt(preferOpenedSession) {
  if (await clearStaleAutomatorPortLease(baseRuntimeOptions.port)) {
    report.recoveries.push({
      action: 'cleared-stale-port-lease',
      port: baseRuntimeOptions.port,
    })
  }
  miniProgram = await withProtocolTimeout(
    'shared automator acquisition',
    () => acquireSharedMiniProgram({
      ...baseRuntimeOptions,
      preferOpenedSession,
      sharedSession: preferOpenedSession,
      openedOnly: preferOpenedSession,
    }),
    baseRuntimeOptions.timeout * 2 + 15000,
  )
  // weapp-vite already forwards runtime diagnostics. App.enableLog depends on
  // App.callFunction and can stall DevTools 2.01.2510290 after reconnecting to
  // an existing automator endpoint, so this suite uses passive listeners.
  const consoleCapture = 'passive'

  miniProgram.on('console', payload => diagnostics.captureConsole(payload))
  miniProgram.on('exception', payload => diagnostics.captureException(payload))

  for (const item of pageCases.slice(report.pages.length)) {
    const name = outputName(item.route)
    const baseline = path.join(baselineDir, `${name}.png`)
    const current = path.join(outputDir, `${name}.png`)
    const diff = path.join(outputDir, `${name}.diff.png`)
    const query = typeof item.query === 'function' ? item.query(runtimeContext) : ''
    const launchRoute = `/${item.route}${query ? `?${query}` : ''}`
    const page = await retry(`reLaunch ${item.route}`, () => miniProgram.reLaunch(launchRoute))
    await retry(`wait ${item.selector}`, () => page.waitForRendered({ selector: item.selector, timeout: 15000 }))
    assert(String(page.path || '').replace(/^\//, '') === item.route, `Unexpected runtime route: ${page.path}`)
    const settledData = await waitForPageData(page, item)
    runtimeContext.memberId ||= settledData.recommendations?.[0]?.id || settledData.member?.id || ''
    runtimeContext.eventId ||= settledData.nextEvent?.id || settledData.events?.[0]?.id || settledData.event?.id || ''
    runtimeContext.registrationEventId ||= settledData.items?.[0]?.eventId || settledData.registration?.eventId || ''
    runtimeContext.announcementId ||= settledData.announcement?.id || settledData.items?.[0]?.id || settledData.item?.id || ''
    runtimeContext.orderId ||= settledData.orders?.[0]?.id || settledData.order?.id || ''
    await new Promise(resolve => setTimeout(resolve, item.visualSettleMs ?? 1200))
    const screenshotData = await retry(`confirm data ${item.route}`, () => page.data())
    item.assertData(screenshotData)
    const layout = typeof item.assertLayout === 'function' ? await retry(`verify layout ${item.route}`, () => item.assertLayout(page)) : undefined
    await captureScreenshot(item.route, miniProgram, current)
    const size = fs.statSync(current).size
    assert(size >= 12 * 1024, `Screenshot is suspiciously small: ${item.route}`)
    const result = {
      route: item.route,
      sizeBytes: size,
      mode: updateBaseline ? 'baseline-candidate' : fs.existsSync(baseline) ? 'compare' : 'capture',
      publicState: publicPageState(screenshotData || settledData),
    }
    if (layout) {
      result.layout = layout
    }
    if (!updateBaseline && fs.existsSync(baseline)) {
      Object.assign(result, compare(baseline, current, diff))
    }
    report.pages.push(result)
    console.log(`PASS  ${item.route}  ${Math.round(size / 1024)} KB`)
  }

  assert(runtimeContext.eventId, 'Phone login sheet verification requires a real event')
  const eventDetailCase = pageCaseByRoute('packages/member/event-detail/index')
  const phoneSheetPage = await retry('phone login sheet page', () => miniProgram.reLaunch(
    `/packages/member/event-detail/index?eventId=${encodeURIComponent(runtimeContext.eventId)}`,
  ))
  await retry('phone login sheet page ready', () => phoneSheetPage.waitForRendered({ selector: eventDetailCase.selector, timeout: 15000 }))
  const phoneSheetData = await waitForPageData(phoneSheetPage, eventDetailCase)
  assert(phoneSheetData.state === 'ready', 'Phone login sheet background page is not ready')
  await retry('open phone login sheet', () => phoneSheetPage.setData({ phoneSheetVisible: true }))
  const visiblePhoneSheetData = await retry('read phone login sheet state', () => phoneSheetPage.data())
  assert(visiblePhoneSheetData.phoneSheetVisible === true, 'Phone login sheet did not enter the visible state')
  // Page selectors do not pierce the custom-component boundary in every
  // DevTools version, so state + screenshot is the stable interaction proof.
  await new Promise(resolve => setTimeout(resolve, 700))
  const phoneSheetPath = path.join(outputDir, 'interaction-phone-login-sheet.png')
  await captureScreenshot('phone-login-sheet', miniProgram, phoneSheetPath)
  const phoneSheetSize = fs.statSync(phoneSheetPath).size
  assert(phoneSheetSize >= 12 * 1024, 'Phone login sheet screenshot is suspiciously small')
  report.interactionStates = [{
    name: 'phone-login-sheet',
    route: 'packages/member/event-detail/index',
    sizeBytes: phoneSheetSize,
  }]
  console.log(`PASS  phone-login-sheet interaction  ${Math.round(phoneSheetSize / 1024)} KB`)

  const homeCase = pageCaseByRoute('pages/index/index')
  const exploreCase = pageCaseByRoute('pages/explore/index')
  const eventsCase = pageCaseByRoute('pages/events/index')
  const membershipCase = pageCaseByRoute('pages/membership/index')
  const profileCase = pageCaseByRoute('pages/profile/index')
  const home = await retry('continuity home', () => miniProgram.reLaunch('/pages/index/index'))
  await retry('continuity wait home', () => home.waitForRendered({ selector: homeCase.selector, timeout: 15000 }))
  const initialHome = await waitForPageData(home, homeCase)
  assert(initialHome.state === 'ready', 'Navigation continuity requires a ready home page')

  const explore = await retry('continuity switch to explore', () => miniProgram.switchTab('/pages/explore/index'))
  await retry('continuity wait explore', () => explore.waitForRendered({ selector: exploreCase.selector, timeout: 15000 }))
  const settledExplore = await waitForPageData(explore, exploreCase)
  assert(settledExplore.state === 'ready', 'Tab switch did not settle the explore page')

  const returnedHome = await retry('continuity switch to home', () => miniProgram.switchTab('/pages/index/index'))
  const immediateTabState = await retry('continuity read home after tab switch', () => returnedHome.data())
  assert(immediateTabState.state === 'ready', 'Returning by TabBar reset the home page to loading')

  const returnedExplore = await retry('continuity switch back to explore', () => miniProgram.switchTab('/pages/explore/index'))
  const immediateExploreState = await retry('continuity read explore after tab switch', () => returnedExplore.data())
  assert(immediateExploreState.state === 'ready', 'Returning to explore reset the member feed to loading')
  assert(immediateExploreState.recommendationSignature === settledExplore.recommendationSignature, 'Returning to explore replaced the unchanged member feed')
  await new Promise(resolve => setTimeout(resolve, 700))
  const settledReturnedExplore = await retry('continuity confirm explore after refresh window', () => returnedExplore.data())
  assert(settledReturnedExplore.recommendationSignature === settledExplore.recommendationSignature, 'Explore member feed changed during a cache-fresh tab return')

  const events = await retry('continuity switch to events', () => miniProgram.switchTab('/pages/events/index'))
  await retry('continuity wait events', () => events.waitForRendered({ selector: eventsCase.selector, timeout: 15000 }))
  const settledEvents = await waitForPageData(events, eventsCase)
  const eventsHome = await retry('continuity leave events', () => miniProgram.switchTab('/pages/index/index'))
  assert((await retry('continuity read home after events', () => eventsHome.data())).state === 'ready', 'Leaving events reset the home page')
  const returnedEvents = await retry('continuity return to events', () => miniProgram.switchTab('/pages/events/index'))
  const immediateEventsState = await retry('continuity read events after tab switch', () => returnedEvents.data())
  assert(immediateEventsState.state === 'ready', 'Returning to events reset the page to loading')
  assert(immediateEventsState.eventSignature === settledEvents.eventSignature, 'Returning to events replaced unchanged event cards')

  const cachedHome = await retry('continuity return home before detail', () => miniProgram.switchTab('/pages/index/index'))
  const editor = await retry('continuity open profile editor', () => miniProgram.navigateTo('/packages/member/profile-edit/index'))
  await retry('continuity wait editor', () => editor.waitForRendered({ selector: '#profile-edit-page', timeout: 15000 }))
  const backHome = await retry('continuity navigate back', () => miniProgram.navigateBack())
  const immediateBackState = await retry('continuity read home after back', () => backHome.data())
  assert(immediateBackState.state === 'ready', 'Returning from a detail page reset the home page to loading')

  await retry('continuity confirm cached home', () => cachedHome.data())
  const profile = await retry('benefits switch to profile', () => miniProgram.switchTab('/pages/profile/index'))
  await retry('benefits wait profile', () => profile.waitForRendered({ selector: profileCase.selector, timeout: 15000 }))
  await waitForPageData(profile, profileCase)
  const benefits = await retry('benefits navigate from profile', () => miniProgram.navigateTo('/packages/member/benefits/index'))
  await retry('benefits wait page', () => benefits.waitForRendered({ selector: '#member-benefits-page', timeout: 15000 }))
  const benefitsData = await retry('benefits read state', () => benefits.data())
  assert(typeof benefitsData.membershipActive === 'boolean', 'Benefits page did not load membership state')
  await new Promise(resolve => setTimeout(resolve, 500))
  const benefitsNavigationPath = path.join(outputDir, 'interaction-benefits-navigation.png')
  await captureScreenshot('benefits-navigation', miniProgram, benefitsNavigationPath)
  const benefitsNavigationSize = fs.statSync(benefitsNavigationPath).size
  assert(benefitsNavigationSize >= 12 * 1024, 'Benefits navigation screenshot is suspiciously small')
  report.interactionStates.push({
    name: 'benefits-navigation',
    route: 'packages/member/benefits/index',
    sizeBytes: benefitsNavigationSize,
  })
  await retry('benefits return-home action', () => benefits.callMethod('backToHome'))
  const benefitsHome = await retry('benefits read returned home', () => miniProgram.currentPage())
  const returnedHomeData = await retry('benefits read returned home data', () => benefitsHome.data())
  assert(benefitsHome.path === 'pages/index/index' && returnedHomeData.state === 'ready', 'Benefits page did not return to the ready home page')
  const membership = await retry('membership open from home', () => miniProgram.navigateTo('/pages/membership/index'))
  await retry('membership wait page', () => membership.waitForRendered({ selector: '#membership-checkout-page', timeout: 15000 }))
  await waitForPageData(membership, membershipCase)
  await retry('membership return-home action', () => membership.callMethod('backToHome'))
  const membershipHome = await retry('membership read returned home', () => miniProgram.currentPage())
  const membershipHomeData = await retry('membership read returned home data', () => membershipHome.data())
  assert(membershipHome.path === 'pages/index/index' && membershipHomeData.state === 'ready', 'Post-payment membership page did not return to the ready home page')
  report.navigationContinuity = {
    tabReturnState: immediateTabState.state,
    exploreReturnState: immediateExploreState.state,
    detailReturnState: immediateBackState.state,
    benefitsBackRoute: benefitsHome.path,
    membershipBackRoute: membershipHome.path,
    fullPageLoadingOnReturn: false,
    memberFeedReplacedOnReturn: false,
    eventCardsReplacedOnReturn: false,
  }
  console.log('PASS  navigation continuity  cache-first TabBar, stable member feed, and post-payment home navigation')

  return { consoleCapture }
}

try {
  report.preflight = await assertRuntimePreflight(devtoolsRoot, {
    sourceRoot: devtoolsRoot === root ? 'src' : 'dist',
    requirePublicAppId: devtoolsRoot !== root,
    requiredRoutes: runtimeRoutes,
  })
  const openedAutomatorAvailable = await isLocalPortListening(baseRuntimeOptions.port)
  if (!openedAutomatorAvailable) {
    await warmWechatDevtoolsProject({
      projectPath: devtoolsRoot,
    })
    report.recoveries.push({ action: 'prewarmed-devtools-project' })
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const preferOpenedSession = attempt === 1 && openedAutomatorAvailable
    try {
      const result = await runRuntimeAttempt(preferOpenedSession)
      report.consoleCapture = result.consoleCapture
      report.attempts.push({ attempt, preferOpenedSession, status: 'passed' })
      break
    }
    catch (error) {
      report.attempts.push({
        attempt,
        preferOpenedSession,
        status: 'failed',
        error: sanitizeRuntimeValue(error instanceof Error ? error.message : error),
      })
      if (attempt !== 1 || (!isRecoverableRuntimeConnectionError(error) && !isScreenshotCaptureError(error))) {
        throw error
      }
      report.recoveries.push({
        attempt,
        action: 'reconnect-target-project',
        reason: isScreenshotCaptureError(error) ? 'screenshot-capture-failed' : 'connection-failed',
      })
      await closeSharedMiniProgram(devtoolsRoot, sessionId).catch(() => undefined)
      miniProgram = undefined
      await warmWechatDevtoolsProject({
        projectPath: devtoolsRoot,
        restart: true,
      })
    }
  }

  await new Promise(resolve => setTimeout(resolve, 300))
  report.diagnostics = diagnostics.summary()
  report.ideCompilerDiagnostics = inspectDevToolsCompilerLogs(devToolsLogSnapshot)
  const failures = diagnostics.failures()
  assert(failures.length === 0, `Runtime diagnostics reported ${failures.length} error(s) or unknown warning(s)`)
  assert(report.ideCompilerDiagnostics.failures === 0, `WeChat DevTools compiler reported ${report.ideCompilerDiagnostics.failures} build/HMR error(s)`)
  assert(report.pages.length === pageCases.length, 'Runtime verifier did not complete every page case')
  assert(
    report.pages.length === runtimePages.routeCount,
    `Runtime verifier must cover all ${runtimePages.routeCount} contracted routes, got ${report.pages.length}`,
  )
  assert(
    report.pages.some(page => page.route === 'packages/admin/event-registrations/index'),
    'Runtime verifier must cover packages/admin/event-registrations/index',
  )
  if (updateBaseline) {
    for (const item of pageCases) {
      fs.copyFileSync(
        path.join(outputDir, `${outputName(item.route)}.png`),
        path.join(baselineDir, `${outputName(item.route)}.png`),
      )
    }
  }
  // Simulator never proves phone/pay/share/customer-service; keep them explicit.
  report.deviceRequired = buildDeviceRequiredReport()
  report.status = 'passed'
}
catch (error) {
  report.status = 'failed'
  report.diagnostics = diagnostics.summary()
  report.ideCompilerDiagnostics ??= inspectDevToolsCompilerLogs(devToolsLogSnapshot)
  report.deviceRequired = buildDeviceRequiredReport()
  report.error = sanitizeRuntimeValue(error instanceof Error ? error.message : error)
  throw error
}
finally {
  const cleanupStatus = await Promise.race([
    closeSharedMiniProgram(devtoolsRoot, sessionId).then(() => 'closed'),
    new Promise(resolve => setTimeout(resolve, 5000, 'timed-out')),
  ])
  report.cleanup = { status: cleanupStatus }
  report.deviceRequired ??= buildDeviceRequiredReport()
  writeArtifacts(report, diagnostics)
  const exitCode = report.status === 'passed' ? 0 : 1
  setTimeout(process.exit, 250, exitCode)
}
