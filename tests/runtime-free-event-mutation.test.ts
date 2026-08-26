import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createOpenedAutomatorOptions,
  isReusableFreeEventRegistrationStatus,
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
  summarizeRoster,
  validateDeploymentAttestation,
  validateFreeEventMutationContract,
  validateRuntimeAttestation,
} from '../scripts/lib/free-event-runtime-contract.mjs'
import { openAuthoritativePage } from '../scripts/verify-free-event-runtime.mjs'

const root = path.resolve(import.meta.dirname, '..')
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-free-event-mutation.json'), 'utf8'))
const eventId = '60000000-0000-4000-8000-000000000099'
const envId = 'cloud1-runtime-test'
const appId = 'wx0123456789abcdef'
const executionArgs = [
  '--confirm-mutating-runtime',
  `--confirm-env=${envId}`,
  `--event-id=${eventId}`,
  '--stage=test',
  '--output-dir=.tmp/runtime-evidence/free-event-run-1',
]
const executionEnv = {
  CLOUDBASE_ENV_ID: envId,
  MINI_PROGRAM_APP_ID: appId,
  MIP_CATALOG_STAGE: 'TEST',
  MIP_DEPLOYMENT_STAGE: 'test',
  MIP_PAYMENT_MODE: 'disabled',
}

function contractWithStep(id: string, update: Record<string, unknown>) {
  const value = structuredClone(contract)
  const step = value.steps.find((candidate: { id: string }) => candidate.id === id)
  expect(step).toBeDefined()
  Object.assign(step, update)
  return value
}

