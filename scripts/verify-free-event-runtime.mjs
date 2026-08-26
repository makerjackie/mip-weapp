#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  acquireSharedMiniProgram,
  closeSharedMiniProgram,
  resolveProjectAutomatorPort,
} from 'weapp-ide-cli'
import { isLocalPortListening } from './lib/devtools-automator-session.mjs'
import { callCloudbase } from './lib/example-cloudbase.mjs'
import {
  createOpenedAutomatorOptions,
  isReusableFreeEventRegistrationStatus,
  markerSha256,
  planRegistrationFieldActions,
  resolveFreeEventMutationOptions,
  resolveFreeEventRuntimeBuildSha,
  resolveFreeEventRuntimeEnvironment,
  runtimeCompileDisposition,
  runtimeRouteDisposition,
  summarizeAdminFeedback,
  summarizeCommentPage,
  summarizeEventDetail,
  summarizeInteraction,
  summarizeMutationCleanup,
  summarizeRegistrationFact,
  summarizeRegistrationSubmission,
  summarizeRoster,
  validateDeploymentAttestation,
  validateFreeEventMutationContract,
  validateRuntimeAttestation,
} from './lib/free-event-runtime-contract.mjs'
import { installMiniprogramAutomatorCompatibility } from './lib/miniprogram-automator-compat.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import { readEnv } from './lib/project.mjs'
import {
  assertViewportEvidence,
  createObservedViewportEvidence,
  prepareRuntimeEvidenceDirectory,
} from './lib/runtime-evidence.mjs'
import {
  createRuntimeDiagnostics,
  readRuntimeWarningAllowlist,
  sanitizeRuntimeValue,
} from './lib/runtime-observability.mjs'
import { assertRuntimePreflight } from './lib/runtime-preflight.mjs'

const root = path.resolve(import.meta.dirname, '..')
const contractPath = path.join(root, 'config', 'runtime-free-event-mutation.json')
const warningAllowlistPath = path.join(root, 'config', 'runtime-warning-allowlist.json')
const sessionId = 'mip-weapp-free-event-mutation'
const runtimeAcceptanceStorageKey = 'mip:internal:free-event-runtime-acceptance:v1'
const automatedTimeoutMs = 20_000
const authoritativePageOpenAttempts = 2
const externalWaitStates = new Set(['access', 'blocked', 'disabled', 'forbidden'])
const failedStates = new Set(['conflict', 'error', 'failed'])
const authoritativePageContexts = new WeakMap()

class ExternalWaitError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ExternalWaitError'
  }
}

class RuntimeStateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RuntimeStateError'
  }
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function delay(timeoutMs) {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

function normalizedRoute(value) {
  return String(value || '').replace(/^\//, '').split('?')[0]
}

function safeError(error, secrets = []) {
  return sanitizeRuntimeValue(error instanceof Error ? error.message : error, secrets)
}

function runBuild(buildSha) {
  const result = spawnSync('pnpm', ['build'], {
    cwd: root,
    env: { ...process.env, BUILD_SHA: buildSha, WEAPP_VITE_MCP: '0' },
    stdio: 'inherit',
  })
  if (result.error) {
    throw result.error
  }
  invariant(result.status === 0, 'pnpm build failed before mutating runtime acceptance')
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  invariant(!result.error && result.status === 0, 'Git state could not be read before mutating runtime acceptance')
  return String(result.stdout || '')
}

function readStableRuntimeBuildSha() {
  const headSha = runGit(['rev-parse', '--verify', 'HEAD']).trim()
  const trackedChanges = runGit(['diff', '--name-only', '--no-ext-diff', '--no-renames', '-z', 'HEAD', '--'])
    .split('\0')
    .filter(Boolean)
  const untrackedChanges = runGit(['ls-files', '--others', '--exclude-standard', '-z', '--'])
    .split('\0')
    .filter(Boolean)
  return resolveFreeEventRuntimeBuildSha(headSha, [...trackedChanges, ...untrackedChanges])
}

function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value
}

function environmentVariables(detail) {
  const entries = functionDetail(detail)?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

function readDeploymentAttestation(env, options) {
  const functionNames = resolveMipFunctionNames(env)
  const roles = ['events', 'community', 'admin']
  const details = Object.fromEntries(roles.map((role) => {
    const value = functionDetail(callCloudbase(root, 'callCloudApi', {
      action: 'GetFunction',
      params: {
        FunctionName: functionNames[role],
        Namespace: env.CLOUDBASE_ENV_ID,
        ShowCode: 'FALSE',
      },
      service: 'scf',
    }))
    return [role, {
      availableStatus: value?.AvailableStatus,
      status: value?.Status,
      variables: environmentVariables(value),
    }]
  }))
  return validateDeploymentAttestation(details, {
    appId: env.MINI_PROGRAM_APP_ID,
    paymentMode: env.MIP_PAYMENT_MODE,
    stage: options.stage,
  })
}

async function readRuntimeAttestation(miniProgram, env, buildSha) {
  try {
    const account = await miniProgram.callWxMethod('getAccountInfoSync')
    const app = await readRuntimeAcceptanceStorage(miniProgram)
    const health = await miniProgram.evaluate(async (functionName) => {
      const response = await wx.cloud.callFunction({
        data: { action: 'health' },
        name: functionName,
      })
      return response.result
    }, resolveMipFunctionNames(env).events)
    return validateRuntimeAttestation({ account, app, health }, {
      appId: env.MINI_PROGRAM_APP_ID,
      buildSha,
      envId: env.CLOUDBASE_ENV_ID,
      paymentMode: env.MIP_PAYMENT_MODE,
    })
  }
  finally {
    await clearRuntimeAcceptanceStorage(miniProgram)
  }
}

async function readRuntimeAcceptanceStorage(miniProgram) {
  const value = await miniProgram.callWxMethod('getStorageSync', runtimeAcceptanceStorageKey)
  return value && typeof value === 'object'
    ? {
        buildSha: value.buildSha,
        catalogStage: value.catalogStage,
        cloudbaseEnvId: value.cloudbaseEnvId,
        cloudbaseMode: value.cloudbaseMode,
        paymentMode: value.paymentMode,
      }
    : null
}

async function clearRuntimeAcceptanceStorage(miniProgram) {
  try {
    await miniProgram.callWxMethod('removeStorageSync', runtimeAcceptanceStorageKey)
    const remaining = await miniProgram.callWxMethod('getStorageSync', runtimeAcceptanceStorageKey)
    if (remaining !== undefined && remaining !== null && remaining !== '') {
      throw new RuntimeStateError('The mutation runtime acceptance storage handshake was not cleared')
    }
  }
  catch (error) {
    if (error instanceof RuntimeStateError) {
      throw error
    }
    throw new RuntimeStateError('The mutation runtime acceptance storage handshake could not be cleared')
  }
}

async function waitForOperatorBuild(miniProgram, buildSha, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const runningAcceptance = await readRuntimeAcceptanceStorage(miniProgram)
      if (runningAcceptance?.buildSha === buildSha) {
        return
      }
    }
    catch {
      // The operator may be compiling or reloading the opened project.
    }
    await delay(500)
  }
  throw new ExternalWaitError('The opened DevTools Automator does not support compile(); click Compile in the existing DevTools window and wait for the fresh runtime bundle to load')
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

function currentIsoTime() {
  return new Date().toISOString()
}

function createMarkers() {
  const token = `${Date.now()}-${randomUUID().slice(0, 8)}`
  return {
    comment: `MIP runtime comment ${token}`,
    feedback: `MIP runtime feedback ${token}`,
    registration: `MIP runtime registration ${token}`,
  }
}

function findStep(report, id) {
  const step = report.steps.find(item => item.id === id)
  invariant(step, `Unknown runtime step: ${id}`)
  return step
}

function createReport(contract, options, markers) {
  return {
    schemaVersion: 1,
    status: 'running',
    startedAt: currentIsoTime(),
    stage: options.stage,
    eventId: options.eventId,
    mutationConfirmation: true,
    contract: {
      id: contract.id,
      source: 'config/runtime-free-event-mutation.json',
      stepCount: contract.steps.length,
    },
    connectionPolicy: { ...contract.connection },
    markerSha256: {
      comment: markerSha256(markers.comment),
      feedback: markerSha256(markers.feedback),
      registration: markerSha256(markers.registration),
    },
    mutations: [],
    steps: contract.steps.map(step => ({
      evidence: [],
      id: step.id,
      mode: step.mode,
      route: step.route,
      status: 'not-run',
    })),
    deviceRequiredRemaining: contract.deviceRequiredRemaining,
    businessCleanup: summarizeMutationCleanup(
      contract.steps.map(step => ({ id: step.id, mode: step.mode, status: 'not-run' })),
      [],
    ),
    automatorSessionCleanup: { status: 'not-opened' },
  }
}

function mutationAttempt(report, persist, action, fact = {}) {
  const mutation = {
    action,
    attemptedAt: currentIsoTime(),
    status: 'attempted',
    ...fact,
  }
  report.mutations.push(mutation)
  report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
  persist()
  return mutation
}

function confirmMutation(report, persist, mutation, fact = {}) {
  Object.assign(mutation, {
    confirmedAt: currentIsoTime(),
    status: 'confirmed',
    ...fact,
  })
  report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
  persist()
}

async function waitForData(page, predicate, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || automatedTimeoutMs)
  let lastError
  while (Date.now() < deadline) {
    try {
      const context = authoritativePageContexts.get(page)
      if (context) {
        const currentPage = await context.miniProgram.currentPage()
        const route = normalizedRoute(currentPage?.path)
        const disposition = runtimeRouteDisposition(route, context.expectedRoute)
        if (disposition === 'external-wait') {
          throw new ExternalWaitError(`${options.label || 'Page'} requires identity or access preparation in the current DevTools`)
        }
        if (disposition === 'failed') {
          throw new RuntimeStateError(`${options.label || 'Page'} navigated to unexpected route ${route || '(unknown)'}`)
        }
      }
      const data = await page.data(undefined, { routeOnly: true })
      const state = String(data?.state || '')
      if (predicate(data)) {
        return data
      }
      if (externalWaitStates.has(state)) {
        throw new ExternalWaitError(`${options.label || 'Page'} requires external preparation (state=${state})`)
      }
      if (failedStates.has(state)) {
        throw new RuntimeStateError(`${options.label || 'Page'} entered failed state ${state}`)
      }
    }
    catch (error) {
      if (error instanceof ExternalWaitError || error instanceof RuntimeStateError) {
        throw error
      }
      lastError = error
    }
    await delay(200)
  }
  if (options.externalWaitOnTimeout) {
    throw new ExternalWaitError(options.timeoutMessage || `${options.label || 'External action'} was not confirmed before timeout`)
  }
  const suffix = lastError ? `: ${safeError(lastError)}` : ''
  throw new Error(`${options.label || 'Page data'} did not reach the required state${suffix}`)
}

