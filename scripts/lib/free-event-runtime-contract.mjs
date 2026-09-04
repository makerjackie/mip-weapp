import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { resolveRuntimeEvidenceOptions } from './runtime-evidence.mjs'

export const MUTATING_RUNTIME_CONFIRMATION = '--confirm-mutating-runtime'

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const booleanOptions = new Set([
  MUTATING_RUNTIME_CONFIRMATION,
  '--contract-only',
])
const valueOptions = new Set([
  '--confirm-env',
  '--event-id',
  '--external-wait-timeout-ms',
  '--output-dir',
  '--stage',
  '--viewport',
])
const expectedStepSpecs = [
  {
    id: 'member-event-detail',
    route: 'packages/member/mip-events/detail/index',
    selector: '#mip-event-detail-page',
    mode: 'automated-read',
  },
  {
    id: 'member-registration',
    route: 'packages/member/mip-events/registration/index',
    selector: '#mip-event-registration-page',
    mode: 'automated-mutation',
    handlers: ['onTextInput', 'onSelectChange', 'onBooleanChange', 'onShareProfileChange', 'submit'],
  },
  {
    id: 'member-registration-fact',
    route: 'packages/member/mip-events/mine/index',
    selector: '#mip-events-mine-page',
    mode: 'automated-read',
  },
  {
    id: 'admin-roster',
    route: 'packages/admin/event-registrations/index',
    selector: '#admin-event-registrations-page',
    mode: 'automated-read',
  },
  {
    id: 'admin-check-in',
    route: 'packages/admin/event-registrations/index',
    selector: '#admin-event-registrations-page',
    mode: 'automated-mutation',
    handlers: ['checkIn'],
  },
  {
    id: 'member-heart',
    route: 'packages/member/mip-events/interaction/index',
    selector: '#mip-event-interaction-page',
    mode: 'automated-mutation',
    handlers: ['chooseHeart'],
    unavailable: 'external-wait-continue',
  },
  {
    id: 'member-feedback',
    route: 'packages/member/mip-events/feedback/index',
    selector: '#mip-event-feedback-page',
    mode: 'automated-mutation',
    handlers: [
      'selectRating',
      'selectRecommendation',
      'toggleRole',
      'onBodyInput',
      'selectJoinIntent',
      'toggleExplorationMethod',
      'selectRosterConsent',
      'saveFeedback',
    ],
  },
  {
    id: 'member-comment',
    route: 'packages/member/mip-events/comments/index',
    selector: '#mip-event-comments-page',
    mode: 'automated-mutation',
    handlers: ['updateDraft', 'submitComment'],
  },
  {
    id: 'external-undo-check-in',
    route: 'packages/admin/event-registrations/index',
    selector: '#admin-event-registrations-page',
    mode: 'external-wait',
    handler: 'undoCheckIn',
  },
  {
    id: 'external-delete-comment',
    route: 'packages/member/mip-events/comments/index',
    selector: '#mip-event-comments-page',
    mode: 'external-wait',
    handler: 'deleteComment',
  },
  {
    id: 'external-cancel-registration',
    route: 'packages/member/mip-events/mine/index',
    selector: '#mip-events-mine-page',
    mode: 'external-wait',
    handler: 'cancelRegistration',
  },
]
const expectedSteps = expectedStepSpecs.map(step => step.id)
const expectedExternalSteps = expectedStepSpecs
  .filter(step => step.mode === 'external-wait')
  .map(step => step.id)
const guardedEnvironmentKeys = [
  'CLOUDBASE_ENV_ID',
  'CLOUDBASE_RESOURCE_APP_ID',
  'MINI_PROGRAM_APP_ID',
  'MIP_ADMIN_FUNCTION_NAME',
  'MIP_CATALOG_STAGE',
  'MIP_COMMUNITY_FUNCTION_NAME',
  'MIP_DEPLOYMENT_STAGE',
  'MIP_EVENTS_FUNCTION_NAME',
  'MIP_PAYMENT_MODE',
]
const gitHeadPattern = /^[0-9a-f]{40}$/i
const runtimeInputPrefixes = ['config/', 'scripts/', 'src/']
const runtimeInputFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'postcss.config.js',
  'project.config.json',
  'tsconfig.json',
  'weapp-vite.config.ts',
])

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function normalizedRepoPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '')
}

function isRuntimeInputPath(value) {
  const candidate = normalizedRepoPath(value)
  return runtimeInputFiles.has(candidate)
    || runtimeInputPrefixes.some(prefix => candidate === prefix.slice(0, -1) || candidate.startsWith(prefix))
}

