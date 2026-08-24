#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
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
const outputDir = path.join(root, '.tmp', 'runtime')
const baselineDir = path.join(root, '.screenshots', 'baseline')
const reportPath = path.join(outputDir, 'report.json')
const consolePath = path.join(outputDir, 'console.json')
const warningAllowlistPath = path.join(root, 'config', 'runtime-warning-allowlist.json')
const runtimePagesPath = path.join(root, 'config', 'runtime-pages.json')
const safePlaceholderUuid = '00000000-0000-4000-8000-000000000000'
const sessionId = 'mip-weapp-runtime'
const failedStates = new Set(['error', 'forbidden', 'conflict', 'expired', 'disabled'])
const pendingStates = new Set(['loading'])
const rawPhoneLikePattern = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/
const devToolsCompilerPatterns = [
  { name: 'missing-app-json', pattern: /app\.json doesn't exist/i },
  { name: 'missing-compiled-file', pattern: /summer-compiler miss .*dist/i },
  { name: 'update-app-code-error', pattern: /updateAppCode .*Error/i },
  { name: 'hot-reload-error', pattern: /hotreload error/i },
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function selectorId(selector) {
  assert(/^#[a-z][\w-]*$/i.test(selector || ''), `Invalid runtime root selector: ${selector}`)
  return selector.slice(1)
}

function acceptedStates(route) {
  if (Array.isArray(route.acceptStates) && route.acceptStates.length > 0) {
    return route.acceptStates
  }
  if (route.kind === 'result') {
    return (route.states || []).filter(state => !failedStates.has(state) && !pendingStates.has(state))
  }
  return ['ready']
}

function validateRuntimeContract(runtimePages) {
  assert(runtimePages?.schemaVersion === 1, 'runtime-pages.json schemaVersion must be 1')
  assert(runtimePages.case === 'mip-weapp', 'runtime-pages.json must describe mip-weapp')
  assert(Array.isArray(runtimePages.routes), 'runtime-pages.json routes[] is required')
  assert(
    Number.isInteger(runtimePages.routeCount)
    && runtimePages.routeCount > 0
    && runtimePages.routes.length === runtimePages.routeCount,
    `runtime-pages.json routeCount=${runtimePages.routeCount} does not match routes length=${runtimePages.routes.length}`,
  )

  const seenPaths = new Set()
  const seenIds = new Set()
  const declaredStates = new Set()
  let hasDisabledControl = false
  for (const route of runtimePages.routes) {
    assert(route?.id && route.path && route.selector, `Incomplete runtime route: ${JSON.stringify(route)}`)
    assert(!seenPaths.has(route.path), `Duplicate runtime route: ${route.path}`)
    assert(!seenIds.has(route.id), `Duplicate runtime route id: ${route.id}`)
    seenPaths.add(route.path)
    seenIds.add(route.id)
    const id = selectorId(route.selector)
    const wxmlPath = path.join(root, 'src', `${route.path}.wxml`)
    assert(fs.existsSync(wxmlPath), `Runtime route is missing WXML: ${route.path}`)
    const wxml = fs.readFileSync(wxmlPath, 'utf8')
    assert(wxml.includes(`id="${id}"`), `${route.path} does not expose ${route.selector}`)
    hasDisabledControl ||= /\bdisabled="\{\{/.test(wxml)

    const states = Array.isArray(route.states) ? route.states : []
    states.forEach(state => declaredStates.add(state))
    if (route.kind === 'data' || route.kind === 'static-data') {
      assert(states.includes('ready'), `${route.path} must declare ready`)
      assert(states.includes('error'), `${route.path} must declare error`)
      if (route.kind === 'data') {
        assert(states.includes('loading'), `${route.path} must declare loading`)
      }
    }
    const accepted = acceptedStates(route)
    assert(accepted.length > 0, `${route.path} does not declare an accepted runtime state`)
    assert(
      accepted.every(state => !failedStates.has(state) && !pendingStates.has(state)),
      `${route.path} accepts a failure or pending state as runtime success`,
    )
    for (const key of route.query || []) {
      assert(/^[a-z][a-z0-9]*$/i.test(key), `${route.path} has an unsafe query key`)
    }
  }

  const tabRoutes = runtimePages.routes.filter(route => route.tab)
  assert(tabRoutes.length === 4, `Runtime contract must declare four primary tabs, got ${tabRoutes.length}`)
  assert(
    JSON.stringify(tabRoutes.map(route => route.path).sort())
    === JSON.stringify([
      'pages/events/index',
      'pages/index/index',
      'pages/opportunities/index',
      'pages/profile/index',
    ].sort()),
    'Runtime contract primary tabs do not match MIP navigation',
  )
  for (const state of ['loading', 'empty', 'error', 'forbidden', 'conflict']) {
    assert(declaredStates.has(state), `Runtime contract has no representative ${state} state`)
  }
  assert(hasDisabledControl, 'Runtime routes do not expose a representative disabled control')
}

function queryForRoute(route) {
  return (route.query || [])
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(safePlaceholderUuid)}`)
    .join('&')
}

function matchesSensitivePattern(text, sensitivePatterns) {
  const lower = String(text).toLowerCase()
  return sensitivePatterns.filter(pattern => lower.includes(String(pattern).toLowerCase()))
}

function normalizeIdentifier(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function matchesSensitiveKey(key, sensitivePatterns) {
  const normalizedKey = normalizeIdentifier(key)
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

function assertNoSensitivePageData(data, route, sensitivePatterns) {
  const hits = []
  const walk = (value, keyPath) => {
    if (typeof value === 'string') {
      for (const pattern of matchesSensitivePattern(value, sensitivePatterns)) {
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
        for (const pattern of matchesSensitiveKey(key, sensitivePatterns)) {
          hits.push({ path: nextPath, pattern: `key:${pattern}` })
        }
        walk(entry, nextPath)
      }
    }
  }
  walk(data, '')

  const unauthorizedHits = hits.filter((hit) => {
    const authorizedRosterPhone = route === 'packages/admin/event-registrations/index'
      && data?.canViewSensitiveRoster === true
      && /^items\[\d+\]\.phoneNumber$/.test(hit.path)
      && ['key:phonenumber', 'key:phone_number', 'raw-phone-like'].includes(hit.pattern)
    return !authorizedRosterPhone
  })
  assert(
    unauthorizedHits.length === 0,
    `${route} page data contains sensitive values: ${JSON.stringify(unauthorizedHits.slice(0, 8))}`,
  )
}

function evaluateRouteState(route, data) {
  const state = data?.state ?? data?.result
  const accepted = acceptedStates(route)
  if (accepted.includes(state)) {
    return { status: 'passed', state }
  }
  if (failedStates.has(state)) {
    return {
      status: 'failed',
      state,
      error: `${route.path} settled on ${state}; error/forbidden/conflict/expired/disabled cannot count as runtime success`,
    }
  }
  if (state && !pendingStates.has(state)) {
    return {
      status: 'failed',
      state,
      error: `${route.path} settled on unaccepted state ${state}; expected ${accepted.join(' or ')}`,
    }
  }
  return { status: 'pending', state }
}

async function waitForPageData(page, route, sensitivePatterns, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastData
  while (Date.now() < deadline) {
    lastData = await retry(`read data ${route.path}`, () => page.data())
    assertNoSensitivePageData(lastData, route.path, sensitivePatterns)
    const evaluation = evaluateRouteState(route, lastData)
    if (evaluation.status !== 'pending') {
      return { ...evaluation, data: lastData }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return {
    status: 'failed',
    state: lastData?.state ?? lastData?.result,
    data: lastData,
    error: `${route.path} did not settle before timeout`,
  }
}

function buildDeviceRequiredReport(runtimePages) {
  return (runtimePages.deviceRequiredCapabilities || []).map(capability => ({
    id: capability.id,
    label: capability.label,
    routes: capability.routes || [],
    reason: capability.reason,
    status: 'DEVICE_REQUIRED_NOT_VERIFIED',
  }))
}

function publicPageState(data) {
  const result = {}
  for (const key of [
    'state',
    'result',
    'mode',
    'view',
    'paymentEnabled',
    'isPlayer',
    'authenticated',
    'saving',
    'deleting',
    'recording',
    'generating',
    'conflict',
  ]) {
    if (['string', 'boolean', 'number'].includes(typeof data?.[key])) {
      result[key] = data[key]
    }
  }
  for (const key of [
    'events',
    'opportunities',
    'cooperationCards',
    'plans',
    'profiles',
    'orders',
    'items',
    'drafts',
    'branches',
  ]) {
    if (Array.isArray(data?.[key])) {
      result[`${key}Count`] = data[key].length
    }
  }
  if (typeof data?.message === 'string' && data.message) {
    result.message = sanitizeRuntimeValue(data.message)
  }
  return result
}

function outputName(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
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

function isScreenshotCaptureError(error) {
  return error instanceof Error && error.message.includes('fail to capture screenshot')
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

function compare(baselinePath, currentPath, diffPath) {
  const result = comparePngBuffers(fs.readFileSync(baselinePath), fs.readFileSync(currentPath))
  fs.writeFileSync(diffPath, result.diffBuffer)
  assert(result.diffRatio <= 0.001, `Visual regression exceeded 0.1%: ${(result.diffRatio * 100).toFixed(3)}%`)
  return result
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

function writeArtifacts(report, diagnostics) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(consolePath, `${JSON.stringify({
    summary: diagnostics.summary(),
    entries: diagnostics.entries(),
  }, null, 2)}\n`)
}

function representativeStateScenarios(runtimePages) {
  const routes = new Map(runtimePages.routes.map(route => [route.path, route]))
  const definitions = [
    {
      id: 'loading',
      route: 'pages/membership/index',
      patch: { state: 'loading' },
      verify: data => data.state === 'loading',
    },
    {
      id: 'empty',
      route: 'packages/member/mip-branches/index',
      patch: { state: 'empty', branches: [] },
      verify: data => data.state === 'empty' && Array.isArray(data.branches) && data.branches.length === 0,
    },
    {
      id: 'error',
      route: 'pages/membership/index',
      patch: { state: 'error', message: '暂时无法加载' },
      verify: data => data.state === 'error',
    },
    {
      id: 'forbidden',
      route: 'packages/admin/dashboard/index',
      patch: { state: 'forbidden', message: '' },
      verify: data => data.state === 'forbidden',
    },
    {
      id: 'conflict',
      route: 'packages/admin/events/index',
      patch: { state: 'ready', conflict: true, cancelConflict: false, message: '活动信息已更新' },
      verify: data => data.state === 'ready' && data.conflict === true,
    },
    {
      id: 'disabled',
      route: 'packages/member/mip-ai/index',
      patch: {
        state: 'ready',
        capability: { textDrafts: false, voiceDrafts: false },
        drafts: [],
        recording: false,
        generating: false,
      },
      verify: data => data.state === 'ready'
        && data.capability?.textDrafts === false
        && data.capability?.voiceDrafts === false,
    },
  ]
  for (const scenario of definitions) {
    assert(routes.has(scenario.route), `Representative ${scenario.id} route is missing: ${scenario.route}`)
    scenario.contract = routes.get(scenario.route)
  }
  return definitions
}

async function forceRepresentativeState(page, scenario) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await retry(`set representative ${scenario.id}`, () => page.setData(scenario.patch))
    await new Promise(resolve => setTimeout(resolve, 120))
    const data = await retry(`read representative ${scenario.id}`, () => page.data())
    if (scenario.verify(data)) {
      return data
    }
  }
  throw new Error(`Representative ${scenario.id} state did not remain active long enough to verify`)
}

async function verifyRepresentativeStates(miniProgram, runtimePages, report, sensitivePatterns) {
  report.representativeStates = []
  for (const scenario of representativeStateScenarios(runtimePages)) {
    const page = await retry(`representative ${scenario.id}`, () => miniProgram.reLaunch(`/${scenario.route}`))
    await retry(
      `wait representative ${scenario.id}`,
      () => page.waitForRendered({ selector: scenario.contract.selector, timeout: 15000 }),
    )
    const data = await forceRepresentativeState(page, scenario)
    assertNoSensitivePageData(data, scenario.route, sensitivePatterns)
    const screenshotPath = path.join(outputDir, `state-${scenario.id}.png`)
    await captureScreenshot(`state-${scenario.id}`, miniProgram, screenshotPath)
    const sizeBytes = fs.statSync(screenshotPath).size
    assert(sizeBytes >= 4 * 1024, `Representative ${scenario.id} screenshot is suspiciously small`)
    report.representativeStates.push({ id: scenario.id, route: scenario.route, status: 'passed', sizeBytes })
    console.log(`PASS  state:${scenario.id}  ${scenario.route}`)
  }
}

async function verifyContractedPages(miniProgram, runtimePages, report, options) {
  const { sensitivePatterns, updateBaseline } = options
  report.pages = []
  for (const route of runtimePages.routes) {
    const name = outputName(route.path)
    const baseline = path.join(baselineDir, `${name}.png`)
    const current = path.join(outputDir, `${name}.png`)
    const diff = path.join(outputDir, `${name}.diff.png`)
    const query = queryForRoute(route)
    const launchRoute = `/${route.path}${query ? `?${query}` : ''}`
    try {
      const page = await retry(`reLaunch ${route.path}`, () => miniProgram.reLaunch(launchRoute))
      await retry(`wait ${route.selector}`, () => page.waitForRendered({ selector: route.selector, timeout: 15000 }))
      assert(String(page.path || '').replace(/^\//, '') === route.path, `Unexpected runtime route: ${page.path}`)
      const settled = await waitForPageData(page, route, sensitivePatterns)
      await new Promise(resolve => setTimeout(resolve, 600))
      const screenshotData = await retry(`confirm data ${route.path}`, () => page.data())
      assertNoSensitivePageData(screenshotData, route.path, sensitivePatterns)
      const confirmed = evaluateRouteState(route, screenshotData)
      const status = settled.status === 'passed' && confirmed.status === 'passed' ? 'passed' : 'failed'
      const error = settled.error || confirmed.error

      await captureScreenshot(route.path, miniProgram, current)
      const sizeBytes = fs.statSync(current).size
      assert(sizeBytes >= 8 * 1024, `Screenshot is suspiciously small: ${route.path}`)
      const result = {
        route: route.path,
        selector: route.selector,
        queryMode: query ? 'safe-placeholder-uuid' : 'none',
        status,
        sizeBytes,
        mode: updateBaseline ? 'baseline-candidate' : fs.existsSync(baseline) ? 'compare' : 'capture',
        publicState: publicPageState(screenshotData || settled.data),
      }
      if (error) {
        result.error = sanitizeRuntimeValue(error)
      }
      if (status === 'passed' && !updateBaseline && fs.existsSync(baseline)) {
        Object.assign(result, compare(baseline, current, diff))
      }
      report.pages.push(result)
      console.log(`${status === 'passed' ? 'PASS' : 'FAIL'}  ${route.path}  ${Math.round(sizeBytes / 1024)} KB`)
    }
    catch (error) {
      if (isRecoverableRuntimeConnectionError(error) || isScreenshotCaptureError(error)) {
        throw error
      }
      report.pages.push({
        route: route.path,
        selector: route.selector,
        queryMode: query ? 'safe-placeholder-uuid' : 'none',
        status: 'failed',
        error: sanitizeRuntimeValue(error instanceof Error ? error.message : error),
      })
      console.log(`FAIL  ${route.path}`)
    }
  }
}

async function verifyNavigation(miniProgram, runtimePages, report, sensitivePatterns) {
  const tabs = runtimePages.routes.filter(route => route.tab)
  report.navigation = { tabs: [], back: null, deepLink: null }
  for (const route of tabs) {
    const page = await retry(`switch tab ${route.path}`, () => miniProgram.switchTab(`/${route.path}`))
    await retry(`wait tab ${route.path}`, () => page.waitForRendered({ selector: route.selector, timeout: 15000 }))
    assert(String(page.path || '').replace(/^\//, '') === route.path, `Tab opened unexpected route: ${page.path}`)
    const settled = await waitForPageData(page, route, sensitivePatterns, 12000)
    report.navigation.tabs.push({ route: route.path, status: settled.status, state: settled.state })
  }

  const homeRoute = runtimePages.routes.find(route => route.path === 'pages/index/index')
  const returnRoute = runtimePages.routes.find(route => route.path === 'packages/member/help/index')
  assert(homeRoute && returnRoute, 'Runtime navigation contract is missing home/help')
  const home = await retry('return flow home', () => miniProgram.reLaunch('/pages/index/index'))
  await retry('wait return flow home', () => home.waitForRendered({ selector: homeRoute.selector, timeout: 15000 }))
  const secondary = await retry('open secondary page', () => miniProgram.navigateTo('/packages/member/help/index'))
  await retry('wait secondary page', () => secondary.waitForRendered({ selector: returnRoute.selector, timeout: 15000 }))
  const returned = await retry('navigate back', () => miniProgram.navigateBack())
  await retry('wait returned home', () => returned.waitForRendered({ selector: homeRoute.selector, timeout: 15000 }))
  report.navigation.back = {
    status: returned.path === 'pages/index/index' ? 'passed' : 'failed',
    from: returnRoute.path,
    to: String(returned.path || ''),
  }

  const deepRoute = runtimePages.routes.find(route => route.group === 'public' && (route.query || []).length > 0)
    || runtimePages.routes.find(route => (route.query || []).length > 0)
  assert(deepRoute, 'Runtime contract has no query deep-link route')
  const deepQuery = queryForRoute(deepRoute)
  const deepPage = await retry('open safe deep link', () => miniProgram.reLaunch(`/${deepRoute.path}?${deepQuery}`))
  await retry('wait safe deep link root', () => deepPage.waitForRendered({ selector: deepRoute.selector, timeout: 15000 }))
  const deepResult = await waitForPageData(deepPage, deepRoute, sensitivePatterns, 12000)
  report.navigation.deepLink = {
    route: deepRoute.path,
    queryMode: 'safe-placeholder-uuid',
    rootReached: true,
    status: deepResult.status,
    state: deepResult.state,
    error: deepResult.error ? sanitizeRuntimeValue(deepResult.error) : undefined,
  }
}

function resetRuntimeArtifacts() {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(baselineDir, { recursive: true })
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.rmSync(path.join(outputDir, entry.name))
    }
  }
}

export async function main(runArgs = process.argv.slice(2)) {
  const runtimePages = JSON.parse(fs.readFileSync(runtimePagesPath, 'utf8'))
  validateRuntimeContract(runtimePages)
  if (runArgs.includes('--map-only') || runArgs.includes('--offline-only') || runArgs.includes('--contract-only')) {
    console.log(`MIP runtime contract passed (${runtimePages.routeCount} routes)`)
    return { status: 'contract-passed', routeCount: runtimePages.routeCount }
  }

  installMiniprogramAutomatorCompatibility()
  const skipBuild = runArgs.includes('--skip-build')
  const updateBaseline = runArgs.includes('--update-baseline')
  const requireBaseline = runArgs.includes('--require-baseline')
  const devtoolsRoot = process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT
    ? path.resolve(process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT)
    : root
  const sensitivePatterns = Array.isArray(runtimePages.sensitivePatterns) ? runtimePages.sensitivePatterns : []
  const runtimeRoutes = runtimePages.routes.map(route => route.path)

  resetRuntimeArtifacts()
  if (requireBaseline && !updateBaseline) {
    for (const route of runtimePages.routes) {
      assert(fs.existsSync(path.join(baselineDir, `${outputName(route.path)}.png`)), `Missing baseline for ${route.path}`)
    }
  }
  if (!skipBuild) {
    run('pnpm', ['build'])
  }

  const report = {
    status: 'running',
    updateBaseline,
    pages: [],
    attempts: [],
    recoveries: [],
    representativeStates: [],
    deviceRequired: buildDeviceRequiredReport(runtimePages),
    routeContract: {
      source: 'config/runtime-pages.json',
      routeCount: runtimePages.routeCount,
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

  await new Promise(resolve => setTimeout(resolve, 1500))
  const devToolsLogSnapshot = snapshotDevToolsLogs()

  async function runRuntimeAttempt(preferOpenedSession) {
    if (await clearStaleAutomatorPortLease(baseRuntimeOptions.port)) {
      report.recoveries.push({ action: 'cleared-stale-port-lease', port: baseRuntimeOptions.port })
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
    miniProgram.on('console', payload => diagnostics.captureConsole(payload))
    miniProgram.on('exception', payload => diagnostics.captureException(payload))

    await verifyRepresentativeStates(miniProgram, runtimePages, report, sensitivePatterns)
    await verifyContractedPages(miniProgram, runtimePages, report, { sensitivePatterns, updateBaseline })
    await verifyNavigation(miniProgram, runtimePages, report, sensitivePatterns)

    const failedPages = report.pages.filter(page => page.status !== 'passed')
    const failedTabs = report.navigation.tabs.filter(tab => tab.status !== 'passed')
    assert(
      failedPages.length === 0,
      `${failedPages.length} contracted page(s) did not reach an accepted state; service errors are not runtime success`,
    )
    assert(failedTabs.length === 0, `${failedTabs.length} primary tab(s) did not reach an accepted state`)
    assert(report.navigation.back?.status === 'passed', 'Secondary-page return path failed')
    assert(report.navigation.deepLink?.status === 'passed', 'Safe deep link reached an error instead of an accepted state')
  }

  try {
    report.preflight = await assertRuntimePreflight(devtoolsRoot, {
      sourceRoot: devtoolsRoot === root ? 'src' : 'dist',
      requirePublicAppId: devtoolsRoot !== root,
      requiredRoutes: runtimeRoutes,
    })
    const openedAutomatorAvailable = await isLocalPortListening(baseRuntimeOptions.port)
    if (!openedAutomatorAvailable) {
      await warmWechatDevtoolsProject({ projectPath: devtoolsRoot })
      report.recoveries.push({ action: 'prewarmed-devtools-project' })
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const preferOpenedSession = attempt === 1 && openedAutomatorAvailable
      try {
        await runRuntimeAttempt(preferOpenedSession)
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
        report.pages = []
        report.representativeStates = []
        report.navigation = undefined
        await warmWechatDevtoolsProject({ projectPath: devtoolsRoot, restart: true })
      }
    }

    await new Promise(resolve => setTimeout(resolve, 300))
    report.diagnostics = diagnostics.summary()
    report.ideCompilerDiagnostics = inspectDevToolsCompilerLogs(devToolsLogSnapshot)
    const diagnosticFailures = diagnostics.failures()
    assert(diagnosticFailures.length === 0, `Runtime diagnostics reported ${diagnosticFailures.length} error(s) or unknown warning(s)`)
    assert(report.ideCompilerDiagnostics.failures === 0, `WeChat DevTools compiler reported ${report.ideCompilerDiagnostics.failures} build/HMR error(s)`)
    assert(report.pages.length === runtimePages.routeCount, `Runtime verifier covered ${report.pages.length}/${runtimePages.routeCount} routes`)
    assert(report.representativeStates.length === 6, 'Runtime verifier did not cover all representative states')

    if (updateBaseline) {
      for (const route of runtimePages.routes) {
        fs.copyFileSync(
          path.join(outputDir, `${outputName(route.path)}.png`),
          path.join(baselineDir, `${outputName(route.path)}.png`),
        )
      }
    }
    report.deviceRequired = buildDeviceRequiredReport(runtimePages)
    report.status = 'passed'
  }
  catch (error) {
    report.status = 'failed'
    report.diagnostics = diagnostics.summary()
    report.ideCompilerDiagnostics ??= inspectDevToolsCompilerLogs(devToolsLogSnapshot)
    report.deviceRequired = buildDeviceRequiredReport(runtimePages)
    report.error = sanitizeRuntimeValue(error instanceof Error ? error.message : error)
    throw error
  }
  finally {
    const cleanupStatus = await Promise.race([
      miniProgram
        ? closeSharedMiniProgram(devtoolsRoot, sessionId).then(() => 'closed').catch(() => 'failed')
        : Promise.resolve('not-opened'),
      new Promise(resolve => setTimeout(resolve, 5000, 'timed-out')),
    ])
    report.cleanup = { status: cleanupStatus }
    report.deviceRequired ??= buildDeviceRequiredReport(runtimePages)
    writeArtifacts(report, diagnostics)
  }
  return report
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === directEntry) {
  main().catch((error) => {
    console.error(sanitizeRuntimeValue(error instanceof Error ? error.message : error))
    process.exitCode = 1
  })
}
