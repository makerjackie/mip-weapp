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
  assertViewportEvidence,
  createObservedViewportEvidence,
  createPendingViewportEvidence,
  prepareRuntimeEvidenceDirectory,
  resolveRuntimeEvidenceOptions,
} from './lib/runtime-evidence.mjs'
import {
  createRuntimeDiagnostics,
  isRecoverableRuntimeConnectionError,
  readRuntimeWarningAllowlist,
  sanitizeRuntimeValue,
} from './lib/runtime-observability.mjs'
import { assertRuntimePreflight } from './lib/runtime-preflight.mjs'
import { assertReadyAssertion, parseReadyAssertion } from './lib/runtime-ready-assertion.mjs'
import { prepareRuntimeDevtools } from './lib/runtime-startup.mjs'
import { comparePngBuffers } from './lib/visual-diff.mjs'

const root = path.resolve(import.meta.dirname, '..')
let outputDir = path.join(root, '.tmp', 'runtime')
const baselineDir = path.join(root, '.screenshots', 'baseline')
let reportPath = path.join(outputDir, 'report.json')
let consolePath = path.join(outputDir, 'console.json')
const warningAllowlistPath = path.join(root, 'config', 'runtime-warning-allowlist.json')
const runtimePagesPath = path.join(root, 'config', 'runtime-pages.json')
const sessionId = 'mip-weapp-runtime'
const failedStates = new Set(['error', 'forbidden', 'conflict', 'expired', 'disabled', 'failed'])
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

function pathValue(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], value)
}

function isRuntimeDataPath(value, { allowArrayIndex = false } = {}) {
  const segment = allowArrayIndex ? '(?:[a-z]\\w*|\\d+)' : '[a-z]\\w*'
  return new RegExp(`^[a-z]\\w*(?:\\.${segment})*$`, 'i').test(value || '')
}

function pendingStatesFor(route) {
  return new Set([...pendingStates, ...(route.pendingStates || [])])
}