describe('free offline event mutation runtime contract', () => {
  it('keeps the flow isolated from the read-only runtime contract', () => {
    expect(validateFreeEventMutationContract(contract)).toEqual({ routeCount: 7, stepCount: 12 })
    expect(contract.connection).toMatchObject({
      allowDirectDatabaseWrites: false,
      allowProjectWarmup: false,
      allowSecondDevtoolsInstance: false,
      openedOnly: true,
      preferOpenedSession: true,
      sharedSession: true,
    })

    const runtimePages = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-pages.json'), 'utf8'))
    expect(runtimePages.interactionJourneys.length).toBeGreaterThan(0)
    expect(runtimePages.interactionJourneys.every((journey: { nonMutating?: boolean }) => journey.nonMutating === true)).toBe(true)
    expect(fs.readFileSync(path.join(root, 'scripts/verify-runtime.mjs'), 'utf8'))
      .toContain('journey.nonMutating === true')
    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['runtime:free-event'])
      .toBe('node scripts/verify-free-event-runtime.mjs')
  })

  it('fails closed when any exact mutation step binding drifts', () => {
    const driftCases = [
      {
        contract: contractWithStep('member-event-detail', { route: 'pages/index/index' }),
        message: 'member-event-detail route changed unexpectedly',
      },
      {
        contract: contractWithStep('admin-roster', { selector: '#other-admin-page' }),
        message: 'admin-roster selector changed unexpectedly',
      },
      {
        contract: contractWithStep('member-registration', { mode: 'automated-read' }),
        message: 'member-registration execution mode changed unexpectedly',
      },
      {
        contract: contractWithStep('member-feedback', {
          handlers: ['changeView', 'onBodyInput', 'onRatingChange', 'saveFeedback'],
        }),
        message: 'member-feedback bound page handlers changed unexpectedly',
      },
      {
        contract: contractWithStep('external-delete-comment', { handler: 'submitComment' }),
        message: 'external-delete-comment bound page handler changed unexpectedly',
      },
      {
        contract: contractWithStep('member-heart', { unavailable: 'failed' }),
        message: 'member-heart unavailable policy changed unexpectedly',
      },
      {
        contract: contractWithStep('member-event-detail', { handler: 'loadEvent' }),
        message: 'member-event-detail cannot declare a singular page handler',
      },
    ]
    for (const drift of driftCases) {
      expect(() => validateFreeEventMutationContract(drift.contract)).toThrow(drift.message)
    }
  })

  it('requires explicit confirmation, one exact event id, a safe stage, and isolated evidence', () => {
    expect(resolveFreeEventMutationOptions(root, executionArgs, executionEnv)).toMatchObject({
      confirmation: true,
      contractOnly: false,
      eventId,
      externalWaitTimeoutMs: 300000,
      stage: 'test',
    })
    expect(() => resolveFreeEventMutationOptions(root, executionArgs.slice(1), executionEnv))
      .toThrow('requires --confirm-mutating-runtime')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs.map(value => value.startsWith('--event-id=') ? '--event-id=demo' : value), executionEnv))
      .toThrow('one exact UUID')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs.map(value => value === '--stage=test' ? '--stage=production' : value), {
      ...executionEnv,
      MIP_DEPLOYMENT_STAGE: 'production',
    })).toThrow('development or test')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs.filter(value => !value.startsWith('--output-dir=')), executionEnv))
      .toThrow('new isolated --output-dir')
    expect(() => resolveFreeEventMutationOptions(root, [...executionArgs, '--unknown'], executionEnv))
      .toThrow('Unknown mutating runtime option')
  })

  it('matches the declared local stage and refuses live commerce configuration', () => {
    expect(() => resolveFreeEventMutationOptions(root, executionArgs, {
      ...executionEnv,
      MIP_DEPLOYMENT_STAGE: 'development',
    })).toThrow('exactly match')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs, {
      ...executionEnv,
      MIP_PAYMENT_MODE: 'live',
    })).toThrow('disabled or test payment mode')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs, {
      ...executionEnv,
      MIP_CATALOG_STAGE: 'LIVE',
    })).toThrow('MIP_CATALOG_STAGE=TEST')
    expect(resolveFreeEventMutationOptions(root, ['--contract-only'], {})).toEqual({ contractOnly: true })
    expect(resolveFreeEventMutationOptions(root, ['--', '--contract-only'], {})).toEqual({ contractOnly: true })
    expect(() => resolveFreeEventMutationOptions(root, [...executionArgs, '--skip-build'], executionEnv))
      .toThrow('Unknown mutating runtime option')
    expect(() => resolveFreeEventMutationOptions(root, executionArgs, {
      ...executionEnv,
      MIP_PAYMENT_MODE: 'unsafe',
    })).toThrow('disabled or test payment mode')
  })

  it('uses local runtime identity as the guarded source of truth', () => {
    expect(resolveFreeEventRuntimeEnvironment(executionEnv, { CLOUDBASE_API_KEY: 'local-key' })).toMatchObject({
      CLOUDBASE_API_KEY: 'local-key',
      CLOUDBASE_ENV_ID: envId,
      MINI_PROGRAM_APP_ID: appId,
      MIP_CATALOG_STAGE: 'TEST',
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_PAYMENT_MODE: 'disabled',
    })
    expect(() => resolveFreeEventRuntimeEnvironment(executionEnv, {
      MINI_PROGRAM_APP_ID: 'wxabcdef0123456789',
    })).toThrow('conflicts between .env.local and the process environment')
    expect(() => resolveFreeEventRuntimeEnvironment({
      MINI_PROGRAM_APP_ID: appId,
      MIP_DEPLOYMENT_STAGE: 'test',
    }, {})).toThrow('.env.local must configure CLOUDBASE_ENV_ID')
  })

  it('can only acquire the already-opened shared Automator session', () => {
    expect(createOpenedAutomatorOptions({
      contract,
      devtoolsRoot: root,
      port: 29513,
      sessionId: 'mip-mutating-test',
    })).toMatchObject({
      openedOnly: true,
      port: 29513,
      preferOpenedSession: true,
      preserveProjectRoot: true,
      projectPath: root,
      sharedSession: true,
    })
  })

  it('uses one stable clean Git commit as the mutation build identity', () => {
    const headSha = 'A'.repeat(40)
    expect(resolveFreeEventRuntimeBuildSha(headSha, [
      'docs/mip/PROJECT_STATUS.md',
      'docs/research/legacy-mip-app/README.md',
    ])).toBe(`free-event-runtime-${headSha.toLowerCase()}`)
    expect(() => resolveFreeEventRuntimeBuildSha('a'.repeat(39), []))
      .toThrow('one exact 40-character Git HEAD')

    for (const dirtyPath of [
      'src/app.ts',
      'config/runtime-pages.json',
      'scripts/verify-free-event-runtime.mjs',
      'weapp-vite.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'postcss.config.js',
      'project.config.json',
      'tsconfig.json',
    ]) {
      expect(() => resolveFreeEventRuntimeBuildSha(headSha, [dirtyPath]))
        .toThrow(`committed executable inputs: ${dirtyPath}`)
    }
  })

  it('turns identity, agreement, phone, and profile access redirects into external waits', () => {
    expect(runtimeRouteDisposition(
      '/packages/member/mip-access/index?token=redacted',
      'packages/member/mip-events/registration/index',
    )).toBe('external-wait')
    expect(runtimeRouteDisposition(
      '/packages/member/mip-events/registration/index?eventId=redacted',
      'packages/member/mip-events/registration/index',
    )).toBe('matched')
    expect(runtimeRouteDisposition(
      'pages/index/index',
      'packages/member/mip-events/registration/index',
    )).toBe('failed')
  })

  it('reopens the exact route when DevTools reports it before rendered nodes are queryable', async () => {
    const route = 'packages/member/mip-events/mine/index'
    const selector = '#mip-events-mine-page'
    const firstPage = {
      path: `/${route}`,
      waitForRendered: vi.fn().mockRejectedValue(new Error(
        `Timed out waiting page rendered: selector=${selector} dataset={}; reason=condition not met; latest=[]`,
      )),
    }
    const secondPage = {
      path: `/${route}`,
      waitForRendered: vi.fn().mockResolvedValue('{"selector":"#mip-events-mine-page"}'),
    }
    const miniProgram = {
      currentPage: vi.fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
      reLaunch: vi.fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
    }

    await expect(openAuthoritativePage(miniProgram, {
      expectedRoute: route,
      label: 'external-cancel-registration',
      selector,
      url: `/${route}`,
    })).resolves.toBe(secondPage)
    expect(miniProgram.reLaunch).toHaveBeenCalledTimes(2)
    expect(firstPage.waitForRendered).toHaveBeenCalledWith({ selector, timeout: 15_000 })
    expect(secondPage.waitForRendered).toHaveBeenCalledWith({ selector, timeout: 15_000 })
  })

  it('does not retry an authoritative route that redirects somewhere unexpected', async () => {
    const expectedRoute = 'packages/member/mip-events/mine/index'
    const wrongPage = {
      path: '/pages/index/index',
      waitForRendered: vi.fn(),
    }
    const miniProgram = {
      currentPage: vi.fn().mockResolvedValue(wrongPage),
      reLaunch: vi.fn().mockResolvedValue(wrongPage),
    }

    await expect(openAuthoritativePage(miniProgram, {
      expectedRoute,
      label: 'external-cancel-registration',
      selector: '#mip-events-mine-page',
      url: `/${expectedRoute}`,
    })).rejects.toThrow('opened unexpected route pages/index/index')
    expect(miniProgram.reLaunch).toHaveBeenCalledOnce()
    expect(wrongPage.waitForRendered).not.toHaveBeenCalled()
  })

  it('allows a fresh registration after completed cancellation without weakening fixture gates', () => {
    expect(isReusableFreeEventRegistrationStatus(undefined)).toBe(true)
    expect(isReusableFreeEventRegistrationStatus(null)).toBe(true)
    expect(isReusableFreeEventRegistrationStatus('')).toBe(true)
    expect(isReusableFreeEventRegistrationStatus('CANCELLED')).toBe(true)
    for (const status of ['REGISTERED', 'CHECKED_IN', 'CANCELLATION_PENDING', 'PENDING']) {
      expect(isReusableFreeEventRegistrationStatus(status)).toBe(false)
    }

    const source = fs.readFileSync(path.join(root, 'scripts/verify-free-event-runtime.mjs'), 'utf8')
    for (const exactGate of [
      'event.id !== options.eventId',
      'event.accessType !== contract.event.accessType',
      'event.mode !== contract.event.mode',
      'event.status !== contract.event.status',
      'event.registrationPolicy !== contract.event.registrationPolicy',
      'summary.primaryAction !== \'register\'',
      '!event.canRegister',
      '!isReusableFreeEventRegistrationStatus(event.registrationStatus)',
    ]) {
      expect(source).toContain(exactGate)
    }
  })

  it('fills supported registration fields only through bound field handlers', () => {
    expect(planRegistrationFieldActions([
      { type: 'TEXT', maxLength: 4, required: true },
      { type: 'TEXTAREA', required: false },
      { type: 'SELECT', options: ['A'], required: true },
      { type: 'BOOLEAN', required: true },
      { type: 'BOOLEAN', required: false },
      { type: 'SELECT', options: [], required: true },
    ], 'runtime-marker')).toEqual({
      actions: [
        { handler: 'onTextInput', index: 0, value: 'runt' },
        { handler: 'onTextInput', index: 1, value: 'runtime-marker' },
        { handler: 'onSelectChange', index: 2, value: '0' },
        { handler: 'onBooleanChange', index: 3, value: true },
        { handler: 'onBooleanChange', index: 4, value: false },
      ],
      unavailable: [{ index: 5, reason: 'required SELECT field has no options' }],
    })
  })

  it('proves the running bundle and deployed dev/test function facts before mutation', () => {
    expect(validateRuntimeAttestation({
      account: { miniProgram: { appId, envVersion: 'develop' } },
      app: {
        buildSha: 'runtime-build-1',
        catalogStage: 'TEST',
        cloudbaseEnvId: envId,
        cloudbaseMode: 'direct',
        paymentMode: 'disabled',
      },
      health: { ok: true, data: { persistence: 'cloudbase-mysql', service: 'mip-events-api' } },
    }, {
      appId,
      buildSha: 'runtime-build-1',
      envId,
      paymentMode: 'disabled',
    })).toMatchObject({
      appIdMatched: true,
      buildShaMatched: true,
      cloudbaseEnvMatched: true,
      envVersion: 'develop',
      eventsHealth: 'cloudbase-mysql',
    })
    expect(() => validateRuntimeAttestation({
      account: { miniProgram: { appId: 'wxabcdef0123456789', envVersion: 'develop' } },
      app: {},
      health: {},
    }, { appId, buildSha: 'runtime-build-1', envId, paymentMode: 'disabled' }))
      .toThrow('opened DevTools AppID')

    const details = Object.fromEntries(['events', 'community', 'admin'].map(role => [role, {
      availableStatus: 'Available',
      status: 'Active',
      variables: {
        MIP_ALLOWED_APP_IDS: appId,
        MIP_CATALOG_STAGE: role === 'events' ? undefined : 'TEST',
        MIP_DEPLOYMENT_STAGE: 'test',
        MIP_PAYMENT_MODE: role === 'events' ? 'disabled' : undefined,
      },
    }]))
    expect(validateDeploymentAttestation(details, {
      appId,
      paymentMode: 'disabled',
      stage: 'test',
    })).toEqual({
      allowedAppIdMatched: true,
      catalogStage: 'TEST',
      deploymentStage: 'test',
      paymentMode: 'disabled',
      rolesVerified: ['events', 'community', 'admin'],
    })
    expect(() => validateDeploymentAttestation({
      ...details,
      admin: {
        ...details.admin,
        variables: { ...details.admin.variables, MIP_DEPLOYMENT_STAGE: 'production' },
      },
    }, { appId, paymentMode: 'disabled', stage: 'test' })).toThrow('deployment stage')
  })
})