async function bindAuthoritativePage(miniProgram, page, expectedRoute, selector, label) {
  let currentPage = await miniProgram.currentPage().catch(() => page)
  let route = normalizedRoute(currentPage?.path)
  if (runtimeRouteDisposition(route, expectedRoute) === 'external-wait') {
    throw new ExternalWaitError(`${label} requires identity, agreement, phone, or profile preparation in the current DevTools`)
  }
  if (runtimeRouteDisposition(route, expectedRoute) === 'failed') {
    throw new RuntimeStateError(`${label} opened unexpected route ${route || '(unknown)'}`)
  }
  try {
    await currentPage.waitForRendered({ selector, timeout: 15_000 })
  }
  catch (error) {
    currentPage = await miniProgram.currentPage().catch(() => currentPage)
    route = normalizedRoute(currentPage?.path)
    if (runtimeRouteDisposition(route, expectedRoute) === 'external-wait') {
      throw new ExternalWaitError(`${label} requires identity, agreement, phone, or profile preparation in the current DevTools`)
    }
    if (runtimeRouteDisposition(route, expectedRoute) === 'failed') {
      throw new RuntimeStateError(`${label} navigated to unexpected route ${route || '(unknown)'}`)
    }
    throw error
  }
  authoritativePageContexts.set(currentPage, { expectedRoute, miniProgram })
  return currentPage
}

export async function openAuthoritativePage(miniProgram, {
  expectedRoute,
  label,
  selector,
  url,
}) {
  let lastError
  for (let attempt = 1; attempt <= authoritativePageOpenAttempts; attempt += 1) {
    const openedPage = await miniProgram.reLaunch(url)
    try {
      return await bindAuthoritativePage(miniProgram, openedPage, expectedRoute, selector, label)
    }
    catch (error) {
      if (error instanceof ExternalWaitError || error instanceof RuntimeStateError) {
        throw error
      }
      lastError = error
      if (attempt < authoritativePageOpenAttempts) {
        await delay(200)
      }
    }
  }
  throw lastError
}

async function openEventPage(miniProgram, step, eventId) {
  const separator = step.route.includes('?') ? '&' : '?'
  return await openAuthoritativePage(miniProgram, {
    expectedRoute: step.route,
    label: step.id,
    selector: step.selector,
    url: `/${step.route}${separator}eventId=${encodeURIComponent(eventId)}`,
  })
}

async function callBoundHandler(page, handler, { dataset = {}, detail = {} } = {}) {
  return await page.callMethodWithOptions(
    handler,
    { routeOnly: true },
    { currentTarget: { dataset }, detail },
  )
}

async function captureEvidence({ miniProgram, outputDir, persist, step, label, state }) {
  const sequence = step.evidence.length + 1
  const fileName = `${String(step.order).padStart(2, '0')}-${step.id}-${String(sequence).padStart(2, '0')}-${label}.png`
  const screenshotPath = path.join(outputDir, fileName)
  await miniProgram.screenshot({ path: screenshotPath, timeout: 60_000 })
  invariant(fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size >= 1024, `${step.id} screenshot is missing or empty`)
  step.evidence.push({
    capturedAt: currentIsoTime(),
    file: fileName,
    label,
    authoritativePageState: state,
  })
  persist()
}

async function loadAllPages(page, { find, loadMoreHandler, label, maxPages = 20 }) {
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const data = await waitForData(
      page,
      value => ['ready', 'empty'].includes(value?.state),
      { label },
    )
    const match = find(data)
    if (match || !data.nextCursor) {
      return { data, match }
    }
    const previousCursor = data.nextCursor
    const previousCount = Array.isArray(data.items)
      ? data.items.length
      : Array.isArray(data.registrations) ? data.registrations.length : 0
    await callBoundHandler(page, loadMoreHandler)
    await waitForData(
      page,
      (value) => {
        const count = Array.isArray(value?.items)
          ? value.items.length
          : Array.isArray(value?.registrations) ? value.registrations.length : 0
        return ['ready', 'empty'].includes(value?.state)
          && (count > previousCount || value.nextCursor !== previousCursor)
      },
      { label: `${label} next page` },
    )
  }
  throw new Error(`${label} exceeded ${maxPages} pages`)
}

async function findMyRegistration(page, eventId) {
  return await loadAllPages(page, {
    find: data => (data.registrations || []).find(item => item?.event?.id === eventId),
    label: 'My event registrations',
    loadMoreHandler: 'loadMore',
  })
}