export function resolveFreeEventRuntimeBuildSha(headSha, dirtyPaths = []) {
  const normalizedHead = String(headSha || '').trim().toLowerCase()
  invariant(gitHeadPattern.test(normalizedHead), 'Mutating runtime requires one exact 40-character Git HEAD')
  invariant(Array.isArray(dirtyPaths), 'Mutating runtime dirty paths must be an array')
  const blockingPaths = [...new Set(dirtyPaths
    .map(normalizedRepoPath)
    .filter(isRuntimeInputPath))]
    .sort()
  invariant(
    blockingPaths.length === 0,
    `Mutating runtime requires committed executable inputs: ${blockingPaths.join(', ')}`,
  )
  return `free-event-runtime-${normalizedHead}`
}

function optionName(argument) {
  const separator = argument.indexOf('=')
  return separator === -1 ? argument : argument.slice(0, separator)
}

function parseArguments(args) {
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      invariant(index === 0 && flags.size === 0 && values.size === 0, 'The pnpm argument separator must be first')
      continue
    }
    const name = optionName(argument)
    invariant(booleanOptions.has(name) || valueOptions.has(name), `Unknown mutating runtime option: ${argument}`)
    invariant(!values.has(name) && !flags.has(name), `${name} may only be provided once`)
    if (booleanOptions.has(name)) {
      invariant(argument === name, `${name} does not accept a value`)
      flags.add(name)
      continue
    }
    let value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : undefined
    if (value === undefined) {
      value = args[index + 1]
      invariant(value && !value.startsWith('--'), `${name} requires a value`)
      index += 1
    }
    invariant(value.trim(), `${name} requires a value`)
    values.set(name, value.trim())
  }
  return { flags, values }
}

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && expected.every(value => actual.includes(value))
}