describe('free event runtime evidence summaries', () => {
  it('waits for the operator only when Automator compile is exactly unimplemented', () => {
    expect(runtimeCompileDisposition(new Error('unimplemented'))).toBe('operator-wait')
    expect(runtimeCompileDisposition({ message: 'unimplemented' })).toBe('operator-wait')
    expect(runtimeCompileDisposition('unimplemented')).toBe('operator-wait')
    expect(runtimeCompileDisposition(new Error('compile failed'))).toBe('failed')
    expect(runtimeCompileDisposition({ message: 'unimplemented: unsupported option' })).toBe('failed')

    const source = fs.readFileSync(path.join(root, 'scripts/verify-free-event-runtime.mjs'), 'utf8')
    expect(source).toContain('report.build.compileMode = \'operator-required\'')
    expect(source).toContain('waitForOperatorBuild(miniProgram, buildSha, options.externalWaitTimeoutMs)')
    expect(source).toContain('new RuntimeStateError(`The opened DevTools compile failed:')
    expect(source).not.toContain('openWechatIdeProjectByHttp')
  })

  it('uses an isolated storage handshake for the exact loaded mutation build', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')
    const runnerSource = fs.readFileSync(path.join(root, 'scripts/verify-free-event-runtime.mjs'), 'utf8')
    const acceptanceValueSource = appSource.slice(
      appSource.indexOf('const runtimeAcceptance'),
      appSource.indexOf('App({'),
    )
    const appStorageKey = appSource.match(/const freeEventRuntimeAcceptanceStorageKey = '([^']+)'/)?.[1]
    const runnerStorageKey = runnerSource.match(/const runtimeAcceptanceStorageKey = '([^']+)'/)?.[1]

    expect(appSource).toContain('const runtimeAcceptance = Object.freeze({')
    expect([...acceptanceValueSource.matchAll(/^\s{2}(\w+):/gm)].map(match => match[1])).toEqual([
      'buildSha',
      'catalogStage',
      'cloudbaseEnvId',
      'cloudbaseMode',
      'paymentMode',
    ])
    expect(appSource).toContain('buildSha: __BUILD_SHA__')
    expect(appSource).toContain('runtimeAcceptance: { ...runtimeAcceptance }')
    expect(appSource).toContain('__BUILD_SHA__.startsWith(\'free-event-runtime-\')')
    expect(appSource).toContain('runtimeConfig.buildSha === __BUILD_SHA__')
    expect(appSource).toContain('wx.setStorageSync(freeEventRuntimeAcceptanceStorageKey, { ...runtimeAcceptance })')
    expect(appSource).not.toContain('removeStorageSync')
    expect(appStorageKey).toBe('mip:internal:free-event-runtime-acceptance:v1')
    expect(runnerStorageKey).toBe(appStorageKey)
    expect(runnerSource).toContain('miniProgram.callWxMethod(\'getStorageSync\', runtimeAcceptanceStorageKey)')
    expect(runnerSource).toContain('miniProgram.callWxMethod(\'removeStorageSync\', runtimeAcceptanceStorageKey)')
    expect(runnerSource).toContain('finally {\n    await clearRuntimeAcceptanceStorage(miniProgram)')
    expect(runnerSource.match(/await clearRuntimeAcceptanceStorage\(miniProgram\)/g)).toHaveLength(2)
    expect(appSource).not.toContain('getRuntimeAcceptance')
    expect(runnerSource).not.toContain('getRuntimeAcceptance')
    expect(runnerSource).not.toContain('getApp(')
    expect(runnerSource).not.toContain('globalData')
    expect(runnerSource).not.toContain('require(\'common.js\')')
    expect(runnerSource).not.toContain('__mipRuntimeAcceptance')
    expect(runnerSource).toContain('const buildSha = readStableRuntimeBuildSha()')
    expect(runnerSource).toContain('runGit([\'diff\', \'--name-only\', \'--no-ext-diff\', \'--no-renames\', \'-z\', \'HEAD\', \'--\'])')
    expect(runnerSource).toContain('runGit([\'ls-files\', \'--others\', \'--exclude-standard\', \'-z\', \'--\'])')
    expect(runnerSource).toContain('randomUUID().slice(0, 8)')
    expect(runnerSource).not.toMatch(/free-event-runtime-\$\{randomUUID\(\)\}/)
    expect(runnerSource).not.toContain('report.buildSha')
  })

  it('records exact authoritative facts without profile, phone, body, or participant refs', () => {
    const sensitiveValues = ['测试昵称', '18819253403', 'profile-secret', 'participant-secret', 'marker-body']
    const summaries = [
      summarizeEventDetail({
        state: 'ready',
        primaryAction: 'register',
        event: {
          id: eventId,
          title: 'secret title',
          accessType: 'FREE',
          mode: 'OFFLINE',
          status: 'PUBLISHED',
          registrationPolicy: 'AUTO',
          canRegister: true,
        },
      }),
      summarizeRegistrationFact({
        state: 'ready',
        activeCategory: 'UPCOMING',
        registrations: [{
          registrationId: 'registration-1',
          status: 'REGISTERED',
          version: 1,
          canCancel: true,
          nickname: sensitiveValues[0],
          event: { id: eventId },
        }],
      }, eventId),
      summarizeRoster({
        state: 'ready',
        canCheckIn: true,
        canUndoCheckIn: false,
        items: [{
          id: 'registration-1',
          nickname: sensitiveValues[0],
          phoneNumber: sensitiveValues[1],
          status: 'REGISTERED',
          version: 1,
        }],
      }, 'registration-1'),
      summarizeInteraction({
        state: 'ready',
        activeView: 'SENT',
        candidates: [{ participantRef: sensitiveValues[3] }],
        heart: { targetRef: sensitiveValues[3], version: 2 },
        feedback: { id: 'feedback-1', body: sensitiveValues[4], rating: 5, version: 1 },
      }, sensitiveValues[4]),
      summarizeCommentPage({
        state: 'ready',
        commentsEnabled: true,
        moderationMode: 'AUTO',
        comments: [{
          id: 'comment-1',
          body: sensitiveValues[4],
          status: 'PUBLISHED',
          version: 1,
          mine: true,
          canDelete: true,
          author: { profileRef: sensitiveValues[2], nickname: sensitiveValues[0] },
        }],
      }, sensitiveValues[4]),
      summarizeAdminFeedback({
        state: 'ready',
        canRead: true,
        items: [{ id: 'feedback-1', nickname: sensitiveValues[0], body: sensitiveValues[4], rating: 5, version: 1 }],
      }, sensitiveValues[4]),
    ]
    const serialized = JSON.stringify(summaries)
    for (const sensitive of sensitiveValues) {
      expect(serialized).not.toContain(sensitive)
    }
    expect(serialized).toContain('registration-1')
    expect(serialized).toContain('comment-1')
    expect(serialized).toContain('feedback-1')
  })

  it('models confirmation-modal cleanup as ordered external waits', () => {
    const externalSteps = contract.steps.filter((step: { mode: string }) => step.mode === 'external-wait')
    expect(externalSteps.map((step: { id: string }) => step.id)).toEqual([
      'external-undo-check-in',
      'external-delete-comment',
      'external-cancel-registration',
    ])
    expect(externalSteps.every((step: { reason: string }) => step.reason.includes('confirmation modal'))).toBe(true)

    const source = fs.readFileSync(path.join(root, 'scripts/verify-free-event-runtime.mjs'), 'utf8')
    expect(source).toContain('isLocalPortListening(port)')
    expect(source).not.toContain('warmWechatDevtoolsProject')
    expect(source).not.toContain('clearStaleAutomatorPortLease')
    expect(source).not.toContain('--skip-build')
    expect(source).not.toContain('executeDelete')
    expect(source).not.toContain('undoCheckIn\', {')
    expect(source).not.toContain('cancelRegistration\', {')
    expect(source).toContain('miniProgram.compile({ force: true })')
    expect(source).toContain('runtimeRouteDisposition(route, expectedRoute)')
    expect(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')).toContain('runtimeAcceptance')
  })

  it('reports operator cleanup separately and never claims full business cleanup', () => {
    const steps = contract.steps.map((step: { id: string, mode: string }) => ({
      ...step,
      status: 'passed',
    }))
    const partial = summarizeMutationCleanup(steps, [
      { action: 'member-feedback-save', status: 'confirmed' },
      { action: 'operator-undo-check-in', status: 'confirmed' },
      { action: 'operator-soft-delete-comment', status: 'confirmed' },
      { action: 'operator-cancel-registration', status: 'confirmed' },
    ])
    expect(partial).toMatchObject({
      businessStateMayRemain: true,
      operatorActions: { status: 'confirmed' },
      status: 'partial',
    })
    expect(partial.operatorActions.actions.every(action => action.status === 'confirmed')).toBe(true)
    expect(JSON.stringify(partial)).not.toContain('operator-confirmed')

    const incompleteSteps = steps.map(step => step.id === 'external-cancel-registration'
      ? { ...step, status: 'external-wait' }
      : step)
    expect(summarizeMutationCleanup(incompleteSteps, [
      { action: 'member-comment-publish', status: 'confirmed' },
    ])).toMatchObject({
      operatorActions: { status: 'incomplete' },
      status: 'incomplete',
    })
  })
})