async function findRosterRegistration(page, registrationId) {
  return await loadAllPages(page, {
    find: data => (data.items || []).find(item => item?.id === registrationId),
    label: 'Admin event roster',
    loadMoreHandler: 'loadMoreRoster',
  })
}

async function findAdminFeedback(page, feedbackMarker) {
  return await loadAllPages(page, {
    find: data => (data.items || []).find(item => item?.body === feedbackMarker),
    label: 'Admin event feedback',
    loadMoreHandler: 'loadMore',
  })
}

async function ensureRegistrationCategory(page, category) {
  const data = await waitForData(page, value => value?.state === 'ready', { label: 'My event registrations' })
  if (data.activeCategory === category) {
    return
  }
  await callBoundHandler(page, 'changeCategory', { dataset: { category } })
  await waitForData(
    page,
    value => value?.state === 'ready' && value.activeCategory === category,
    { label: `My event registrations ${category}` },
  )
}

function runtimeFixtureMismatch(message) {
  throw new ExternalWaitError(message)
}

async function executeWorkflow({ contract, diagnostics, markers, miniProgram, options, outputDir, persist, report }) {
  const contractSteps = new Map(contract.steps.map(step => [step.id, step]))
  let registrationId = ''
  let registrationVersion = 0
  let feedbackId = ''
  let commentId = ''

  async function runStep(id, operation) {
    const step = findStep(report, id)
    const spec = contractSteps.get(id)
    step.order = report.steps.indexOf(step) + 1
    step.startedAt = currentIsoTime()
    step.status = 'running'
    persist()
    try {
      const result = await operation(step, spec)
      step.status = result?.status || 'passed'
      if (result?.reason) {
        step.reason = result.reason
      }
      step.completedAt = currentIsoTime()
      report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
      persist()
      return result
    }
    catch (error) {
      step.status = error instanceof ExternalWaitError ? 'external-wait' : 'failed'
      step.reason = safeError(error)
      step.completedAt = currentIsoTime()
      report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
      persist()
      throw error
    }
  }

  await runStep('member-event-detail', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const data = await waitForData(page, value => value?.state === 'ready', { label: step.id })
    const summary = summarizeEventDetail(data)
    await captureEvidence({ miniProgram, outputDir, persist, step, label: 'ready', state: summary })
    const event = summary.event
    if (!event
      || event.id !== options.eventId
      || event.accessType !== contract.event.accessType
      || event.mode !== contract.event.mode
      || event.status !== contract.event.status
      || event.registrationPolicy !== contract.event.registrationPolicy) {
      runtimeFixtureMismatch('The exact eventId is not a published, free, offline event with AUTO registration')
    }
    if (summary.primaryAction !== 'register'
      || !event.canRegister
      || !isReusableFreeEventRegistrationStatus(event.registrationStatus)) {
      runtimeFixtureMismatch('The current user must have no active registration and the exact event must currently accept registration')
    }
  })

  await runStep('member-registration', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const ready = await waitForData(page, value => value?.state === 'ready', { label: step.id })
    invariant(ready.event?.id === options.eventId, 'Registration page loaded a different event')
    invariant(ready.event?.accessType === 'FREE' && ready.event?.mode === 'OFFLINE', 'Registration page event facts changed')
    invariant(ready.event?.registrationPolicy === 'AUTO', 'Registration page requires non-automatable approval')
    const plan = planRegistrationFieldActions(ready.fields, markers.registration)
    if (plan.unavailable.length) {
      await captureEvidence({
        miniProgram,
        outputDir,
        persist,
        step,
        label: 'field-blocker',
        state: { state: ready.state, unavailableFieldCount: plan.unavailable.length },
      })
      runtimeFixtureMismatch('Required registration fields cannot be completed through their bound page handlers')
    }
    for (const action of plan.actions) {
      await callBoundHandler(page, action.handler, {
        dataset: { index: action.index },
        detail: { value: action.value },
      })
    }
    await callBoundHandler(page, 'onShareProfileChange', { detail: { value: false } })
    const mutation = mutationAttempt(report, persist, 'register-free-event', { eventId: options.eventId })
    await callBoundHandler(page, 'submit')
    const submitted = await waitForData(page, value => value?.state === 'submitted', { label: step.id })
    const summary = summarizeRegistrationSubmission(submitted)
    confirmMutation(report, persist, mutation, { pageState: summary.state })
    await captureEvidence({ miniProgram, outputDir, persist, step, label: 'submitted', state: summary })
    if (summary.resultTitle !== '报名成功') {
      runtimeFixtureMismatch(`Free AUTO registration did not become REGISTERED (${summary.resultTitle || 'unknown result'})`)
    }
  })

  await runStep('member-registration-fact', async (step, spec) => {
    const page = await openAuthoritativePage(miniProgram, {
      expectedRoute: spec.route,
      label: step.id,
      selector: spec.selector,
      url: `/${spec.route}`,
    })
    await ensureRegistrationCategory(page, 'UPCOMING')
    const found = await findMyRegistration(page, options.eventId)
    if (!found.match) {
      throw new Error('Submitted registration is absent from the authoritative user registration page')
    }
    if (found.match.status !== 'REGISTERED') {
      runtimeFixtureMismatch(`Submitted registration is ${found.match.status}, not REGISTERED`)
    }
    registrationId = String(found.match.registrationId || '')
    registrationVersion = Number(found.match.version)
    invariant(registrationId && Number.isInteger(registrationVersion) && registrationVersion > 0, 'Registration fact is missing id/version')
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'registered',
      state: summarizeRegistrationFact(found.data, options.eventId),
    })
  })

  await runStep('admin-roster', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const found = await findRosterRegistration(page, registrationId)
    if (!found.match) {
      throw new Error('The exact registrationId is absent from the admin roster')
    }
    if (!found.data.canCheckIn) {
      runtimeFixtureMismatch('The current operator lacks events.checkin.manage for the exact event')
    }
    invariant(found.match.status === 'REGISTERED', `Admin roster registration is ${found.match.status}, not REGISTERED`)
    invariant(Number(found.match.version) === registrationVersion, 'User/admin registration versions do not match before check-in')
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'registered',
      state: summarizeRoster(found.data, registrationId),
    })
  })

  await runStep('admin-check-in', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const before = await findRosterRegistration(page, registrationId)
    invariant(before.match?.status === 'REGISTERED', 'Registration is no longer ready for admin check-in')
    invariant(before.data.canCheckIn === true, 'Admin check-in capability is unavailable')
    const previousVersion = Number(before.match.version)
    const mutation = mutationAttempt(report, persist, 'admin-manual-check-in', { registrationId })
    await callBoundHandler(page, 'checkIn', {
      dataset: { id: registrationId, version: previousVersion },
    })
    const attended = await waitForData(
      page,
      (value) => {
        const item = (value?.items || []).find(candidate => candidate?.id === registrationId)
        return value?.state === 'ready' && item?.status === 'ATTENDED' && Number(item.version) > previousVersion
      },
      { label: step.id },
    )
    registrationVersion = Number(attended.items.find(item => item.id === registrationId).version)
    confirmMutation(report, persist, mutation, { registrationId, version: registrationVersion })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'attended',
      state: summarizeRoster(attended, registrationId),
    })
  })

  await runStep('member-heart', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    let data = await waitForData(page, value => value?.state === 'ready' && value?.heart, { label: step.id })
    const candidates = Array.isArray(data.candidates) ? data.candidates : []
    if (!candidates.length) {
      const reason = 'No second attended participant is currently available; no synthetic participant or database write was used'
      await captureEvidence({
        miniProgram,
        outputDir,
        persist,
        step,
        label: 'no-candidate',
        state: summarizeInteraction(data, markers.feedback),
      })
      return { reason, status: 'external-wait' }
    }
    const target = candidates.find(candidate => !candidate.selected) || candidates[0]
    const originalTarget = String(data.heart?.targetRef || '')
    if (originalTarget && target.participantRef === originalTarget) {
      const toggleOff = mutationAttempt(report, persist, 'member-heart-toggle-off')
      await callBoundHandler(page, 'chooseHeart', { dataset: { targetRef: target.participantRef } })
      data = await waitForData(
        page,
        value => value?.state === 'ready' && !value?.heart?.targetRef,
        { label: `${step.id} toggle off` },
      )
      confirmMutation(report, persist, toggleOff, { version: data.heart.version })
    }
    const previousVersion = Number(data.heart?.version || 0)
    const mutation = mutationAttempt(report, persist, 'member-heart-select')
    await callBoundHandler(page, 'chooseHeart', { dataset: { targetRef: target.participantRef } })
    const selected = await waitForData(
      page,
      value => value?.state === 'ready'
        && value?.heart?.targetRef === target.participantRef
        && Number(value.heart.version) > previousVersion,
      { label: step.id },
    )
    confirmMutation(report, persist, mutation, { version: selected.heart.version })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'selected',
      state: summarizeInteraction(selected, markers.feedback),
    })
  })

  await runStep('member-feedback', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    let data = await waitForData(page, value => value?.state === 'ready', { label: step.id })
    await callBoundHandler(page, 'changeView', { dataset: { view: 'FEEDBACK' } })
    await callBoundHandler(page, 'onRatingChange', { detail: { value: '4' } })
    await callBoundHandler(page, 'onBodyInput', { detail: { value: markers.feedback } })
    data = await waitForData(
      page,
      value => value?.activeView === 'FEEDBACK' && value?.rating === 5 && value?.body === markers.feedback,
      { label: `${step.id} draft` },
    )
    const previousVersion = Number(data.feedback?.version || 0)
    const mutation = mutationAttempt(report, persist, 'member-feedback-save')
    await callBoundHandler(page, 'saveFeedback')
    const saved = await waitForData(
      page,
      value => value?.state === 'ready'
        && value?.feedback?.body === markers.feedback
        && value?.feedback?.rating === 5
        && Number(value.feedback.version) > previousVersion,
      { label: step.id },
    )
    feedbackId = String(saved.feedback.id || '')
    invariant(feedbackId, 'Saved feedback is missing its authoritative id')
    confirmMutation(report, persist, mutation, { feedbackId, version: saved.feedback.version })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'saved',
      state: summarizeInteraction(saved, markers.feedback),
    })
  })

  await runStep('member-comment', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const ready = await waitForData(page, value => ['ready', 'empty'].includes(value?.state), { label: step.id })
    if (!ready.commentsEnabled) {
      await captureEvidence({
        miniProgram,
        outputDir,
        persist,
        step,
        label: 'disabled',
        state: summarizeCommentPage(ready, markers.comment),
      })
      runtimeFixtureMismatch('Comments are disabled for the exact event')
    }
    await callBoundHandler(page, 'updateDraft', { detail: { value: markers.comment } })
    await waitForData(page, value => value?.draft === markers.comment, { label: `${step.id} draft` })
    const mutation = mutationAttempt(report, persist, 'member-comment-publish')
    await callBoundHandler(page, 'submitComment')
    const published = await waitForData(
      page,
      value => (value?.comments || []).some(item => item?.body === markers.comment)
        && value?.submitting === false,
      { label: step.id },
    )
    const comment = published.comments.find(item => item.body === markers.comment)
    commentId = String(comment?.id || '')
    invariant(commentId && comment.mine === true && Number(comment.version) > 0, 'Created comment fact is incomplete')
    invariant(['PENDING', 'PUBLISHED'].includes(comment.status), `Created comment has unexpected status ${comment.status}`)
    confirmMutation(report, persist, mutation, { commentId, status: comment.status, version: comment.version })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'created',
      state: summarizeCommentPage(published, markers.comment),
    })
  })

  await runStep('admin-feedback', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const found = await findAdminFeedback(page, markers.feedback)
    if (!found.data.canRead) {
      runtimeFixtureMismatch('The current operator lacks events.feedback.read for the exact event')
    }
    invariant(found.match, 'The saved feedback is absent from the authoritative admin feedback page')
    invariant(found.match.id === feedbackId, 'Member/admin feedback ids do not match')
    invariant(found.match.rating === 5, 'Admin feedback rating does not match the saved fact')
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'matched',
      state: summarizeAdminFeedback(found.data, markers.feedback),
    })
  })

  await runStep('external-undo-check-in', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const before = await findRosterRegistration(page, registrationId)
    invariant(before.match?.status === 'ATTENDED', 'Registration is not ATTENDED before undo check-in')
    if (!before.data.canUndoCheckIn) {
      runtimeFixtureMismatch('The current operator lacks events.checkin.undo for the exact event')
    }
    const previousVersion = Number(before.match.version)
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'before-operator',
      state: summarizeRoster(before.data, registrationId),
    })
    console.log(`[external-wait] In the currently open DevTools, use the visible roster action to undo check-in for registration ${registrationId}, enter a reason, and confirm.`)
    const undone = await waitForData(
      page,
      (value) => {
        const item = (value?.items || []).find(candidate => candidate?.id === registrationId)
        return value?.state === 'ready' && item?.status === 'REGISTERED' && Number(item.version) > previousVersion
      },
      {
        externalWaitOnTimeout: true,
        label: step.id,
        timeoutMessage: 'Undo check-in still requires operator confirmation in the current DevTools page',
        timeoutMs: options.externalWaitTimeoutMs,
      },
    )
    registrationVersion = Number(undone.items.find(item => item.id === registrationId).version)
    const mutation = mutationAttempt(report, persist, 'operator-undo-check-in', { registrationId })
    confirmMutation(report, persist, mutation, { actor: 'external-operator', version: registrationVersion })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'operator-confirmed',
      state: summarizeRoster(undone, registrationId),
    })
  })

  await runStep('external-delete-comment', async (step, spec) => {
    const page = await openEventPage(miniProgram, spec, options.eventId)
    const before = await waitForData(
      page,
      value => ['ready', 'empty'].includes(value?.state)
        && (value?.comments || []).some(item => item?.id === commentId && item?.body === markers.comment),
      { label: step.id },
    )
    const comment = before.comments.find(item => item.id === commentId)
    invariant(comment?.canDelete === true, 'Created comment is not deletable from the bound user UI')
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'before-operator',
      state: summarizeCommentPage(before, markers.comment),
    })
    console.log(`[external-wait] In the currently open DevTools, delete the visible runtime comment ${commentId} and confirm the WeChat modal.`)
    const deleted = await waitForData(
      page,
      value => ['ready', 'empty'].includes(value?.state)
        && !(value?.comments || []).some(item => item?.id === commentId),
      {
        externalWaitOnTimeout: true,
        label: step.id,
        timeoutMessage: 'Comment deletion still requires operator confirmation in the current DevTools page',
        timeoutMs: options.externalWaitTimeoutMs,
      },
    )
    const mutation = mutationAttempt(report, persist, 'operator-soft-delete-comment', { commentId })
    confirmMutation(report, persist, mutation, { actor: 'external-operator' })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'operator-confirmed',
      state: summarizeCommentPage(deleted, markers.comment),
    })
  })

  await runStep('external-cancel-registration', async (step, spec) => {
    const page = await openAuthoritativePage(miniProgram, {
      expectedRoute: spec.route,
      label: step.id,
      selector: spec.selector,
      url: `/${spec.route}`,
    })
    await ensureRegistrationCategory(page, 'UPCOMING')
    const before = await findMyRegistration(page, options.eventId)
    invariant(before.match?.registrationId === registrationId, 'Exact registration is absent after undo check-in')
    invariant(before.match.status === 'REGISTERED' && before.match.canCancel === true, 'Exact registration is not cancellable after undo check-in')
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'before-operator',
      state: summarizeRegistrationFact(before.data, options.eventId),
    })
    console.log(`[external-wait] In the currently open DevTools, cancel registration ${registrationId} and confirm the WeChat modal.`)
    await waitForData(
      page,
      (value) => {
        const item = (value?.registrations || []).find(candidate => candidate?.registrationId === registrationId)
        return value?.state === 'ready' && (!item || ['CANCELLED', 'CANCELLATION_PENDING'].includes(item.status))
      },
      {
        externalWaitOnTimeout: true,
        label: step.id,
        timeoutMessage: 'Registration cancellation still requires operator confirmation in the current DevTools page',
        timeoutMs: options.externalWaitTimeoutMs,
      },
    )
    const detailSpec = contractSteps.get('member-event-detail')
    const detailPage = await openEventPage(miniProgram, detailSpec, options.eventId)
    const cancelled = await waitForData(
      detailPage,
      value => value?.state === 'ready' && value?.event?.registrationStatus === 'CANCELLED',
      {
        externalWaitOnTimeout: true,
        label: `${step.id} detail verification`,
        timeoutMessage: 'Event detail has not confirmed registrationStatus=CANCELLED',
        timeoutMs: Math.min(options.externalWaitTimeoutMs, 60_000),
      },
    )
    const mutation = mutationAttempt(report, persist, 'operator-cancel-registration', { registrationId })
    confirmMutation(report, persist, mutation, { actor: 'external-operator', status: 'confirmed' })
    await captureEvidence({
      miniProgram,
      outputDir,
      persist,
      step,
      label: 'operator-confirmed-detail',
      state: summarizeEventDetail(cancelled),
    })
  })

  const diagnosticFailures = diagnostics.failures()
  invariant(diagnosticFailures.length === 0, `Runtime diagnostics reported ${diagnosticFailures.length} error(s) or unknown warning(s)`)
}