export function validateFreeEventMutationContract(contract) {
  invariant(contract && typeof contract === 'object', 'Free event mutation contract must be an object')
  invariant(contract.schemaVersion === 1, 'Unsupported free event mutation contract schema')
  invariant(contract.mutating === true, 'Free event runtime contract must be explicitly mutating')
  invariant(
    contract.confirmationFlag === MUTATING_RUNTIME_CONFIRMATION,
    `Free event runtime contract must require ${MUTATING_RUNTIME_CONFIRMATION}`,
  )
  invariant(
    sameMembers(contract.allowedStages || [], ['development', 'test']),
    'Free event mutation runtime is restricted to development and test',
  )
  invariant(contract.event?.idFormat === 'uuid', 'Free event runtime requires an exact UUID eventId')
  invariant(contract.event?.accessType === 'FREE', 'Free event runtime must require a FREE event')
  invariant(contract.event?.mode === 'OFFLINE', 'Free event runtime must require an OFFLINE event')
  invariant(contract.event?.status === 'PUBLISHED', 'Free event runtime must require a PUBLISHED event')
  invariant(contract.event?.registrationPolicy === 'AUTO', 'Free event runtime must require AUTO registration')

  const connection = contract.connection || {}
  invariant(connection.openedOnly === true, 'Mutating runtime must attach to an already opened Automator')
  invariant(connection.preferOpenedSession === true, 'Mutating runtime must prefer the opened Automator session')
  invariant(connection.sharedSession === true, 'Mutating runtime must use a shared Automator session')
  invariant(connection.allowProjectWarmup === false, 'Mutating runtime cannot warm or open DevTools')
  invariant(connection.allowSecondDevtoolsInstance === false, 'Mutating runtime cannot open a second DevTools instance')
  invariant(connection.allowDirectDatabaseWrites === false, 'Mutating runtime cannot replace UI actions with database writes')
  const runtimeAttestation = contract.runtimeAttestation || {}
  for (const key of [
    'requirePrivateConfigAppId',
    'requireDevelopEnvVersion',
    'requireFreshBuildSha',
    'requireDevtoolsCompile',
    'requireEventsMysqlHealth',
  ]) {
    invariant(runtimeAttestation[key] === true, `Mutating runtime attestation must enable ${key}`)
  }
  const deploymentAttestation = contract.deploymentAttestation || {}
  invariant(
    sameMembers(deploymentAttestation.roles || [], ['events', 'community', 'admin']),
    'Mutating runtime must attest events, community, and admin deployments',
  )
  invariant(deploymentAttestation.requireExactStage === true, 'Mutating runtime must require the exact deployed stage')
  invariant(deploymentAttestation.requireTestCatalog === true, 'Mutating runtime must require the TEST catalog')
  invariant(deploymentAttestation.rejectLivePayment === true, 'Mutating runtime must reject live payment')

  invariant(Array.isArray(contract.steps), 'Free event mutation contract requires steps[]')
  invariant(
    contract.steps.map(step => step.id).join('|') === expectedSteps.join('|'),
    'Free event mutation steps or ordering changed unexpectedly',
  )
  const ids = new Set()
  for (const [index, step] of contract.steps.entries()) {
    const expected = expectedStepSpecs[index]
    invariant(!ids.has(step.id), `Duplicate free event runtime step: ${step.id}`)
    ids.add(step.id)
    invariant(/^(?:packages|pages)\/[a-z0-9/-]+$/i.test(step.route), `Invalid route for ${step.id}`)
    invariant(/^#[a-z][\w-]*$/i.test(step.selector), `Invalid selector for ${step.id}`)
    invariant(
      ['automated-read', 'automated-mutation', 'external-wait'].includes(step.mode),
      `Invalid execution mode for ${step.id}`,
    )
    invariant(step.route === expected.route, `${step.id} route changed unexpectedly`)
    invariant(step.selector === expected.selector, `${step.id} selector changed unexpectedly`)
    invariant(step.mode === expected.mode, `${step.id} execution mode changed unexpectedly`)
    if (expected.handlers) {
      invariant(
        Array.isArray(step.handlers) && step.handlers.join('|') === expected.handlers.join('|'),
        `${step.id} bound page handlers changed unexpectedly`,
      )
    }
    else {
      invariant(step.handlers === undefined, `${step.id} cannot declare bound page handlers`)
    }
    if (expected.handler) {
      invariant(step.handler === expected.handler, `${step.id} bound page handler changed unexpectedly`)
    }
    else {
      invariant(step.handler === undefined, `${step.id} cannot declare a singular page handler`)
    }
    if (expected.unavailable) {
      invariant(step.unavailable === expected.unavailable, `${step.id} unavailable policy changed unexpectedly`)
    }
    else {
      invariant(step.unavailable === undefined, `${step.id} cannot declare an unavailable policy`)
    }
    for (const handler of step.handlers || []) {
      invariant(/^[a-z][A-Za-z0-9]*$/.test(handler), `Invalid handler for ${step.id}`)
      invariant(!handler.startsWith('execute'), `${step.id} cannot bypass a bound UI handler`)
    }
  }
  const external = contract.steps.filter(step => step.mode === 'external-wait')
  invariant(
    external.map(step => step.id).join('|') === expectedExternalSteps.join('|'),
    'Confirmation-modal cleanup must remain an ordered external wait',
  )
  for (const step of external) {
    invariant(typeof step.reason === 'string' && step.reason.length >= 40, `${step.id} requires an explicit external-wait reason`)
  }
  invariant(
    contract.deviceRequiredRemaining?.some(item => item.id === 'qr-check-in'),
    'QR check-in must remain explicitly device-required',
  )
  return {
    routeCount: new Set(contract.steps.map(step => step.route)).size,
    stepCount: contract.steps.length,
  }
}

export function resolveFreeEventRuntimeEnvironment(localEnv = {}, processEnv = {}) {
  const resolved = { ...localEnv, ...processEnv }
  for (const key of guardedEnvironmentKeys) {
    const localValue = String(localEnv[key] || '').trim()
    const processValue = String(processEnv[key] || '').trim()
    invariant(
      !localValue || !processValue || localValue === processValue,
      `${key} conflicts between .env.local and the process environment`,
    )
    if (localValue) {
      resolved[key] = localValue
    }
  }
  for (const key of ['CLOUDBASE_ENV_ID', 'MINI_PROGRAM_APP_ID', 'MIP_DEPLOYMENT_STAGE']) {
    invariant(String(localEnv[key] || '').trim(), `.env.local must configure ${key}`)
  }
  invariant(/^wx[0-9a-f]{16}$/i.test(resolved.MINI_PROGRAM_APP_ID), '.env.local MINI_PROGRAM_APP_ID is invalid')
  resolved.MIP_CATALOG_STAGE = String(resolved.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
  resolved.MIP_PAYMENT_MODE = String(resolved.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
  return resolved
}

export function resolveFreeEventMutationOptions(root, args, env = process.env) {
  const parsed = parseArguments(args)
  const contractOnly = parsed.flags.has('--contract-only')
  if (contractOnly) {
    invariant(parsed.flags.size === 1 && parsed.values.size === 0, '--contract-only cannot be combined with runtime execution options')
    return { contractOnly: true }
  }

  invariant(parsed.flags.has(MUTATING_RUNTIME_CONFIRMATION), `Runtime mutation requires ${MUTATING_RUNTIME_CONFIRMATION}`)
  const eventId = parsed.values.get('--event-id') || ''
  invariant(eventIdPattern.test(eventId), '--event-id must be one exact UUID')
  const confirmedEnvId = parsed.values.get('--confirm-env') || ''
  invariant(
    confirmedEnvId && confirmedEnvId === String(env.CLOUDBASE_ENV_ID || '').trim(),
    'Mutating runtime requires --confirm-env=<exact .env.local CLOUDBASE_ENV_ID>',
  )
  const stage = String(parsed.values.get('--stage') || '').toLowerCase()
  invariant(['development', 'test'].includes(stage), '--stage must be development or test')
  invariant(
    String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase() === stage,
    '--stage must exactly match .env.local MIP_DEPLOYMENT_STAGE',
  )
  const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
  invariant(['disabled', 'test'].includes(paymentMode), 'Mutating runtime requires disabled or test payment mode')
  invariant(
    String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase() === 'TEST',
    'Mutating runtime requires MIP_CATALOG_STAGE=TEST',
  )
  invariant(parsed.values.has('--output-dir'), 'Mutating runtime requires a new isolated --output-dir')
  const evidence = resolveRuntimeEvidenceOptions(root, args)
  invariant(evidence.isolated, 'Mutating runtime evidence must use an isolated output directory')

  const requestedTimeout = parsed.values.get('--external-wait-timeout-ms') || '300000'
  const externalWaitTimeoutMs = Number(requestedTimeout)
  invariant(
    Number.isInteger(externalWaitTimeoutMs)
    && externalWaitTimeoutMs >= 10_000
    && externalWaitTimeoutMs <= 900_000,
    '--external-wait-timeout-ms must be an integer from 10000 to 900000',
  )
  return {
    confirmation: true,
    contractOnly: false,
    eventId,
    evidence,
    externalWaitTimeoutMs,
    stage,
  }
}

export function createOpenedAutomatorOptions({ contract, devtoolsRoot, port, sessionId }) {
  validateFreeEventMutationContract(contract)
  invariant(path.isAbsolute(devtoolsRoot), 'DevTools project root must be absolute')
  invariant(Number.isInteger(port) && port > 0 && port <= 65535, 'Automator port is invalid')
  invariant(typeof sessionId === 'string' && sessionId.length >= 8, 'Automator session id is invalid')
  return {
    openedOnly: true,
    port,
    preferOpenedSession: true,
    preserveProjectRoot: true,
    projectPath: devtoolsRoot,
    sessionId,
    sharedSession: true,
    timeout: 60_000,
    trustProject: true,
  }
}

export function runtimeCompileDisposition(error) {
  const message = typeof error === 'string' ? error : error?.message
  return message === 'unimplemented' ? 'operator-wait' : 'failed'
}

function registrationText(marker, maxLength) {
  const maximum = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 200
  return marker.slice(0, maximum) || '验'
}

export function planRegistrationFieldActions(fields, marker) {
  invariant(Array.isArray(fields), 'Registration fields must be an array')
  invariant(typeof marker === 'string' && marker.trim(), 'Registration marker is required')
  const actions = []
  const unavailable = []
  for (const [index, field] of fields.entries()) {
    if (field.type === 'TEXT' || field.type === 'TEXTAREA') {
      actions.push({ handler: 'onTextInput', index, value: registrationText(marker, field.maxLength) })
    }
    else if (field.type === 'SELECT') {
      if (Array.isArray(field.options) && field.options.length > 0) {
        actions.push({ handler: 'onSelectChange', index, value: '0' })
      }
      else if (field.required) {
        unavailable.push({ index, reason: 'required SELECT field has no options' })
      }
    }
    else if (field.type === 'BOOLEAN') {
      actions.push({ handler: 'onBooleanChange', index, value: field.required === true })
    }
    else {
      unavailable.push({ index, reason: `unsupported registration field type: ${String(field.type)}` })
    }
  }
  return { actions, unavailable }
}

export function markerSha256(marker) {
  return createHash('sha256').update(marker).digest('hex')
}

export function runtimeRouteDisposition(actualRoute, expectedRoute) {
  const normalizedActual = String(actualRoute || '').replace(/^\//, '').split('?')[0]
  const normalizedExpected = String(expectedRoute || '').replace(/^\//, '').split('?')[0]
  if (normalizedActual === 'packages/member/mip-access/index') {
    return 'external-wait'
  }
  return normalizedActual === normalizedExpected ? 'matched' : 'failed'
}

export function isReusableFreeEventRegistrationStatus(status) {
  return status === undefined || status === null || status === '' || status === 'CANCELLED'
}

export function summarizeMutationCleanup(steps, mutations) {
  const actions = steps
    .filter(step => step.mode === 'external-wait')
    .map(step => ({ id: step.id, status: step.status === 'passed' ? 'confirmed' : step.status }))
  const allConfirmed = actions.length > 0 && actions.every(action => action.status === 'confirmed')
  const noWorkStarted = mutations.length === 0 && actions.every(action => action.status === 'not-run')
  const persistentFactConfirmed = mutations.some(mutation => (
    mutation.status === 'confirmed'
    && ['member-feedback-save', 'member-heart-select'].includes(mutation.action)
  ))
  const uncertainMutation = mutations.some(mutation => mutation.status !== 'confirmed')
  const businessStateMayRemain = mutations.length > 0
    && (!allConfirmed || persistentFactConfirmed || uncertainMutation)
  return {
    automated: false,
    businessStateMayRemain,
    factsNotTargetedByCleanup: ['heart', 'feedback'],
    operatorActions: {
      actions,
      status: noWorkStarted ? 'not-started' : allConfirmed ? 'confirmed' : 'incomplete',
    },
    status: noWorkStarted ? 'not-started' : allConfirmed ? 'partial' : 'incomplete',
  }
}

export function validateRuntimeAttestation(actual, expected) {
  const miniProgram = actual?.account?.miniProgram || {}
  const app = actual?.app || {}
  const health = actual?.health || {}
  invariant(miniProgram.appId === expected.appId, 'The opened DevTools AppID does not match the confirmed local AppID')
  invariant(miniProgram.envVersion === 'develop', 'Mutating runtime requires the develop Mini Program environment')
  invariant(app.buildSha === expected.buildSha, 'The opened DevTools is not running the freshly built mutation runner bundle')
  invariant(app.cloudbaseEnvId === expected.envId, 'The running Mini Program CloudBase EnvID does not match --confirm-env')
  invariant(['direct', 'shared'].includes(app.cloudbaseMode), 'The running Mini Program has CloudBase disabled')
  invariant(app.catalogStage === 'TEST', 'The running Mini Program catalog is not TEST')
  invariant(app.paymentMode === expected.paymentMode && app.paymentMode !== 'live', 'The running Mini Program payment mode is unsafe')
  invariant(health.ok === true, 'The running Mini Program could not reach the events health endpoint')
  invariant(
    health.data?.service === 'mip-events-api' && health.data?.persistence === 'cloudbase-mysql',
    'The running Mini Program events health endpoint did not prove CloudBase MySQL persistence',
  )
  return {
    appIdMatched: true,
    buildShaMatched: true,
    catalogStage: app.catalogStage,
    cloudbaseEnvMatched: true,
    cloudbaseMode: app.cloudbaseMode,
    envVersion: miniProgram.envVersion,
    eventsHealth: 'cloudbase-mysql',
    paymentMode: app.paymentMode,
  }
}

export function validateDeploymentAttestation(details, expected) {
  const roles = ['events', 'community', 'admin']
  for (const role of roles) {
    const detail = details?.[role] || {}
    const variables = detail.variables || {}
    invariant(
      detail.status === 'Active' && detail.availableStatus === 'Available',
      `${role} Cloud Function is not active and available`,
    )
    invariant(
      variables.MIP_DEPLOYMENT_STAGE === expected.stage,
      `${role} Cloud Function deployment stage does not match --stage`,
    )
    const allowedAppIds = String(variables.MIP_ALLOWED_APP_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    invariant(allowedAppIds.includes(expected.appId), `${role} Cloud Function does not allow the confirmed AppID`)
  }
  invariant(
    details.events.variables.MIP_PAYMENT_MODE === expected.paymentMode
    && details.events.variables.MIP_PAYMENT_MODE !== 'live',
    'events Cloud Function payment mode is unsafe or mismatched',
  )
  for (const role of ['community', 'admin']) {
    invariant(details[role].variables.MIP_CATALOG_STAGE === 'TEST', `${role} Cloud Function catalog is not TEST`)
  }
  return {
    allowedAppIdMatched: true,
    catalogStage: 'TEST',
    deploymentStage: expected.stage,
    paymentMode: expected.paymentMode,
    rolesVerified: roles,
  }
}

export function summarizeEventDetail(data) {
  const event = data?.event
  return {
    state: data?.state || null,
    primaryAction: data?.primaryAction || null,
    event: event
      ? {
          accessType: event.accessType || null,
          canRegister: event.canRegister === true,
          id: event.id || null,
          mode: event.mode || null,
          registrationPolicy: event.registrationPolicy || null,
          registrationStatus: event.registrationStatus || null,
          status: event.status || null,
        }
      : null,
  }
}

export function summarizeRegistrationSubmission(data) {
  return {
    state: data?.state || null,
    resultTitle: data?.resultTitle || null,
    event: data?.event
      ? {
          accessType: data.event.accessType || null,
          id: data.event.id || null,
          mode: data.event.mode || null,
          registrationPolicy: data.event.registrationPolicy || null,
        }
      : null,
  }
}

export function summarizeRegistrationFact(data, eventId) {
  const registration = (data?.registrations || []).find(item => item?.event?.id === eventId)
  return {
    state: data?.state || null,
    category: data?.activeCategory || null,
    registration: registration
      ? {
          canCancel: registration.canCancel === true,
          eventId: registration.event.id,
          registrationId: registration.registrationId,
          status: registration.status,
          version: registration.version,
        }
      : null,
  }
}

export function summarizeRoster(data, registrationId) {
  const item = (data?.items || []).find(candidate => candidate?.id === registrationId)
  return {
    state: data?.state || null,
    capabilities: {
      checkIn: data?.canCheckIn === true,
      undoCheckIn: data?.canUndoCheckIn === true,
    },
    registration: item
      ? {
          id: item.id,
          status: item.status,
          version: item.version,
        }
      : null,
  }
}

export function hasExactHeartCandidateState(data, {
  participantRef,
  previousVersion,
  selected,
}) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  const heart = data?.heart
  const version = Number(heart?.version)
  const baseline = Number(previousVersion)
  if (data?.state !== 'ready'
    || typeof participantRef !== 'string'
    || !participantRef
    || !Number.isFinite(version)
    || !Number.isFinite(baseline)
    || version <= baseline) {
    return false
  }
  const candidate = candidates.find(item => item?.participantRef === participantRef)
  const selectedCandidates = candidates.filter(item => item?.selected === true)
  if (selected === true) {
    return candidate?.selected === true
      && selectedCandidates.length === 1
      && Boolean(heart?.targetRef)
  }
  return candidate?.selected === false
    && selectedCandidates.length === 0
    && !heart?.targetRef
}

export function summarizeInteraction(data) {
  return {
    state: data?.state || null,
    activeView: data?.activeView || null,
    candidateCount: Array.isArray(data?.candidates) ? data.candidates.length : 0,
    heart: data?.heart
      ? {
          selected: Boolean(data.heart.targetRef),
          version: data.heart.version,
        }
      : null,
  }
}

export function summarizeFeedback(data, feedbackMarker) {
  const feedback = data?.feedback
  return {
    state: data?.state || null,
    eventId: data?.event?.id || null,
    feedback: feedback
      ? {
          id: feedback.id,
          markerMatches: feedback.body === feedbackMarker,
          rating: feedback.rating || null,
          recommendation: feedback.answers?.recommendation || null,
          roleCount: Array.isArray(feedback.answers?.roleKeys) ? feedback.answers.roleKeys.length : 0,
          joinIntent: feedback.answers?.joinIntent || null,
          explorationMethodCount: Array.isArray(feedback.answers?.explorationMethods)
            ? feedback.answers.explorationMethods.length
            : 0,
          rosterConsent: feedback.answers?.rosterConsent || null,
          version: feedback.version,
        }
      : null,
  }
}

export function summarizeCommentPage(data, commentMarker) {
  const comment = (data?.comments || []).find(item => item?.body === commentMarker)
  return {
    state: data?.state || null,
    commentsEnabled: data?.commentsEnabled === true,
    moderationMode: data?.moderationMode || null,
    comment: comment
      ? {
          canDelete: comment.canDelete === true,
          id: comment.id,
          markerMatches: true,
          mine: comment.mine === true,
          status: comment.status,
          version: comment.version,
        }
      : null,
  }
}