export function resolveQueryFixtureValues(route, data) {
  const fixture = route.queryFixture
  const candidateValue = pathValue(data, fixture.dataPath)
  const candidates = Array.isArray(candidateValue)
    ? candidateValue
    : candidateValue && typeof candidateValue === 'object'
      ? [candidateValue]
      : []
  const candidate = candidates.find(item => (
    Object.entries(fixture.where || {}).every(
      ([keyPath, expected]) => Object.is(pathValue(item, keyPath), expected),
    )
    && Object.values(fixture.values).every((keyPath) => {
      const value = pathValue(item, keyPath)
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  ))
  if (!candidate) {
    return {
      status: 'external-wait',
      reason: `${route.path} requires a real fixture at ${fixture.sourceRoute}:${fixture.dataPath}`,
    }
  }
  const values = Object.fromEntries(Object.entries(fixture.values).map(([key, keyPath]) => [
    key,
    pathValue(candidate, keyPath),
  ]))
  const missing = (route.query || []).filter((key) => {
    const value = values[key]
    return value === undefined || value === null || String(value).trim() === ''
  })
  if (missing.length) {
    return {
      status: 'external-wait',
      reason: `${route.path} fixture is missing ${missing.join(', ')}`,
    }
  }
  return { status: 'resolved', values }
}

function representativeDataMatches(data, scenario) {
  return (scenario.dataAssertions || []).every(assertion => (
    Object.is(pathValue(data, assertion.path), assertion.equals)
  ))
}

function assertInteractionData(data, journey, step) {
  for (const assertion of step.dataAssertions || []) {
    const value = pathValue(data, assertion.path)
    assert(
      Object.is(value, assertion.equals),
      `Interaction ${journey.id}/${step.id} expected ${assertion.path}=${JSON.stringify(assertion.equals)}, received ${JSON.stringify(value)}`,
    )
  }
}

function interactionDataMatches(data, step) {
  return (step.dataAssertions || []).every(assertion => (
    Object.is(pathValue(data, assertion.path), assertion.equals)
  ))
}

export function interactionTargetViewportEvidence(nodes, systemInfo) {
  const viewportHeight = Number(systemInfo?.windowHeight)
  const viewportWidth = Number(systemInfo?.windowWidth)
  if (
    !Number.isFinite(viewportHeight)
    || viewportHeight <= 0
    || !Number.isFinite(viewportWidth)
    || viewportWidth <= 0
    || !Array.isArray(nodes)
  ) {
    return null
  }
  for (const node of nodes) {
    const top = Number(node?.top)
    const left = Number(node?.left)
    const height = Number(node?.height)
    const width = Number(node?.width)
    const reportedBottom = Number(node?.bottom)
    const reportedRight = Number(node?.right)
    const bottom = Number.isFinite(reportedBottom) ? reportedBottom : top + height
    const right = Number.isFinite(reportedRight) ? reportedRight : left + width
    if (
      Number.isFinite(top)
      && Number.isFinite(bottom)
      && Number.isFinite(left)
      && Number.isFinite(right)
      && width > 0
      && height > 0
      && top >= 0
      && bottom <= viewportHeight
      && left >= 0
      && right <= viewportWidth
    ) {
      return {
        top,
        bottom,
        left,
        right,
        width,
        height,
        windowHeight: viewportHeight,
        windowWidth: viewportWidth,
      }
    }
  }
  return null
}

async function assertInteractionTargetInViewport(page, miniProgram, journey, step) {
  const [nodes, systemInfo] = await Promise.all([
    page.renderedNodes(step.selector, { routeOnly: true }),
    miniProgram.systemInfo(),
  ])
  const evidence = interactionTargetViewportEvidence(nodes, systemInfo)
  assert(evidence, `Interaction ${journey.id}/${step.id} target is outside the measured viewport`)
  return evidence
}

export async function queryFreshRenderedActionElement(page, selector) {
  // Dynamic wx:if branches can reuse an elementId after replacing the node, while
  // miniprogram-automator keeps the old handle in Page.elementMap.
  page?.elementMap?.clear?.()
  return await page.$(selector, { fallback: false })
}

async function waitForInteractionData(page, step, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const data = await page.data(undefined, { routeOnly: true }).catch(() => undefined)
    if (data && interactionDataMatches(data, step)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

async function invokeInteractionHandler(page, step) {
  await page.callMethodWithOptions(
    step.handler,
    { routeOnly: true },
    {
      detail: step.type === 'input' ? { value: step.value } : {},
      currentTarget: { dataset: step.handlerDataset || {} },
    },
  )
  return await waitForInteractionData(page, step)
}

async function assertInteractionVisible(page, step) {
  try {
    if (step.visibleAssertion?.selector) {
      await page.waitForRendered({ selector: step.visibleAssertion.selector, timeout: 1500 })
    }
    if (step.visibleAssertion?.text) {
      await page.waitForRendered({ text: step.visibleAssertion.text, timeout: 1500 })
    }
    return 'render-query'
  }
  catch (error) {
    const message = String(error instanceof Error ? error.message : error)
    if (!message.includes('Timed out waiting page rendered') && !message.includes('Failed to find page element')) {
      throw error
    }
    return 'source-data-screenshot'
  }
}

function acceptedStates(route) {
  if (Array.isArray(route.acceptStates) && route.acceptStates.length > 0) {
    return route.acceptStates
  }
  if (route.kind === 'result') {
    const pending = pendingStatesFor(route)
    return (route.states || []).filter(state => !failedStates.has(state) && !pending.has(state))
  }
  return ['ready']
}

function validateRuntimeContract(runtimePages) {
  assert(runtimePages?.schemaVersion === 2, 'runtime-pages.json schemaVersion must be 2')
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
  let protectedAccessFixtureCount = 0
  const routesByPath = new Map(runtimePages.routes.map(route => [route.path, route]))
  for (const route of runtimePages.routes) {
    assert(route?.id && route.path && route.selector, `Incomplete runtime route: ${JSON.stringify(route)}`)
    assert(!seenPaths.has(route.path), `Duplicate runtime route: ${route.path}`)
    assert(!seenIds.has(route.id), `Duplicate runtime route id: ${route.id}`)
    seenPaths.add(route.path)
    seenIds.add(route.id)
    parseReadyAssertion(route.readyAssertion, route.path)
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
    const pending = pendingStatesFor(route)
    assert(
      route.allowedSensitivePaths === undefined || Array.isArray(route.allowedSensitivePaths),
      `${route.path} allowedSensitivePaths must be an array`,
    )
    for (const allowedPath of route.allowedSensitivePaths || []) {
      assert(
        typeof allowedPath === 'string' && /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/i.test(allowedPath),
        `${route.path} has an unsafe allowed sensitive path`,
      )
    }
    if (route.allowedSensitivePaths !== undefined) {
      assert(
        route.path === 'packages/member/mip-card/index'
        && JSON.stringify(route.allowedSensitivePaths) === JSON.stringify(['phone']),
        `${route.path} is not allowed to retain sensitive page data`,
      )
    }
    assert(route.externalWaitStates === undefined || Array.isArray(route.externalWaitStates), `${route.path} externalWaitStates must be an array`)
    const externalWait = new Set(route.externalWaitStates || [])
    assert(accepted.length > 0, `${route.path} does not declare an accepted runtime state`)
    assert(
      accepted.every(state => !failedStates.has(state) && !pending.has(state)),
      `${route.path} accepts a failure or pending state as runtime success`,
    )
    assert(
      [...externalWait].every(state => states.includes(state) && !accepted.includes(state) && !pending.has(state)),
      `${route.path} externalWaitStates must be declared non-success terminal states`,
    )
    for (const key of route.query || []) {
      assert(/^[a-z][a-z0-9]*$/i.test(key), `${route.path} has an unsafe query key`)
    }
    const protectedAccessFixture = route.protectedAccessFixture
    if (protectedAccessFixture !== undefined) {
      protectedAccessFixtureCount += 1
      assert(route.path === 'packages/member/mip-access/index', 'Protected access fixture may only target the access page')
      assert(
        JSON.stringify(route.query || []) === JSON.stringify(['token']),
        'Protected access fixture must resolve exactly one opaque token query',
      )
      assert(route.queryFixture === undefined, 'Protected access fixture cannot also declare queryFixture')
      assert(protectedAccessFixture?.kind === 'local-sign-out-global-guard', 'Protected access fixture kind is invalid')
      assert(protectedAccessFixture.sourceRoute === 'packages/member/privacy/index', 'Protected access fixture source route is invalid')
      assert(protectedAccessFixture.sourceSelector === '#privacy-sign-out', 'Protected access fixture source selector is invalid')
      assert(protectedAccessFixture.sourceHandler === 'signOutLocally', 'Protected access fixture source handler is invalid')
      assert(protectedAccessFixture.confirmationMethod === 'showModal', 'Protected access fixture confirmation method is invalid')
      assert(protectedAccessFixture.expectedIntentAction === 'ENTER_APP', 'Protected access fixture must use the global ENTER_APP guard')
      assert(protectedAccessFixture.expectedNextRequirement === 'AUTHENTICATED', 'Protected access fixture must prove the signed-out access state')
      assert(protectedAccessFixture.restoreSelector === '#mip-access-sign-in', 'Protected access fixture restore selector is invalid')
      assert(protectedAccessFixture.restoreHandler === 'signIn', 'Protected access fixture restore handler is invalid')
      assert(protectedAccessFixture.restoreRoute === 'pages/index/index', 'Protected access fixture restore route is invalid')
      const sourceRoute = routesByPath.get(protectedAccessFixture.sourceRoute)
      const restoreRoute = routesByPath.get(protectedAccessFixture.restoreRoute)
      assert(sourceRoute && !(sourceRoute.query || []).length, 'Protected access fixture source route must be query-free')
      assert(restoreRoute && !(restoreRoute.query || []).length, 'Protected access fixture restore route must be query-free')
      const sourceWxml = fs.readFileSync(path.join(root, 'src', `${sourceRoute.path}.wxml`), 'utf8')
      const sourceTs = fs.readFileSync(path.join(root, 'src', `${sourceRoute.path}.ts`), 'utf8')
      const accessTs = fs.readFileSync(path.join(root, 'src', `${route.path}.ts`), 'utf8')
      assert(sourceWxml.includes(`id="${selectorId(protectedAccessFixture.sourceSelector)}"`), 'Protected access fixture source selector is not a native node')
      assert(sourceWxml.includes(`bind:tap="${protectedAccessFixture.sourceHandler}"`), 'Protected access fixture source handler is not UI-bound')
      assert(sourceTs.includes('mipGlobalAccessGuard.enterTarget('), 'Protected access fixture source no longer enters the global guard')
      assert(wxml.includes(`id="${selectorId(protectedAccessFixture.restoreSelector)}"`), 'Protected access fixture restore selector is not a native node')
      assert(wxml.includes(`bind:tap="${protectedAccessFixture.restoreHandler}"`), 'Protected access fixture restore handler is not UI-bound')
      assert(accessTs.includes('mipIdentityModule.signIn('), 'Protected access fixture restore no longer reloads the server identity')
    }
    if ((route.query || []).length && !protectedAccessFixture) {
      const fixture = route.queryFixture
      assert(fixture && typeof fixture === 'object', `${route.path} queryFixture is required`)
      const sourceRoute = routesByPath.get(fixture.sourceRoute)
      assert(sourceRoute, `${route.path} queryFixture source route is missing: ${fixture.sourceRoute}`)
      assert(!(sourceRoute.query || []).length, `${route.path} queryFixture source cannot require its own query`)
      assert(isRuntimeDataPath(fixture.dataPath), `${route.path} queryFixture dataPath is invalid`)
      assert(fixture.values && typeof fixture.values === 'object', `${route.path} queryFixture values are required`)
      assert(
        JSON.stringify(Object.keys(fixture.values).sort()) === JSON.stringify([...route.query].sort()),
        `${route.path} queryFixture values must match query keys`,
      )
      for (const keyPath of Object.values(fixture.values)) {
        assert(isRuntimeDataPath(keyPath, { allowArrayIndex: true }), `${route.path} queryFixture value path is invalid`)
      }
      for (const keyPath of Object.keys(fixture.where || {})) {
        assert(isRuntimeDataPath(keyPath), `${route.path} queryFixture where path is invalid`)
      }
      if (fixture.sourceQuery !== undefined) {
        assert(fixture.sourceQuery && typeof fixture.sourceQuery === 'object'
          && !Array.isArray(fixture.sourceQuery), `${route.path} queryFixture sourceQuery is invalid`)
        for (const [key, value] of Object.entries(fixture.sourceQuery)) {
          assert(/^[a-z][a-z0-9]*$/i.test(key), `${route.path} queryFixture sourceQuery key is unsafe`)
          assert(typeof value === 'string' && value.trim() && value.length <= 128, `${route.path} queryFixture sourceQuery value is invalid`)
        }
      }
    }
  }
  assert(protectedAccessFixtureCount === 1, 'Runtime contract must declare exactly one protected access fixture')

  const capabilities = runtimePages.deviceRequiredCapabilities || []
  const capabilityIds = new Set()
  for (const capability of capabilities) {
    assert(capability?.id && !capabilityIds.has(capability.id), `Invalid or duplicate device capability: ${capability?.id}`)
    capabilityIds.add(capability.id)
    assert(Array.isArray(capability.routes) && capability.routes.length > 0, `${capability.id} must declare routes[]`)
    for (const routePath of capability.routes) {
      const route = routesByPath.get(routePath)
      assert(route, `${capability.id} references an inactive route: ${routePath}`)
      assert((route.deviceRequired || []).includes(capability.id), `${routePath} is missing deviceRequired ${capability.id}`)
    }
  }
  for (const route of runtimePages.routes) {
    for (const capabilityId of route.deviceRequired || []) {
      const capability = capabilities.find(item => item.id === capabilityId)
      assert(capability, `${route.path} references an unknown device capability: ${capabilityId}`)
      assert(capability.routes.includes(route.path), `${capabilityId} is missing route ${route.path}`)
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

  const representativeStates = runtimePages.representativeStates
  assert(Array.isArray(representativeStates), 'runtime-pages.json representativeStates[] is required')
  assert(
    JSON.stringify(representativeStates.map(scenario => scenario.id).sort())
    === JSON.stringify(['conflict', 'disabled', 'empty', 'error', 'forbidden', 'loading']),
    'Runtime contract must define loading, empty, error, forbidden, conflict, and disabled evidence',
  )
  for (const scenario of representativeStates) {
    const route = runtimePages.routes.find(candidate => candidate.path === scenario.route)
    assert(route, `Representative ${scenario.id} route is missing: ${scenario.route}`)
    assert(scenario.patch && typeof scenario.patch === 'object' && !Array.isArray(scenario.patch), `Representative ${scenario.id} patch is required`)
    assert(Array.isArray(scenario.dataAssertions) && scenario.dataAssertions.length > 0, `Representative ${scenario.id} dataAssertions[] is required`)
    for (const dataAssertion of scenario.dataAssertions) {
      assert(/^[a-z]\w*(?:\.[a-z]\w*)*$/i.test(dataAssertion?.path || ''), `Representative ${scenario.id} has an invalid data path`)
      assert(Object.hasOwn(dataAssertion || {}, 'equals'), `Representative ${scenario.id} data assertion needs equals`)
    }
    const visible = scenario.visibleAssertion
    assert(typeof visible?.selector === 'string' && visible.selector.startsWith(route.selector), `Representative ${scenario.id} visible selector must be scoped to ${route.selector}`)
    const wxml = fs.readFileSync(path.join(root, 'src', `${route.path}.wxml`), 'utf8')
    for (const id of visible.selector.matchAll(/#([\w-]+)/g)) {
      assert(wxml.includes(`id="${id[1]}"`), `Representative ${scenario.id} selector #${id[1]} is missing from ${route.path}`)
    }
    if (Object.hasOwn(visible, 'text')) {
      assert(typeof visible.text === 'string' && visible.text.trim(), `Representative ${scenario.id} visible text must be non-empty`)
      assert(wxml.includes(visible.text), `Representative ${scenario.id} text is missing from ${route.path}`)
    }
  }

  const interactionJourneys = runtimePages.interactionJourneys
  assert(Array.isArray(interactionJourneys) && interactionJourneys.length >= 3, 'runtime-pages.json must define at least three interactionJourneys')
  const seenJourneyIds = new Set()
  for (const journey of interactionJourneys) {
    assert(journey?.id && !seenJourneyIds.has(journey.id), `Invalid or duplicate interaction journey id: ${journey?.id}`)
    seenJourneyIds.add(journey.id)
    const route = runtimePages.routes.find(candidate => candidate.path === journey.route)
    assert(route, `Interaction ${journey.id} route is missing: ${journey.route}`)
    assert(journey.nonMutating === true, `Interaction ${journey.id} must explicitly be nonMutating`)
    if (journey.scrollTop !== undefined) {
      assert(Number.isInteger(journey.scrollTop) && journey.scrollTop >= 0 && journey.scrollTop <= 10_000, `Interaction ${journey.id} scrollTop must be an integer from 0 to 10000`)
    }
    for (const key of ['requireVisibleTarget', 'requireRenderedAction', 'requireScreenshotDiff']) {
      if (journey[key] !== undefined) {
        assert(typeof journey[key] === 'boolean', `Interaction ${journey.id} ${key} must be boolean`)
      }
    }
    assert(Array.isArray(journey.steps) && journey.steps.length > 0, `Interaction ${journey.id} steps[] is required`)
    for (const step of journey.steps) {
      assert(step?.id && ['input', 'tap'].includes(step.type), `Interaction ${journey.id} has an invalid step`)
      assert(typeof step.selector === 'string' && step.selector.startsWith('#'), `Interaction ${journey.id}/${step.id} needs an id selector`)
      assert(/^[a-z]\w*$/i.test(step.handler || ''), `Interaction ${journey.id}/${step.id} needs a page handler`)
      if (step.scrollTop !== undefined) {
        assert(Number.isInteger(step.scrollTop) && step.scrollTop >= 0 && step.scrollTop <= 10_000, `Interaction ${journey.id}/${step.id} scrollTop must be an integer from 0 to 10000`)
      }
      if (step.scrollIntoView !== undefined) {
        assert(typeof step.scrollIntoView === 'boolean', `Interaction ${journey.id}/${step.id} scrollIntoView must be boolean`)
        assert(step.scrollTop === undefined, `Interaction ${journey.id}/${step.id} cannot combine scrollIntoView and scrollTop`)
      }
      for (const key of ['requireVisibleTarget', 'requireRenderedAction', 'requireScreenshotDiff']) {
        if (step[key] !== undefined) {
          assert(typeof step[key] === 'boolean', `Interaction ${journey.id}/${step.id} ${key} must be boolean`)
        }
      }
      const effectiveScroll = step.scrollIntoView === true ? 'selector' : step.scrollTop ?? journey.scrollTop
      const effectiveRequireVisibleTarget = (step.requireVisibleTarget ?? journey.requireVisibleTarget) === true
      const effectiveRequireScreenshotDiff = (step.requireScreenshotDiff ?? journey.requireScreenshotDiff) === true
      if (effectiveRequireVisibleTarget) {
        assert(effectiveScroll !== undefined, `Interaction ${journey.id}/${step.id} requires selector or numeric scrolling to prove target visibility`)
      }
      if (step.handlerDataset !== undefined) {
        assert(step.handlerDataset && typeof step.handlerDataset === 'object' && !Array.isArray(step.handlerDataset), `Interaction ${journey.id}/${step.id} handlerDataset must be an object`)
      }
      if (step.type === 'input') {
        assert(typeof step.value === 'string', `Interaction ${journey.id}/${step.id} input value is required`)
      }
      assert(Array.isArray(step.dataAssertions) && step.dataAssertions.length > 0, `Interaction ${journey.id}/${step.id} dataAssertions[] is required`)
      const wxml = fs.readFileSync(path.join(root, 'src', `${journey.route}.wxml`), 'utf8')
      const pageSource = `${wxml}\n${fs.readFileSync(path.join(root, 'src', `${journey.route}.ts`), 'utf8')}`
      assert(wxml.includes(`="${step.handler}"`), `Interaction ${journey.id}/${step.id} handler is not bound in ${journey.route}`)
      for (const dataAssertion of step.dataAssertions) {
        assert(/^[a-z]\w*(?:\.[a-z]\w*)*$/i.test(dataAssertion?.path || ''), `Interaction ${journey.id}/${step.id} has an invalid data path`)
        assert(Object.hasOwn(dataAssertion || {}, 'equals'), `Interaction ${journey.id}/${step.id} data assertion needs equals`)
      }
      if (step.visibleAssertion) {
        assert(
          typeof step.visibleAssertion.selector === 'string' || typeof step.visibleAssertion.text === 'string',
          `Interaction ${journey.id}/${step.id} visibleAssertion needs selector or text`,
        )
        if (step.visibleAssertion.selector) {
          for (const id of step.visibleAssertion.selector.matchAll(/#([\w-]+)/g)) {
            const exactId = `id="${id[1]}"`
            const dynamicPrefix = `id="${id[1].slice(0, id[1].lastIndexOf('-') + 1)}{{`
            assert(wxml.includes(exactId) || wxml.includes(dynamicPrefix), `Interaction ${journey.id}/${step.id} selector #${id[1]} is missing from ${journey.route}`)
          }
        }
        if (step.visibleAssertion.text) {
          assert(pageSource.includes(step.visibleAssertion.text), `Interaction ${journey.id}/${step.id} text is missing from ${journey.route}`)
        }
      }
      if (effectiveRequireScreenshotDiff) {
        assert(step.visibleAssertion, `Interaction ${journey.id}/${step.id} requires visibleAssertion for screenshot evidence`)
      }
    }
  }
}

export function queryForRoute(route, values = {}) {
  return (route.query || [])
    .map((key) => {
      const value = values[key]
      assert(value !== undefined && value !== null && String(value).trim(), `${route.path} query value is missing: ${key}`)
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    })
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

export function assertNoSensitivePageData(data, route, sensitivePatterns, allowedPaths = []) {
  const hits = []
  const allowed = new Set(allowedPaths)
  const walk = (value, keyPath) => {
    if (allowed.has(keyPath)) {
      return
    }
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

  assert(
    hits.length === 0,
    `${route} page data contains sensitive values: ${JSON.stringify(hits.slice(0, 8))}`,
  )
}

export function evaluateRouteState(route, data) {
  const state = data?.state ?? data?.result
  const accepted = acceptedStates(route)
  const pending = pendingStatesFor(route)
  if (accepted.includes(state)) {
    try {
      assertReadyAssertion(data, route.readyAssertion, route.path)
      return { status: 'passed', state }
    }
    catch (error) {
      return {
        status: 'failed',
        state,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  if ((route.externalWaitStates || []).includes(state)) {
    return {
      status: 'external-wait',
      state,
      error: `${route.path} requires a real runtime entry fixture for ${state}`,
    }
  }
  if (failedStates.has(state)) {
    return {
      status: 'failed',
      state,
      error: `${route.path} settled on ${state}; error/forbidden/conflict/expired/disabled cannot count as runtime success`,
    }
  }
  if (state && !pending.has(state)) {
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
    assertNoSensitivePageData(lastData, route.path, sensitivePatterns, route.allowedSensitivePaths)
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
      const message = error instanceof Error ? error.message : String(error)
      const protocolCallTimedOut = message.includes('DEVTOOLS_PROTOCOL_TIMEOUT')
        || message.includes('did not respond to protocol method')
      if ((isRecoverableRuntimeConnectionError(error) && !protocolCallTimedOut) || attempt === attempts) {
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
  const scenarios = runtimePages.representativeStates.map(scenario => ({ ...scenario }))
  for (const scenario of scenarios) {
    assert(routes.has(scenario.route), `Representative ${scenario.id} route is missing: ${scenario.route}`)
    scenario.contract = routes.get(scenario.route)
  }
  return scenarios
}

function representativeRenderedNodesMatch(nodes, scenario) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return false
  }
  const expectedText = scenario.visibleAssertion?.text
  return !expectedText || JSON.stringify(nodes).includes(expectedText)
}

export async function observeRepresentativeState(page, scenario) {
  const dataBefore = await page.data(undefined, { routeOnly: true })
  if (!representativeDataMatches(dataBefore, scenario)) {
    return null
  }
  const nodes = await page.renderedNodes(scenario.visibleAssertion.selector, { routeOnly: true })
  const dataAfter = await page.data(undefined, { routeOnly: true })
  if (!representativeDataMatches(dataAfter, scenario)
    || !representativeRenderedNodesMatch(nodes, scenario)) {
    return null
  }
  return {
    data: dataAfter,
    renderedNodeCount: nodes.length,
  }
}

async function waitForRepresentativeEvidence(page, scenario, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const evidence = await observeRepresentativeState(page, scenario)
      if (evidence) {
        return evidence
      }
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`Representative ${scenario.id} route-only data and rendered WXML did not align${detail}`)
}

async function forceRepresentativeState(page, scenario) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await retry(
      `set representative ${scenario.id}`,
      () => page.setData(scenario.patch),
    )
    try {
      return await waitForRepresentativeEvidence(page, scenario)
    }
    catch (error) {
      lastError = error
      // A late lifecycle response can overwrite the patch; reinject only after the failed evidence window.
    }
  }
  throw lastError || new Error(`Representative ${scenario.id} evidence was unavailable`)
}

async function waitForRepresentativeLifecycle(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const data = await retry('read representative lifecycle', () => page.data())
    if (data?.state !== 'loading') {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

async function assertRepresentativeVisible(page, scenario) {
  return await waitForRepresentativeEvidence(page, scenario)
}

async function verifyRepresentativeStates(miniProgram, runtimePages, report, sensitivePatterns) {
  report.representativeStates = []
  for (const scenario of representativeStateScenarios(runtimePages)) {
    const page = await navigateFreshRuntimeRoute(
      miniProgram,
      scenario.contract,
      `representative ${scenario.id}`,
      () => miniProgram.reLaunch(`/${scenario.route}`),
    )
    await waitForRepresentativeLifecycle(page)
    const beforeData = await retry(
      `read representative ${scenario.id} before state`,
      () => page.data(undefined, { routeOnly: true }),
    )
    const wasAlreadyTargetState = representativeDataMatches(beforeData, scenario)
    const beforePath = path.join(outputDir, `state-${scenario.id}-before.png`)
    await captureScreenshot(`state-${scenario.id}-before`, miniProgram, beforePath)
    const forcedEvidence = await forceRepresentativeState(page, scenario)
    const data = forcedEvidence.data
    assertNoSensitivePageData(data, scenario.route, sensitivePatterns)
    const visibleBeforeCapture = await assertRepresentativeVisible(page, scenario)
    const screenshotPath = path.join(outputDir, `state-${scenario.id}.png`)
    await captureScreenshot(`state-${scenario.id}`, miniProgram, screenshotPath)
    const visibleAfterCapture = await assertRepresentativeVisible(page, scenario)
    const sizeBytes = fs.statSync(screenshotPath).size
    assert(sizeBytes >= 4 * 1024, `Representative ${scenario.id} screenshot is suspiciously small`)
    const injectedDiffRatio = comparePngBuffers(
      fs.readFileSync(beforePath),
      fs.readFileSync(screenshotPath),
    ).diffRatio
    const visibleAssertionMode = wasAlreadyTargetState
      ? 'natural-route-data-render-query'
      : 'route-data-render-query'
    if (!wasAlreadyTargetState) {
      assert(injectedDiffRatio >= 0.001, `Representative ${scenario.id} did not produce a visible screenshot change`)
    }
    report.representativeStates.push({
      id: scenario.id,
      route: scenario.route,
      status: 'passed',
      sizeBytes,
      visibleAssertion: scenario.visibleAssertion,
      visibleAssertionMode,
      injectedDiffRatio,
      wasAlreadyTargetState,
      renderedNodeCount: Math.min(
        forcedEvidence.renderedNodeCount,
        visibleBeforeCapture.renderedNodeCount,
        visibleAfterCapture.renderedNodeCount,
      ),
    })
    console.log(`PASS  state:${scenario.id}  ${scenario.route}`)
  }
}

async function verifyInteractionJourneys(miniProgram, runtimePages, report, sensitivePatterns) {
  const routes = new Map(runtimePages.routes.map(route => [route.path, route]))
  report.interactions = []
  for (const journey of runtimePages.interactionJourneys) {
    const route = routes.get(journey.route)
    const result = { id: journey.id, route: journey.route, status: 'running', steps: [] }
    report.interactions.push(result)
    try {
      const page = await navigateFreshRuntimeRoute(
        miniProgram,
        route,
        `interaction ${journey.id}`,
        () => miniProgram.reLaunch(`/${journey.route}`),
      )
      const settled = await waitForPageData(page, route, sensitivePatterns, 12000)
      assert(settled.status === 'passed', `Interaction ${journey.id} route did not reach an accepted state`)

      for (const step of journey.steps) {
        const stepScrollTop = step.scrollTop ?? journey.scrollTop
        const requireVisibleTarget = (step.requireVisibleTarget ?? journey.requireVisibleTarget) === true
        const requireRenderedAction = (step.requireRenderedAction ?? journey.requireRenderedAction) === true
        const requireScreenshotDiff = (step.requireScreenshotDiff ?? journey.requireScreenshotDiff) === true
        if (step.scrollIntoView === true) {
          await retry(
            `scroll interaction ${journey.id}/${step.id}`,
            () => miniProgram.callWxMethod('pageScrollTo', { selector: step.selector, duration: 0 }),
          )
          await new Promise(resolve => setTimeout(resolve, 180))
        }
        else if (stepScrollTop !== undefined) {
          await retry(`scroll interaction ${journey.id}/${step.id}`, () => miniProgram.pageScrollTo(stepScrollTop))
          await new Promise(resolve => setTimeout(resolve, 180))
        }
        let viewportEvidence
        if (requireVisibleTarget && step.type === 'input') {
          viewportEvidence = await retry(
            `prove interaction target ${journey.id}/${step.id}`,
            () => assertInteractionTargetInViewport(page, miniProgram, journey, step),
          )
        }
        let visibleBeforePath = ''
        if (step.visibleAssertion) {
          visibleBeforePath = path.join(outputDir, `interaction-${outputName(journey.id)}-${outputName(step.id)}-before.png`)
          await captureScreenshot(`interaction-${journey.id}/${step.id}-before`, miniProgram, visibleBeforePath)
        }
        if (step.type === 'input') {
          await retry(`input interaction ${journey.id}/${step.id}`, async () => {
            const element = await page.$(step.selector)
            let actionError
            try {
              assert(element, `Interaction ${journey.id}/${step.id} selector was not rendered: ${step.selector}`)
              assert(typeof element.input === 'function', `Interaction ${journey.id}/${step.id} is not an input element`)
              await element.input(step.value)
            }
            catch (error) {
              actionError = error
            }
            if (actionError && requireRenderedAction) {
              throw actionError
            }
            if (!await waitForInteractionData(page, step)) {
              if (requireRenderedAction || !await invokeInteractionHandler(page, step)) {
                throw actionError || new Error(`Interaction ${journey.id}/${step.id} rendered input did not update page data`)
              }
            }
          })
        }
        else {
          await retry(`tap interaction ${journey.id}/${step.id}`, async () => {
            if (requireVisibleTarget) {
              viewportEvidence = await assertInteractionTargetInViewport(page, miniProgram, journey, step)
            }
            const element = await queryFreshRenderedActionElement(page, step.selector)
            let actionError
            let actionAttempted = false
            try {
              assert(element, `Interaction ${journey.id}/${step.id} selector was not rendered: ${step.selector}`)
              const dataBeforeAction = await page.data(undefined, { routeOnly: true })
              assert(
                !interactionDataMatches(dataBeforeAction, step),
                `Interaction ${journey.id}/${step.id} was already satisfied before the rendered tap`,
              )
              actionAttempted = true
              await element.tap()
            }
            catch (error) {
              actionError = error
            }
            const actionReachedExpectedState = await waitForInteractionData(page, step)
            if (!actionReachedExpectedState || !actionAttempted) {
              if (actionError && requireRenderedAction) {
                throw actionError
              }
              if (requireRenderedAction || !await invokeInteractionHandler(page, step)) {
                throw actionError || new Error(`Interaction ${journey.id}/${step.id} rendered tap did not update page data`)
              }
            }
          })
        }
        await new Promise(resolve => setTimeout(resolve, 180))
        const data = await retry(
          `read interaction ${journey.id}/${step.id}`,
          () => page.data(undefined, { routeOnly: true }),
        )
        assertNoSensitivePageData(data, journey.route, sensitivePatterns)
        assertInteractionData(data, journey, step)
        let visibleAssertionMode
        let visibleDiffRatio = 0
        if (step.visibleAssertion) {
          visibleAssertionMode = await assertInteractionVisible(page, step)
          if (requireScreenshotDiff || visibleAssertionMode === 'source-data-screenshot') {
            const visibleAfterPath = path.join(outputDir, `interaction-${outputName(journey.id)}-${outputName(step.id)}.png`)
            await captureScreenshot(`interaction-${journey.id}/${step.id}`, miniProgram, visibleAfterPath)
            visibleDiffRatio = comparePngBuffers(
              fs.readFileSync(visibleBeforePath),
              fs.readFileSync(visibleAfterPath),
            ).diffRatio
            assert(visibleDiffRatio >= 0.001, `Interaction ${journey.id}/${step.id} did not produce a visible screenshot change`)
          }
        }
        result.steps.push({
          id: step.id,
          type: step.type,
          status: 'passed',
          visibleAssertionMode,
          visibleDiffRatio,
          viewportEvidence,
        })
      }
      const screenshotPath = path.join(outputDir, `interaction-${outputName(journey.id)}.png`)
      await captureScreenshot(`interaction-${journey.id}`, miniProgram, screenshotPath)
      result.sizeBytes = fs.statSync(screenshotPath).size
      assert(result.sizeBytes >= 8 * 1024, `Interaction ${journey.id} screenshot is suspiciously small`)
      result.status = 'passed'
      console.log(`PASS  interaction:${journey.id}  ${journey.route}`)
    }
    catch (error) {
      result.status = 'failed'
      result.error = sanitizeRuntimeValue(error instanceof Error ? error.message : error)
      throw error
    }
  }
}

function normalizedRuntimePagePath(page) {
  return String(page?.path || '').replace(/^\/+/, '').split('?')[0]
}

async function waitForCurrentRuntimePath(miniProgram, route, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastPath = ''
  while (Date.now() < deadline) {
    const page = await retry(`current page ${route.path}`, () => miniProgram.currentPage())
    lastPath = normalizedRuntimePagePath(page)
    if (lastPath === route.path) {
      return page
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Runtime fixture expected ${route.path}, received ${lastPath || 'no current page'}`)
}

async function waitForCurrentRuntimeRoute(miniProgram, route, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastPath = ''
  let lastRenderError = ''
  while (Date.now() < deadline) {
    const page = await retry(`current rendered page ${route.path}`, () => miniProgram.currentPage())
    lastPath = normalizedRuntimePagePath(page)
    if (lastPath === route.path) {
      try {
        const nodes = await page.renderedNodes(route.selector, { routeOnly: true })
        if (nodes.length > 0) {
          return page
        }
      }
      catch (error) {
        lastRenderError = error instanceof Error ? error.message : String(error)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(
    `Runtime fixture expected rendered ${route.path}:${route.selector}, received ${lastPath || 'no current page'}${lastRenderError ? ` (${lastRenderError})` : ''}`,
  )
}

export async function navigateFreshRuntimeRoute(
  miniProgram,
  route,
  label,
  navigate,
  timeoutMs = 15_000,
) {
  let firstError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await retry(
      attempt === 1 ? label : `${label} render recovery`,
      navigate,
    )
    try {
      return await waitForCurrentRuntimeRoute(
        miniProgram,
        route,
        attempt === 1 ? Math.min(timeoutMs, 3_000) : timeoutMs,
      )
    }
    catch (error) {
      if (attempt === 2) {
        throw new Error(
          `Runtime navigation ${label} did not render after one safe repeat: ${error instanceof Error ? error.message : String(error)}`,
          { cause: firstError || error },
        )
      }
      firstError = error
    }
  }
  throw firstError || new Error(`Runtime navigation ${label} failed`)
}

export async function navigateFreshRuntimeTab(
  miniProgram,
  route,
  label,
  timeoutMs = 15_000,
) {
  await retry(label, () => miniProgram.switchTab(`/${route.path}`))
  try {
    return await waitForCurrentRuntimeRoute(
      miniProgram,
      route,
      Math.min(timeoutMs, 3_000),
    )
  }
  catch (error) {
    if (!isRecoverableRuntimeRenderError(error)) {
      throw error
    }
    await retry(
      `${label} render recovery`,
      () => miniProgram.reLaunch(`/${route.path}`),
    )
    return waitForCurrentRuntimeRoute(miniProgram, route, timeoutMs)
  }
}

export function isRecoverableRuntimeRenderError(error) {
  const message = sanitizeRuntimeValue(error instanceof Error ? error.message : error).toLowerCase()
  const match = message.match(/expected rendered ([^:]+):[^,]+, received ([^ (]+)/)
  return match !== null && match[1] === match[2]
}

async function tapVisibleRuntimeFixtureAction(page, miniProgram, selector, label) {
  await retry(
    `scroll runtime fixture ${label}`,
    () => miniProgram.callWxMethod('pageScrollTo', { selector, duration: 0 }),
  )
  await new Promise(resolve => setTimeout(resolve, 180))
  const [nodes, systemInfo] = await Promise.all([
    page.renderedNodes(selector, { routeOnly: true }),
    miniProgram.systemInfo(),
  ])
  assert(
    interactionTargetViewportEvidence(nodes, systemInfo),
    `Runtime fixture ${label} target is outside the measured viewport`,
  )
  const element = await queryFreshRenderedActionElement(page, selector)
  assert(element, `Runtime fixture ${label} selector was not rendered: ${selector}`)
  await element.tap()
}

async function restoreProtectedAccessRuntimeFixture(
  miniProgram,
  runtimePages,
  route,
  sensitivePatterns,
) {
  const fixture = route.protectedAccessFixture
  const accessPage = await waitForCurrentRuntimeRoute(miniProgram, route)
  const before = await retry(`read restore state ${route.path}`, () => accessPage.data())
  assertNoSensitivePageData(before, route.path, sensitivePatterns)
  assert(before?.state === 'ready', 'Protected access fixture cannot restore from a non-ready access page')
  assert(before?.globalGate === true, 'Protected access fixture lost its global guard intent')
  assert(
    before?.nextRequirement === fixture.expectedNextRequirement,
    'Protected access fixture no longer represents the signed-out authentication requirement',
  )

  try {
    await tapVisibleRuntimeFixtureAction(
      accessPage,
      miniProgram,
      fixture.restoreSelector,
      'restore-identity',
    )
  }
  catch (error) {
    if (!/element destroyed/i.test(error instanceof Error ? error.message : String(error))) {
      throw error
    }
  }
  const restoreRoute = runtimePages.routes.find(candidate => candidate.path === fixture.restoreRoute)
  await waitForCurrentRuntimePath(miniProgram, restoreRoute, 20_000)
  const restoredPage = await navigateFreshRuntimeRoute(
    miniProgram,
    restoreRoute,
    `reload restored route ${restoreRoute.path}`,
    () => miniProgram.reLaunch(`/${restoreRoute.path}`),
    20_000,
  )
  const restored = await waitForPageData(restoredPage, restoreRoute, sensitivePatterns, 20_000)
  assert(
    restored.status === 'passed',
    `Protected access fixture did not restore the server-backed identity (${restored.error || restored.state || 'unknown'})`,
  )
}

export async function resolveProtectedAccessRuntimeFixture(
  miniProgram,
  runtimePages,
  route,
  sensitivePatterns,
) {
  const fixture = route.protectedAccessFixture
  const sourceRoute = runtimePages.routes.find(candidate => candidate.path === fixture.sourceRoute)
  let signOutCompleted = false
  try {
    let sourcePage = await navigateFreshRuntimeRoute(
      miniProgram,
      sourceRoute,
      `protected access source ${sourceRoute.path}`,
      () => miniProgram.reLaunch(`/${sourceRoute.path}`),
    )
    const sourceState = await waitForPageData(sourcePage, sourceRoute, sensitivePatterns, 12_000)
    assert(
      sourceState.status === 'passed' && sourceState.state === 'ready',
      `Protected access fixture source did not reach ready (${sourceState.error || sourceState.state || 'unknown'})`,
    )

    await miniProgram.mockWxMethod(fixture.confirmationMethod, {
      cancel: false,
      confirm: true,
      errMsg: `${fixture.confirmationMethod}:ok`,
    })
    let accessPage
    try {
      for (let attempt = 1; attempt <= 2 && !accessPage; attempt += 1) {
        if (attempt > 1) {
          sourcePage = await navigateFreshRuntimeRoute(
            miniProgram,
            sourceRoute,
            'retry local sign-out source',
            () => miniProgram.reLaunch(`/${sourceRoute.path}`),
          )
        }
        await tapVisibleRuntimeFixtureAction(
          sourcePage,
          miniProgram,
          fixture.sourceSelector,
          'local-sign-out',
        )
        await new Promise(resolve => setTimeout(resolve, 250))
        const [currentPage, sourceData] = await Promise.all([
          retry('read local sign-out route', () => miniProgram.currentPage()),
          sourcePage.data(undefined, { routeOnly: true }).catch(() => undefined),
        ])
        signOutCompleted = signOutCompleted
          || normalizedRuntimePagePath(currentPage) === route.path
          || sourceData?.localLogoutState === 'processing'
        if (!signOutCompleted) {
          continue
        }
        try {
          accessPage = await waitForCurrentRuntimeRoute(miniProgram, route, 3_000)
        }
        catch {
          accessPage = await navigateFreshRuntimeRoute(
            miniProgram,
            route,
            'resume global access guard after local sign-out',
            () => miniProgram.reLaunch(`/${fixture.restoreRoute}`),
            12_000,
          )
        }
      }
    }
    finally {
      await miniProgram.restoreWxMethod(fixture.confirmationMethod)
    }
    assert(accessPage, 'Protected access fixture local sign-out control did not enter the access flow')
    const accessState = await waitForPageData(accessPage, route, sensitivePatterns, 12_000)
    assert(
      accessState.status === 'passed',
      `Protected access fixture did not reach ready (${accessState.error || accessState.state || 'unknown'})`,
    )
    assert(accessState.data?.globalGate === true, 'Protected access fixture did not originate from the global guard')
    assert(
      accessState.data?.nextRequirement === fixture.expectedNextRequirement,
      'Protected access fixture did not produce the authentication requirement',
    )
    const token = String(accessState.data?.token || '')
    assert(/^[\w.:-]{1,200}$/.test(token), 'Protected access fixture did not produce a bounded opaque intent token')

    return {
      status: 'resolved',
      query: queryForRoute(route, { token }),
      queryMode: 'protected-action-intent',
      restore: () => restoreProtectedAccessRuntimeFixture(
        miniProgram,
        runtimePages,
        route,
        sensitivePatterns,
      ),
    }
  }
  catch (error) {
    if (!signOutCompleted) {
      throw error
    }
    try {
      await restoreProtectedAccessRuntimeFixture(miniProgram, runtimePages, route, sensitivePatterns)
    }
    catch (restoreError) {
      throw new Error(
        `Protected access fixture failed and identity restoration also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        { cause: error },
      )
    }
    throw error
  }
}

async function resolveRouteQuery(miniProgram, runtimePages, route, sensitivePatterns, fixtureCache) {
  if (route.protectedAccessFixture) {
    return resolveProtectedAccessRuntimeFixture(
      miniProgram,
      runtimePages,
      route,
      sensitivePatterns,
    )
  }
  if (!(route.query || []).length) {
    return { status: 'resolved', query: '', queryMode: 'none' }
  }
  const fixture = route.queryFixture
  const sourceQuery = queryForRoute({
    path: fixture.sourceRoute,
    query: Object.keys(fixture.sourceQuery || {}),
  }, fixture.sourceQuery || {})
  const sourceCacheKey = `${fixture.sourceRoute}?${sourceQuery}`
  let sourceData = fixtureCache.get(sourceCacheKey)
  if (!sourceData) {
    const sourceRoute = runtimePages.routes.find(candidate => candidate.path === fixture.sourceRoute)
    const sourcePage = await navigateFreshRuntimeRoute(
      miniProgram,
      sourceRoute,
      `query fixture ${route.path}`,
      () => miniProgram.reLaunch(`/${sourceRoute.path}${sourceQuery ? `?${sourceQuery}` : ''}`),
    )
    const settled = await waitForPageData(sourcePage, sourceRoute, sensitivePatterns, 12000)
    if (settled.status !== 'passed') {
      return {
        status: 'external-wait',
        queryMode: 'runtime-fixture',
        reason: `${route.path} fixture source ${sourceRoute.path} did not reach an accepted state`,
      }
    }
    sourceData = settled.data
    fixtureCache.set(sourceCacheKey, sourceData)
  }
  const resolved = resolveQueryFixtureValues(route, sourceData)
  return resolved.status === 'resolved'
    ? { ...resolved, query: queryForRoute(route, resolved.values), queryMode: 'runtime-fixture' }
    : { ...resolved, queryMode: 'runtime-fixture' }
}

async function verifyContractedPages(miniProgram, runtimePages, report, options) {
  const { fixtureCache, sensitivePatterns, updateBaseline } = options
  report.pages = []
  for (const route of runtimePages.routes) {
    const name = outputName(route.path)
    const baseline = path.join(baselineDir, `${name}.png`)
    const current = path.join(outputDir, `${name}.png`)
    const diff = path.join(outputDir, `${name}.diff.png`)
    let queryMode = (route.query || []).length ? 'runtime-fixture' : 'none'
    let restoreRuntimeFixture
    try {
      const queryResolution = await resolveRouteQuery(
        miniProgram,
        runtimePages,
        route,
        sensitivePatterns,
        fixtureCache,
      )
      queryMode = queryResolution.queryMode
      restoreRuntimeFixture = queryResolution.restore
      if (queryResolution.status === 'external-wait') {
        report.pages.push({
          route: route.path,
          selector: route.selector,
          queryMode,
          status: 'external-wait',
          error: sanitizeRuntimeValue(queryResolution.reason),
        })
        console.log(`WAIT  ${route.path}  ${queryResolution.reason}`)
        continue
      }
      const launchRoute = `/${route.path}${queryResolution.query ? `?${queryResolution.query}` : ''}`
      const page = await navigateFreshRuntimeRoute(
        miniProgram,
        route,
        `reLaunch ${route.path}`,
        () => miniProgram.reLaunch(launchRoute),
      )
      assert(String(page.path || '').replace(/^\//, '') === route.path, `Unexpected runtime route: ${page.path}`)
      const settled = await waitForPageData(page, route, sensitivePatterns)
      await new Promise(resolve => setTimeout(resolve, 600))
      const screenshotData = await retry(`confirm data ${route.path}`, () => page.data())
      assertNoSensitivePageData(screenshotData, route.path, sensitivePatterns, route.allowedSensitivePaths)
      const confirmed = evaluateRouteState(route, screenshotData)
      const status = settled.status === 'passed' && confirmed.status === 'passed'
        ? 'passed'
        : settled.status === 'external-wait' && confirmed.status === 'external-wait'
          ? 'external-wait'
          : 'failed'
      const error = settled.error || confirmed.error

      await captureScreenshot(route.path, miniProgram, current)
      const sizeBytes = fs.statSync(current).size
      assert(sizeBytes >= 8 * 1024, `Screenshot is suspiciously small: ${route.path}`)
      const result = {
        route: route.path,
        selector: route.selector,
        queryMode,
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
      if (restoreRuntimeFixture) {
        await restoreRuntimeFixture()
        restoreRuntimeFixture = undefined
        result.fixtureRestored = true
      }
      report.pages.push(result)
      if (status === 'passed') {
        fixtureCache.set(route.path, screenshotData)
      }
      console.log(`${status === 'passed' ? 'PASS' : status === 'external-wait' ? 'WAIT' : 'FAIL'}  ${route.path}  ${Math.round(sizeBytes / 1024)} KB`)
    }
    catch (error) {
      if (restoreRuntimeFixture) {
        try {
          await restoreRuntimeFixture()
          restoreRuntimeFixture = undefined
        }
        catch (restoreError) {
          throw new Error(
            `Runtime fixture cleanup failed for ${route.path}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            { cause: error },
          )
        }
      }
      if (isRecoverableRuntimeConnectionError(error) || isScreenshotCaptureError(error)) {
        throw error
      }
      report.pages.push({
        route: route.path,
        selector: route.selector,
        queryMode,
        status: 'failed',
        error: sanitizeRuntimeValue(error instanceof Error ? error.message : error),
      })
      console.log(`FAIL  ${route.path}`)
    }
  }
}

async function verifyNavigation(miniProgram, runtimePages, report, sensitivePatterns, fixtureCache) {
  const tabs = runtimePages.routes.filter(route => route.tab)
  report.navigation = { tabs: [], back: null, deepLink: null }
  for (const route of tabs) {
    const page = await navigateFreshRuntimeTab(
      miniProgram,
      route,
      `switch tab ${route.path}`,
    )
    assert(String(page.path || '').replace(/^\//, '') === route.path, `Tab opened unexpected route: ${page.path}`)
    const settled = await waitForPageData(page, route, sensitivePatterns, 12000)
    report.navigation.tabs.push({ route: route.path, status: settled.status, state: settled.state })
  }

  const homeRoute = runtimePages.routes.find(route => route.path === 'pages/index/index')
  const returnRoute = runtimePages.routes.find(route => route.path === 'packages/member/help/index')
  assert(homeRoute && returnRoute, 'Runtime navigation contract is missing home/help')
  await navigateFreshRuntimeRoute(
    miniProgram,
    homeRoute,
    'return flow home',
    () => miniProgram.reLaunch('/pages/index/index'),
  )
  await retry('open secondary page', () => miniProgram.navigateTo('/packages/member/help/index'))
  await waitForCurrentRuntimeRoute(miniProgram, returnRoute)
  await retry('navigate back', () => miniProgram.navigateBack())
  const returned = await waitForCurrentRuntimeRoute(miniProgram, homeRoute)
  report.navigation.back = {
    status: returned.path === 'pages/index/index' ? 'passed' : 'failed',
    from: returnRoute.path,
    to: String(returned.path || ''),
  }

  const queryRoutes = runtimePages.routes.filter(route => (
    (route.query || []).length > 0 && !route.protectedAccessFixture
  ))
  const orderedDeepRoutes = [
    ...queryRoutes.filter(route => route.group === 'public'),
    ...queryRoutes.filter(route => route.group !== 'public'),
  ]
  assert(orderedDeepRoutes.length, 'Runtime contract has no query deep-link route')
  let deepRoute
  let deepResolution
  const waitReasons = []
  for (const candidate of orderedDeepRoutes) {
    const resolution = await resolveRouteQuery(
      miniProgram,
      runtimePages,
      candidate,
      sensitivePatterns,
      fixtureCache,
    )
    if (resolution.status === 'resolved') {
      deepRoute = candidate
      deepResolution = resolution
      break
    }
    waitReasons.push(resolution.reason)
  }
  if (!deepRoute || !deepResolution) {
    report.navigation.deepLink = {
      status: 'external-wait',
      queryMode: 'runtime-fixture',
      rootReached: false,
      error: sanitizeRuntimeValue(waitReasons.join('; ')),
    }
    return
  }
  const deepPage = await navigateFreshRuntimeRoute(
    miniProgram,
    deepRoute,
    'open fixture deep link',
    () => miniProgram.reLaunch(`/${deepRoute.path}?${deepResolution.query}`),
  )
  const deepResult = await waitForPageData(deepPage, deepRoute, sensitivePatterns, 12000)
  report.navigation.deepLink = {
    route: deepRoute.path,
    queryMode: deepResolution.queryMode,
    rootReached: true,
    status: deepResult.status,
    state: deepResult.state,
    error: deepResult.error ? sanitizeRuntimeValue(deepResult.error) : undefined,
  }
}

export async function main(runArgs = process.argv.slice(2)) {
  const runtimePages = JSON.parse(fs.readFileSync(runtimePagesPath, 'utf8'))
  validateRuntimeContract(runtimePages)
  const evidenceOptions = resolveRuntimeEvidenceOptions(root, runArgs)
  outputDir = evidenceOptions.outputDir
  reportPath = path.join(outputDir, 'report.json')
  consolePath = path.join(outputDir, 'console.json')
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

  prepareRuntimeEvidenceDirectory(root, evidenceOptions)
  fs.mkdirSync(baselineDir, { recursive: true })
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
    interactions: [],
    deviceRequired: buildDeviceRequiredReport(runtimePages),
    evidence: {
      output: {
        mode: evidenceOptions.isolated ? 'isolated' : 'default',
        path: evidenceOptions.outputPath,
      },
      viewport: createPendingViewportEvidence(evidenceOptions.viewportProfile),
    },
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
    const fixtureCache = new Map()
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
    report.evidence.viewport = createObservedViewportEvidence(
      await withProtocolTimeout('viewport measurement', () => miniProgram.systemInfo(), 15000),
      evidenceOptions.viewportProfile,
    )
    assertViewportEvidence(report.evidence.viewport)
    miniProgram.on('console', payload => diagnostics.captureConsole(payload))
    miniProgram.on('exception', payload => diagnostics.captureException(payload))

    await verifyRepresentativeStates(miniProgram, runtimePages, report, sensitivePatterns)
    await verifyContractedPages(miniProgram, runtimePages, report, {
      fixtureCache,
      sensitivePatterns,
      updateBaseline,
    })
    await verifyNavigation(miniProgram, runtimePages, report, sensitivePatterns, fixtureCache)
    await verifyInteractionJourneys(miniProgram, runtimePages, report, sensitivePatterns)

    const failedPages = report.pages.filter(page => page.status !== 'passed')
    const externalWaitPages = failedPages.filter(page => page.status === 'external-wait')
    const failedTabs = report.navigation.tabs.filter(tab => tab.status !== 'passed')
    assert(
      failedPages.length === 0,
      `${failedPages.length} contracted page(s) did not reach an accepted state (${externalWaitPages.length} external-wait); missing fixture facts and service errors are not runtime success`,
    )
    assert(failedTabs.length === 0, `${failedTabs.length} primary tab(s) did not reach an accepted state`)
    assert(report.navigation.back?.status === 'passed', 'Secondary-page return path failed')
    assert(report.navigation.deepLink?.status === 'passed', 'Safe deep link reached an error instead of an accepted state')
  }

  try {
    const runtimeStartup = await prepareRuntimeDevtools({
      preflight: () => assertRuntimePreflight(devtoolsRoot, {
        sourceRoot: devtoolsRoot === root ? 'src' : 'dist',
        requirePublicAppId: devtoolsRoot !== root,
        requiredRoutes: runtimeRoutes,
      }),
      warmProject: () => warmWechatDevtoolsProject({ projectPath: devtoolsRoot }),
    })
    report.preflight = runtimeStartup.preflight
    if (runtimeStartup.projectPrewarmedBeforePreflight) {
      report.recoveries.push({ action: 'prewarmed-devtools-project-before-preflight' })
    }
    const openedAutomatorAvailable = await isLocalPortListening(baseRuntimeOptions.port)
    if (!openedAutomatorAvailable && !runtimeStartup.projectPrewarmedBeforePreflight) {
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
        if (attempt !== 1 || (!isRecoverableRuntimeConnectionError(error)
          && !isScreenshotCaptureError(error)
          && !isRecoverableRuntimeRenderError(error))) {
          throw error
        }
        report.recoveries.push({
          attempt,
          action: 'reconnect-target-project',
          reason: isScreenshotCaptureError(error)
            ? 'screenshot-capture-failed'
            : isRecoverableRuntimeRenderError(error)
              ? 'renderer-not-ready'
              : 'connection-failed',
        })
        await closeSharedMiniProgram(devtoolsRoot, sessionId).catch(() => undefined)
        miniProgram = undefined
        report.pages = []
        report.representativeStates = []
        report.interactions = []
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
    assert(
      report.interactions.length === runtimePages.interactionJourneys.length
      && report.interactions.every(journey => journey.status === 'passed'),
      'Runtime verifier did not complete all interaction journeys',
    )

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