export async function main(runArgs = process.argv.slice(2)) {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
  const contractSummary = validateFreeEventMutationContract(contract)
  if (runArgs.includes('--contract-only')) {
    const contractOptions = resolveFreeEventMutationOptions(root, runArgs, {})
    invariant(contractOptions.contractOnly, '--contract-only validation failed')
    return { status: 'contract-passed', ...contractSummary }
  }
  const localEnv = readEnv(path.join(root, '.env.local'))
  const env = resolveFreeEventRuntimeEnvironment(localEnv, process.env)
  const options = resolveFreeEventMutationOptions(root, runArgs, env)
  const buildSha = readStableRuntimeBuildSha()

  prepareRuntimeEvidenceDirectory(root, options.evidence)
  const outputDir = options.evidence.outputDir
  const reportPath = path.join(outputDir, 'report.json')
  const consolePath = path.join(outputDir, 'console.json')
  const explicitSecrets = [
    env.MINI_PROGRAM_APP_ID,
    env.CLOUDBASE_ENV_ID,
    env.CLOUDBASE_RESOURCE_APP_ID,
  ].filter(Boolean)
  const diagnostics = createRuntimeDiagnostics({
    allowlist: readRuntimeWarningAllowlist(warningAllowlistPath),
    explicitSecrets,
  })
  const markers = createMarkers()
  const report = createReport(contract, options, markers)
  let miniProgram

  function persist() {
    report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
    writeJsonAtomic(reportPath, report)
    writeJsonAtomic(consolePath, {
      entries: diagnostics.entries(),
      summary: diagnostics.summary(),
    })
  }

  persist()
  try {
    const configuredDevtoolsRoot = String(process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT || '').trim()
    if (configuredDevtoolsRoot && path.resolve(configuredDevtoolsRoot) !== root) {
      throw new ExternalWaitError('Mutating runtime only accepts the already-opened repository-root DevTools project')
    }
    let privateConfig
    try {
      privateConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.private.config.json'), 'utf8'))
    }
    catch {
      throw new ExternalWaitError('A readable project.private.config.json is required for AppID attestation')
    }
    if (privateConfig.appid !== env.MINI_PROGRAM_APP_ID) {
      throw new ExternalWaitError('project.private.config.json AppID does not match .env.local MINI_PROGRAM_APP_ID')
    }
    const devtoolsRoot = root
    const port = resolveProjectAutomatorPort(devtoolsRoot)
    if (!await isLocalPortListening(port)) {
      throw new ExternalWaitError('No already-running Automator listener exists for the exact DevTools project; open only that project and retry')
    }
    runBuild(buildSha)
    report.build = { compiledByDevtools: false, freshBundle: true, runtimeShaMatched: false }
    if (!await isLocalPortListening(port)) {
      throw new ExternalWaitError('The exact already-running Automator listener stopped during the build; reopen only that project and retry')
    }
    try {
      report.preflight = await assertRuntimePreflight(devtoolsRoot, {
        requiredRoutes: [...new Set(contract.steps.map(step => step.route))],
        requirePublicAppId: devtoolsRoot !== root,
        sourceRoot: devtoolsRoot === root ? 'src' : 'dist',
      })
        .then(value => ({
          appRoutesComplete: value.appRoutesComplete,
          conditionRoutesComplete: value.conditionRoutesComplete,
          devtoolsLoggedIn: value.devtoolsLoggedIn,
          hasPrivateConfig: value.hasPrivateConfig,
          hasRealAppId: value.hasRealAppId,
          servicePortEnabled: value.servicePortEnabled,
        }))
    }
    catch (error) {
      throw new ExternalWaitError(`Runtime preflight needs operator preparation: ${safeError(error, explicitSecrets)}`)
    }
    persist()

    try {
      report.deploymentAttestation = readDeploymentAttestation(env, options)
    }
    catch (error) {
      throw new ExternalWaitError(`Deployed development/test function facts could not be proven: ${safeError(error, explicitSecrets)}`)
    }
    persist()

    installMiniprogramAutomatorCompatibility()
    const acquireOptions = createOpenedAutomatorOptions({ contract, devtoolsRoot, port, sessionId })
    try {
      miniProgram = await acquireSharedMiniProgram(acquireOptions)
    }
    catch (error) {
      throw new ExternalWaitError(`The already-opened Automator session could not be acquired: ${safeError(error, explicitSecrets)}`)
    }
    miniProgram.on('console', payload => diagnostics.captureConsole(payload))
    miniProgram.on('exception', payload => diagnostics.captureException(payload))
    try {
      try {
        await miniProgram.compile({ force: true })
        report.build.compileMode = 'automator'
      }
      catch (error) {
        if (runtimeCompileDisposition(error) !== 'operator-wait') {
          throw new RuntimeStateError(`The opened DevTools compile failed: ${safeError(error, explicitSecrets)}`)
        }
        report.build.compileMode = 'operator-required'
        persist()
        await waitForOperatorBuild(miniProgram, buildSha, options.externalWaitTimeoutMs)
      }
      await miniProgram.waitForAppReady(60_000)
      report.build.compiledByDevtools = true
      report.runtimeAttestation = await readRuntimeAttestation(miniProgram, env, buildSha)
      report.build.runtimeShaMatched = report.runtimeAttestation.buildShaMatched
    }
    catch (error) {
      if (error instanceof RuntimeStateError) {
        throw error
      }
      throw new ExternalWaitError(`The opened DevTools runtime could not prove its AppID, fresh build, CloudBase environment, and health: ${safeError(error, explicitSecrets)}`)
    }
    report.viewport = createObservedViewportEvidence(await miniProgram.systemInfo(), options.evidence.viewportProfile)
    assertViewportEvidence(report.viewport)
    report.automator = {
      openedOnly: acquireOptions.openedOnly,
      preferOpenedSession: acquireOptions.preferOpenedSession,
      sharedSession: acquireOptions.sharedSession,
    }
    persist()

    await executeWorkflow({
      contract,
      diagnostics,
      markers,
      miniProgram,
      options,
      outputDir,
      persist,
      report,
    })
    report.status = report.steps.some(step => step.status === 'external-wait') ? 'external-wait' : 'passed'
  }
  catch (error) {
    report.status = error instanceof ExternalWaitError ? 'external-wait' : 'failed'
    report.error = safeError(error, explicitSecrets)
  }
  finally {
    if (miniProgram) {
      try {
        await clearRuntimeAcceptanceStorage(miniProgram)
      }
      catch (error) {
        report.status = 'failed'
        report.error = safeError(error, explicitSecrets)
      }
    }
    const cleanupStatus = await Promise.race([
      miniProgram
        ? closeSharedMiniProgram(
            root,
            sessionId,
          ).then(() => 'closed').catch(() => 'failed')
        : Promise.resolve('not-opened'),
      new Promise(resolve => setTimeout(resolve, 5000, 'timed-out')),
    ])
    report.automatorSessionCleanup = { status: cleanupStatus }
    report.businessCleanup = summarizeMutationCleanup(report.steps, report.mutations)
    report.diagnostics = diagnostics.summary()
    report.completedAt = currentIsoTime()
    if (report.status !== 'failed' && diagnostics.failures().length > 0) {
      report.status = 'failed'
      report.error = `Runtime diagnostics reported ${diagnostics.failures().length} error(s) or unknown warning(s)`
    }
    persist()
  }
  return report
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === directEntry) {
  main().then((report) => {
    if (report.status === 'external-wait') {
      process.exitCode = 2
    }
    else if (!['passed', 'contract-passed'].includes(report.status)) {
      process.exitCode = 1
    }
    console.log(JSON.stringify({
      businessCleanup: report.businessCleanup?.status,
      eventId: report.eventId,
      status: report.status,
    }))
  }).catch((error) => {
    console.error(safeError(error))
    process.exitCode = 1
  })
}
