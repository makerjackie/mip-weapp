import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseReadyAssertion } from '../scripts/lib/runtime-ready-assertion.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T
}

interface RuntimeRoute {
  id: string
  name: string
  path: string
  selector: string
  group: string
  kind: string
  states: string[]
  acceptStates?: string[]
  pendingStates?: string[]
  externalWaitStates?: string[]
  readyAssertion?: string
  query?: string[]
  queryFixture?: {
    sourceRoute: string
    sourceQuery?: Record<string, string>
    dataPath: string
    where?: Record<string, unknown>
    values: Record<string, string>
  }
  protectedAccessFixture?: {
    kind: string
    sourceRoute: string
    sourceSelector: string
    sourceHandler: string
    confirmationMethod: string
    expectedIntentAction: string
    expectedNextRequirement: string
    restoreSelector: string
    restoreHandler: string
    restoreRoute: string
  }
  deviceRequired?: string[]
  tab?: boolean
}

interface RuntimePagesContract {
  schemaVersion: number
  case: string
  routeCount: number
  deviceRequiredCapabilities: Array<{
    id: string
    label: string
    routes: string[]
    reason: string
  }>
  sensitivePatterns: string[]
  representativeStates: Array<{
    id: string
    route: string
    patch: Record<string, unknown>
    dataAssertions: Array<{ path: string, equals: unknown }>
    visibleAssertion: { selector: string, text?: string }
  }>
  interactionJourneys: Array<{
    id: string
    route: string
    nonMutating: boolean
    scrollTop?: number
    requireVisibleTarget?: boolean
    requireRenderedAction?: boolean
    requireScreenshotDiff?: boolean
    steps: Array<{
      id: string
      type: 'input' | 'tap'
      selector: string
      handler: string
      handlerDataset?: Record<string, string>
      value?: string
      scrollTop?: number
      scrollIntoView?: boolean
      requireVisibleTarget?: boolean
      requireRenderedAction?: boolean
      requireScreenshotDiff?: boolean
      dataAssertions: Array<{ path: string, equals: unknown }>
      visibleAssertion?: { selector?: string, text?: string }
    }>
  }>
  routes: RuntimeRoute[]
}

interface AppJson {
  pages: string[]
  subPackages: Array<{ root: string, pages: string[] }>
}

interface ProjectConfig {
  routes: Array<{ name: string, pathName: string }>
}

function appJsonRoutes(appJson: AppJson): string[] {
  return [
    ...(appJson.pages || []),
    ...(appJson.subPackages || []).flatMap(pkg =>
      (pkg.pages || []).map(page => `${pkg.root.replace(/\/$/, '')}/${page}`),
    ),
  ]
}

function wxmlPathForRoute(routePath: string): string {
  return path.join(root, 'src', `${routePath}.wxml`)
}

// Explanatory privacy copy may name OpenID; only bindings and concrete secret values are leaks.
const sensitiveWxmlPatterns: Array<{ id: string, pattern: RegExp }> = [
  { id: 'appid-value', pattern: /\bwx[0-9a-f]{16}\b/i },
  { id: 'openid-value', pattern: /\bo[\w-]{27}\b/i },
  { id: 'sensitive-binding', pattern: /\{\{[^}]*(?:openid|open_id|from_openid|fileid|file_id|ticket_code|secretid|secretkey|appsecret)[^}]*\}\}/i },
  { id: 'cloud-file-id', pattern: /cloud:\/\//i },
  { id: 'mysql-uri', pattern: /mysql:\/\//i },
  { id: 'jdbc-uri', pattern: /jdbc:/i },
]

function sensitiveWxmlSource(wxml: string, patternId: string) {
  if (patternId !== 'openid-value') {
    return wxml
  }
  // WXML structural identifiers can share OpenID's length and character set.
  return wxml.replace(
    /\s(?:id|class|style|role|slot|aria-[\w-]+|wx:key)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    '',
  )
}

describe('mip-weapp UI runtime contract', () => {
  const contract = readJson<RuntimePagesContract>('config/runtime-pages.json')
  const appJson = readJson<AppJson>('src/app.json')
  const projectConfig = readJson<ProjectConfig>('config/project.json')
  const verifyRuntime = read('scripts/verify-runtime.mjs')
  const appRoutes = appJsonRoutes(appJson)
  const projectRoutes = (projectConfig.routes || []).map(route => route.pathName)
  const contractRoutes = contract.routes.map(route => route.path)

  it('declares the complete active MIP route inventory without a stale fixed count', () => {
    expect(contract.schemaVersion).toBe(2)
    expect(contract.case).toBe('mip-weapp')
    expect(contract.routeCount).toBe(contract.routes.length)
    expect(contract.routeCount).toBe(appRoutes.length)
    expect(contract.routeCount).toBe(projectRoutes.length)
    expect(contract.routeCount).toBeGreaterThanOrEqual(50)

    const paths = contract.routes.map(route => route.path)
    const ids = contract.routes.map(route => route.id)
    expect(new Set(paths).size).toBe(contract.routeCount)
    expect(new Set(ids).size).toBe(contract.routeCount)
    expect(paths).toEqual(expect.arrayContaining([
      'pages/opportunities/index',
      'packages/admin/event-album/index',
      'packages/admin/event-console/index',
      'packages/admin/event-registrations/index',
      'packages/member/event-album/index',
      'packages/member/mip-events/check-in/index',
      'packages/member/mip-events/participants/index',
      'packages/member/mip-public-profile/index',
      'packages/member/mip-notifications/index',
      'packages/member/mip-received/index',
      'packages/member/mip-ai/index',
    ]))
  })

  it('matches app.json and config/project.json route sets exactly', () => {
    expect([...appRoutes].sort()).toEqual([...contractRoutes].sort())
    expect([...projectRoutes].sort()).toEqual([...contractRoutes].sort())
    expect(new Set(appRoutes).size).toBe(contract.routeCount)
    expect(new Set(projectRoutes).size).toBe(contract.routeCount)
  })

  it('exposes every contracted root selector in source WXML', () => {
    for (const route of contract.routes) {
      expect(route.selector).toMatch(/^#[a-z][\w-]*$/i)
      const wxmlFile = wxmlPathForRoute(route.path)
      expect(fs.existsSync(wxmlFile), `missing WXML for ${route.path}`).toBe(true)
      expect(fs.readFileSync(wxmlFile, 'utf8')).toContain(`id="${route.selector.slice(1)}"`)
    }
    expect(contract.routes.find(route => route.path === 'pages/index/index')?.selector).toBe('#mip-home-page')
    expect(contract.routes.find(route => route.path === 'pages/membership/index')?.selector).toBe('#mip-membership-page')
    expect(contract.routes.find(route => route.path === 'pages/profile/index')?.selector).toBe('#mip-account-page')
  })

  it('declares settled states without accepting failures as success', () => {
    const rejectedStates = ['loading', 'error', 'forbidden', 'conflict', 'expired', 'disabled', 'failed']
    for (const route of contract.routes) {
      expect(() => parseReadyAssertion(route.readyAssertion, route.path)).not.toThrow()
      if (route.kind === 'result') {
        const accepted = route.acceptStates ?? route.states.filter(state => !rejectedStates.includes(state))
        expect(accepted.length, `${route.path} has no result state`).toBeGreaterThan(0)
        expect(accepted).not.toEqual(expect.arrayContaining(rejectedStates))
        expect(route.readyAssertion).toMatch(/idle|checking|success|pending|failed/)
        continue
      }
      if (route.kind === 'data' || route.kind === 'static-data') {
        expect(route.states, `${route.path} missing error recovery state`).toContain('error')
        if (route.kind === 'data') {
          expect(route.states, `${route.path} missing loading state`).toContain('loading')
        }
        expect(route.states).toContain('ready')
        expect(route.readyAssertion).toContain('ready')
        expect(route.acceptStates ?? ['ready']).not.toEqual(expect.arrayContaining(rejectedStates))
        expect(route.externalWaitStates ?? []).not.toEqual(expect.arrayContaining(route.acceptStates ?? ['ready']))
      }
    }
  })

  it('declares forbidden handling for every admin page', () => {
    const adminRoutes = contract.routes.filter(route => route.group === 'admin')
    expect(adminRoutes.length).toBeGreaterThanOrEqual(10)
    for (const route of adminRoutes) {
      expect(route.states, `${route.path} must declare forbidden`).toContain('forbidden')
    }

    const shared = read('src/packages/admin/shared/page-state.ts')
    expect(shared).toContain('adminLoadFailure')
    expect(shared).toContain('FORBIDDEN')
    expect(shared).toContain('\'forbidden\'')
  })

  it('requires an enabled activity comment fixture for runtime success', () => {
    const comments = contract.routes.find(route => route.path === 'packages/member/mip-events/comments/index')
    expect(comments?.states).toEqual(expect.arrayContaining(['ready', 'empty', 'disabled']))
    expect(comments?.acceptStates).toEqual(['ready', 'empty'])
    expect(comments?.readyAssertion).toBe('state === \'ready\' || state === \'empty\'')
  })

  it('does not render concrete identity, storage, or credential values in WXML', () => {
    for (const route of contract.routes) {
      const wxml = fs.readFileSync(wxmlPathForRoute(route.path), 'utf8')
      for (const item of sensitiveWxmlPatterns) {
        expect(
          item.pattern.test(sensitiveWxmlSource(wxml, item.id)),
          `${route.path} leaked ${item.id}`,
        ).toBe(false)
      }
    }
  })

  it('distinguishes WXML structural identifiers from hard-coded OpenID values', () => {
    const openIdPattern = sensitiveWxmlPatterns.find(item => item.id === 'openid-value')?.pattern
    expect(openIdPattern).toBeDefined()
    expect(openIdPattern?.test(sensitiveWxmlSource(
      '<view id="opportunities-filter-actions" class="opportunities-filter-actions" />',
      'openid-value',
    ))).toBe(false)
    expect(openIdPattern?.test(sensitiveWxmlSource(
      '<view data-openid="o123456789012345678901234567" />',
      'openid-value',
    ))).toBe(true)
  })

  it('drives runtime verification from route-specific real-data query fixtures', () => {
    expect(verifyRuntime).toContain('config/runtime-pages.json')
    expect(verifyRuntime).toContain('runtimePages.routes')
    expect(verifyRuntime).toContain('runtimePages.routeCount')
    expect(verifyRuntime).toContain('queryForRoute')
    expect(verifyRuntime).toContain('resolveRouteQuery')
    expect(verifyRuntime).toContain('resolveQueryFixtureValues')
    expect(verifyRuntime).toContain('status: \'external-wait\'')
    expect(verifyRuntime).not.toContain('safePlaceholderUuid')
    expect(verifyRuntime).not.toContain('safe-placeholder-uuid')
    expect(verifyRuntime).toContain('assertNoSensitivePageData')
    expect(verifyRuntime).toContain('evaluateRouteState')
    expect(verifyRuntime).toContain('assertReadyAssertion')
    expect(verifyRuntime).not.toContain('pageCaseDetails')
    expect(verifyRuntime).not.toMatch(/routeCount\s*===\s*\d+/)
  })

  it('covers four tabs, secondary return, deep links, and representative states', () => {
    const tabs = contract.routes.filter(route => route.tab).map(route => route.path).sort()
    expect(tabs).toEqual([
      'pages/events/index',
      'pages/index/index',
      'pages/opportunities/index',
      'pages/profile/index',
    ].sort())
    expect(verifyRuntime).toContain('verifyNavigation')
    expect(verifyRuntime).toContain('navigateBack')
    expect(verifyRuntime).toContain('deepLink')
    expect(verifyRuntime).toContain('verifyRepresentativeStates')
    expect(contract.representativeStates.map(state => state.id).sort()).toEqual([
      'conflict',
      'disabled',
      'empty',
      'error',
      'forbidden',
      'loading',
    ])
    const routeByPath = new Map(contract.routes.map(route => [route.path, route]))
    for (const state of contract.representativeStates) {
      const route = routeByPath.get(state.route)
      expect(route, `${state.id} references an inactive route`).toBeTruthy()
      expect(state.dataAssertions.length).toBeGreaterThan(0)
      expect(state.visibleAssertion.selector.startsWith(route!.selector)).toBe(true)
      if (state.visibleAssertion.text) {
        expect(read(`src/${state.route}.wxml`)).toContain(state.visibleAssertion.text)
      }
    }
    expect(verifyRuntime).toContain('assertRepresentativeVisible')
    expect(verifyRuntime).toContain('observeRepresentativeState')
    expect(verifyRuntime).toContain('page.setData(scenario.patch)')
    expect(verifyRuntime).not.toContain('callMethodWithOptions(\'setData\'')
    expect(verifyRuntime).toContain('visibleAssertion')
    expect(verifyRuntime).toContain('waitForRepresentativeLifecycle(page)')
    expect(verifyRuntime).toContain('\'natural-route-data-render-query\'')
    expect(verifyRuntime).toContain('\'route-data-render-query\'')
    expect(verifyRuntime).toContain('injectedDiffRatio >= 0.001')
  })

  it('keeps the city-led main tabs below one real status-bar inset', () => {
    for (const route of ['events', 'opportunities']) {
      const pageConfig = readJson<{ navigationStyle?: string }>(`src/pages/${route}/index.json`)
      const pageScript = read(`src/pages/${route}/index.ts`)
      const pageSource = read(`src/pages/${route}/index.wxml`)

      expect(pageConfig.navigationStyle).toBe('custom')
      expect(pageScript).toContain('platform/navigation/status-bar')
      expect(pageScript).toContain('statusBarHeight: getCustomNavigationStatusBarHeight()')
      expect(pageScript).not.toContain('wx.getWindowInfo')
      expect(pageSource.match(/\{\{statusBarHeight\}\}/g)).toHaveLength(1)
      expect(pageSource).not.toContain('safe-area-inset-top')
    }
  })

  it('executes non-mutating UI interactions through rendered controls', () => {
    expect(contract.interactionJourneys.length).toBeGreaterThanOrEqual(3)
    expect(verifyRuntime).toContain('verifyInteractionJourneys')
    expect(verifyRuntime).toContain('element.input(step.value)')
    expect(verifyRuntime).toContain('element.tap()')
    expect(verifyRuntime).toContain('interactionDataMatches(data, step)')
    expect(verifyRuntime).toContain('waitForInteractionData(page, step)')
    expect(verifyRuntime).toContain('invokeInteractionHandler(page, step)')
    expect(verifyRuntime).toContain('assertInteractionVisible(page, step)')
    expect(verifyRuntime).toContain('visibleDiffRatio >= 0.001')
    expect(verifyRuntime).toMatch(/const element = await page\.\$\(step\.selector\)/)
    expect(verifyRuntime).toMatch(/interaction-\$\{outputName\(journey\.id\)\}\.png/)
    const routeByPath = new Map(contract.routes.map(route => [route.path, route]))
    for (const journey of contract.interactionJourneys) {
      expect(journey.nonMutating).toBe(true)
      expect(routeByPath.has(journey.route)).toBe(true)
      if (journey.scrollTop !== undefined) {
        expect(journey.scrollTop).toBeGreaterThanOrEqual(0)
        expect(journey.scrollTop).toBeLessThanOrEqual(10_000)
      }
      expect(journey.steps.length).toBeGreaterThan(0)
      for (const step of journey.steps) {
        expect(step.selector).toMatch(/^#\w[\w-]*$/)
        expect(step.handler).toMatch(/^[a-z]\w*$/i)
        expect(step.dataAssertions.length).toBeGreaterThan(0)
        if (step.scrollTop !== undefined) {
          expect(step.scrollTop).toBeGreaterThanOrEqual(0)
          expect(step.scrollTop).toBeLessThanOrEqual(10_000)
        }
        if (step.scrollIntoView !== undefined) {
          expect(typeof step.scrollIntoView).toBe('boolean')
          expect(step.scrollTop).toBeUndefined()
        }
        const effectiveScroll = step.scrollIntoView ? step.selector : step.scrollTop ?? journey.scrollTop
        const effectiveRequireVisibleTarget = step.requireVisibleTarget ?? journey.requireVisibleTarget
        const effectiveRequireScreenshotDiff = step.requireScreenshotDiff ?? journey.requireScreenshotDiff
        if (effectiveRequireVisibleTarget) {
          expect(effectiveScroll).toBeDefined()
        }
        if (effectiveRequireScreenshotDiff) {
          expect(step.visibleAssertion).toBeDefined()
        }
      }
    }
    expect(verifyRuntime).toContain('miniProgram.pageScrollTo(stepScrollTop)')
    expect(verifyRuntime).toContain('miniProgram.callWxMethod(\'pageScrollTo\', { selector: step.selector, duration: 0 })')
    expect(verifyRuntime).toContain('assertInteractionTargetInViewport')
  })

  it('scrolls each profile content tab into view before strict rendered taps', () => {
    const journey = contract.interactionJourneys.find(item => item.id === 'profile-content-tabs')

    expect(journey?.scrollTop).toBeUndefined()
    expect(journey?.steps).toHaveLength(2)
    for (const step of journey?.steps || []) {
      expect(step.scrollIntoView).toBe(true)
      expect(step.scrollTop).toBeUndefined()
      expect(step.selector).toMatch(/^#profile-tab-(cases|opportunities)$/)
    }
  })

  it('proves the task assignment mode through a visible native control', () => {
    const journey = contract.interactionJourneys.find(item => item.id === 'task-assignment-mode')
    const openStep = journey?.steps.find(item => item.id === 'open-task-editor')
    const step = journey?.steps.find(item => item.id === 'select-assignment-mode')
    const tasksMarkup = read('src/packages/admin/tasks/index.wxml')
    const controlStart = tasksMarkup.indexOf('<view id="task-assignment-mode-selected"')
    const controlEnd = tasksMarkup.indexOf('</view>', controlStart)
    const selectedControl = tasksMarkup.slice(controlStart, controlEnd)

    expect(step).toMatchObject({
      scrollIntoView: true,
      requireVisibleTarget: true,
      requireRenderedAction: true,
      requireScreenshotDiff: true,
    })
    expect(openStep?.dataAssertions).toContainEqual({ path: 'eligibleLevelsState', equals: 'ready' })
    expect(controlStart).toBeGreaterThanOrEqual(0)
    expect(selectedControl).toContain('class="flex min-h-[88rpx] items-center"')
    expect(selectedControl).toContain('aria-role="radio"')
    expect(selectedControl).toContain('aria-checked="{{assignmentMode === \'SELECTED\'}}"')
    expect(selectedControl).toContain('data-mode="SELECTED" bind:tap="chooseAssignmentMode"')
    expect(selectedControl).toContain('variant="{{assignmentMode === \'SELECTED\' ? \'light\' : \'outline\'}}"')
    expect(tasksMarkup).not.toContain('<t-tag id="task-assignment-mode-selected"')
  })

  it('proves ranking tab changes through a visible native control', () => {
    const journey = contract.interactionJourneys.find(item => item.id === 'game-ranking-tabs')
    const step = journey?.steps.find(item => item.id === 'show-individual-season-ranking')
    const gameMarkup = read('src/packages/member/mip-game/index.wxml')
    const controlStart = gameMarkup.indexOf('<view wx:for="{{rankingOptions}}"')
    const controlEnd = gameMarkup.indexOf('</view>', controlStart)
    const rankingControl = gameMarkup.slice(controlStart, controlEnd)

    expect(step).toMatchObject({
      scrollIntoView: true,
      requireVisibleTarget: true,
      requireRenderedAction: true,
      requireScreenshotDiff: true,
    })
    expect(controlStart).toBeGreaterThanOrEqual(0)
    expect(rankingControl).toContain('id="game-ranking-{{item.key}}"')
    expect(rankingControl).toContain('class="flex min-h-[88rpx] items-center"')
    expect(rankingControl).toContain('aria-role="radio"')
    expect(rankingControl).toContain('aria-checked="{{rankingType === item.key}}"')
    expect(rankingControl).toContain('data-type="{{item.key}}" bind:tap="changeRanking"')
    expect(rankingControl).toContain('variant="{{rankingType === item.key ? \'light\' : \'outline\'}}"')
    expect(gameMarkup).not.toContain('<t-tag wx:for="{{rankingOptions}}"')
  })

  it('keeps real-device capabilities explicit and unresolved by DevTools', () => {
    const capabilityIds = contract.deviceRequiredCapabilities.map(item => item.id).sort()
    expect(capabilityIds).toEqual([
      'ai-voice',
      'calendar-location',
      'customer-service',
      'event-album-photo',
      'knowledge-webview',
      'online-event-webview',
      'phone-auth',
      'phone-call',
      'photo-save',
      'profile-avatar',
      'qr-checkin',
      'share',
      'subscription-message',
      'task-attachment',
      'task-template',
      'video-channel',
      'wechat-pay',
    ])
    const routeSet = new Set(contractRoutes)
    const routeByPath = new Map(contract.routes.map(route => [route.path, route]))
    for (const capability of contract.deviceRequiredCapabilities) {
      expect(capability.reason).toBeTruthy()
      for (const route of capability.routes) {
        expect(routeSet.has(route), `${capability.id} references inactive route ${route}`).toBe(true)
        expect(routeByPath.get(route)?.deviceRequired, `${route} does not map ${capability.id} back to its route`).toContain(capability.id)
      }
    }
    for (const route of contract.routes) {
      for (const capabilityId of route.deviceRequired ?? []) {
        const capability = contract.deviceRequiredCapabilities.find(item => item.id === capabilityId)
        expect(capability, `${route.path} references unknown capability ${capabilityId}`).toBeTruthy()
        expect(capability!.routes).toContain(route.path)
      }
    }
    expect(verifyRuntime).toContain('DEVICE_REQUIRED_NOT_VERIFIED')
    expect(verifyRuntime).toMatch(/buildDeviceRequiredReport\(runtimePages\)/)
    expect(verifyRuntime).toContain(`const sessionId = 'mip-weapp-runtime'`)
  })

  it('maps current activity device capabilities to MIP pages', () => {
    const byId = new Map(contract.deviceRequiredCapabilities.map(item => [item.id, item]))
    expect(byId.get('calendar-location')?.routes).toEqual(['packages/member/mip-events/detail/index'])
    expect(byId.get('video-channel')?.routes).toContain('packages/member/mip-events/detail/index')
    expect(contract.routes.find(route => route.path === 'packages/member/mip-events/detail/index')?.deviceRequired)
      .toContain('video-channel')
    expect(byId.get('event-album-photo')?.routes).toEqual(['packages/member/event-album/index'])
    expect(byId.get('photo-save')?.routes).toEqual(expect.arrayContaining([
      'pages/membership/index',
      'packages/admin/event-console/index',
      'packages/member/mip-events/detail/index',
    ]))
    expect(byId.get('qr-checkin')?.routes).toEqual(expect.arrayContaining([
      'packages/member/mip-events/check-in/index',
      'packages/admin/event-registrations/index',
    ]))
    expect(byId.get('subscription-message')?.routes).toEqual(['packages/member/mip-notifications/index'])
    expect(byId.get('ai-voice')?.routes).toEqual(['packages/member/mip-ai/index'])
    expect(byId.get('share')?.routes).toContain('packages/member/mip-growth/index')
    expect(contract.routes.find(route => route.path === 'packages/member/mip-growth/index')?.deviceRequired)
      .toContain('share')
    expect(byId.get('task-template')?.routes).toEqual([
      'packages/admin/tasks/index',
      'packages/member/mip-tasks/detail/index',
    ])
  })

  it('uses safe query contracts for event, profile, and order deep links', () => {
    const byPath = new Map(contract.routes.map(route => [route.path, route]))
    expect(byPath.get('packages/admin/event-album/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/admin/event-console/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/admin/event-registrations/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/member/event-album/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/member/mip-events/detail/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/member/mip-events/participants/index')?.query).toEqual(['eventId'])
    expect(byPath.get('packages/member/mip-public-profile/index')?.query).toEqual(['profileRef'])
    expect(byPath.get('packages/member/order-detail/index')?.query).toEqual(['orderId'])
    expect(byPath.get('packages/member/mip-knowledge/detail/index')?.query).toEqual(['contentId'])
    expect(byPath.get('packages/member/mip-knowledge/web/index')?.query).toEqual(['contentId'])
    for (const route of contract.routes.filter(item => item.query?.length)) {
      if (route.protectedAccessFixture) {
        expect(route.path).toBe('packages/member/mip-access/index')
        expect(route.query).toEqual(['token'])
        expect(route.protectedAccessFixture).toMatchObject({
          kind: 'local-sign-out-global-guard',
          sourceRoute: 'packages/member/privacy/index',
          sourceSelector: '#privacy-sign-out',
          expectedIntentAction: 'ENTER_APP',
          restoreSelector: '#mip-access-sign-in',
          restoreRoute: 'pages/index/index',
        })
        expect(route.queryFixture).toBeUndefined()
        continue
      }
      expect(route.queryFixture, `${route.path} needs a real-data fixture`).toBeTruthy()
      expect(Object.keys(route.queryFixture!.values).sort()).toEqual([...route.query!].sort())
      expect(byPath.has(route.queryFixture!.sourceRoute)).toBe(true)
      expect(byPath.get(route.queryFixture!.sourceRoute)?.query ?? []).toEqual([])
    }
  })

  it('maps normal-state fixtures without patching source page data', () => {
    const byId = new Map(contract.routes.map(route => [route.id, route]))
    expect(byId.get('M09')?.queryFixture).toMatchObject({
      sourceRoute: 'packages/member/mip-events/mine/index',
      sourceQuery: { category: 'ATTENDED' },
      dataPath: 'registrations',
      where: { status: 'ATTENDED' },
      values: { eventId: 'event.id' },
    })
    expect(byId.get('M35')?.queryFixture).toMatchObject({
      sourceRoute: 'packages/member/mip-game/index',
      dataPath: 'rankings',
      where: { subjectType: 'TEAM' },
      values: { teamId: 'teamId' },
    })
    expect(byId.get('M14')?.queryFixture).toMatchObject({
      sourceRoute: 'packages/member/mip-cooperation/list/index',
      dataPath: 'talents',
      values: { id: 'cards.0.id' },
    })
    expect(byId.get('M46')).toMatchObject({
      states: ['loading', 'ready', 'empty', 'error'],
      acceptStates: ['ready', 'empty'],
      readyAssertion: 'state === \'ready\' || state === \'empty\'',
      deviceRequired: ['knowledge-webview'],
    })
    expect(byId.get('M26')?.queryFixture).toMatchObject({
      where: { albumEnabled: true },
    })
  })

  it('keeps payment checking pending and accepts only server-settled outcomes', () => {
    const paymentResult = contract.routes.find(route => route.id === 'U14')
    expect(paymentResult?.states).toEqual(expect.arrayContaining(['checking', 'success', 'pending', 'failed', 'refund']))
    expect(paymentResult?.pendingStates).toEqual(['checking'])
    expect(paymentResult?.acceptStates).toEqual(['success', 'pending', 'refund'])
    expect(paymentResult?.readyAssertion).toBe('result in success|pending|refund')
  })

  it('uses one event-management entry and a consistent eventId query', () => {
    const dashboardView = read('src/packages/admin/dashboard/index.wxml')
    const managedEvents = read('src/packages/admin/managed-events/index.ts')
    const eventConsole = read('src/packages/admin/event-console/index.ts')
    const eventConsoleView = read('src/packages/admin/event-console/index.wxml')

    expect(dashboardView).toContain('data-path="/packages/admin/managed-events/index"')
    expect(managedEvents).toContain('/packages/admin/event-console/index?eventId=')
    expect(eventConsole).toContain('query.eventId')
    expect(eventConsole).toContain('event-registrations')
    expect(eventConsole).toContain('event-managers')
    expect(eventConsole).toContain('\'exports\'')
    expect(eventConsole).toContain('\'event-album\'')
    expect(eventConsole).toContain('eventId=')
    expect(eventConsoleView).toContain('活动相册')
    expect(eventConsoleView).toContain('取消活动')
  })

  it('uses domain-specific admin routes without legacy aliases', () => {
    const activeRoutes = new Set(appRoutes)
    const expectedRoutes = [
      'packages/admin/exports/index',
      'packages/admin/opportunities/index',
      'packages/admin/growth-levels/index',
      'packages/admin/growth-rules/index',
      'packages/admin/growth-entries/index',
      'packages/admin/event-album/index',
      'packages/admin/announcements/index',
      'packages/admin/announcement-editor/index',
      'packages/admin/exceptions/index',
    ]
    const legacyRoutes = [
      'packages/admin/reports/index',
    ]
    for (const route of expectedRoutes) {
      expect(activeRoutes.has(route)).toBe(true)
    }
    for (const route of legacyRoutes) {
      expect(activeRoutes.has(route)).toBe(false)
    }

    const dashboardView = read('src/packages/admin/dashboard/index.wxml')
    const growthLevels = read('src/packages/admin/growth-levels/index.ts')
    expect(dashboardView).toContain('/packages/admin/opportunities/index')
    expect(dashboardView).toContain('/packages/admin/growth-levels/index')
    expect(growthLevels).toContain('/packages/admin/growth-rules/index')
    expect(growthLevels).toContain('/packages/admin/growth-entries/index')
  })

  it('routes QR scanning through server-authoritative check-in validation', () => {
    const checkInTs = read('src/packages/member/mip-events/check-in/index.ts')
    const checkInWxml = read('src/packages/member/mip-events/check-in/index.wxml')
    const moduleSource = read('src/modules/mip-events/module.ts')
    const gatewaySource = read('src/modules/mip-events/cloudbase-gateway.ts')
    const functionSource = read('cloudfunctions/mip-events-api/index.js')
    const serviceSource = read('cloudfunctions/mip-events-api/domain/event-service.js')

    expect(checkInWxml).toContain('id="mip-event-check-in-page"')
    expect(checkInWxml).toContain('bind:tap="scanCode"')
    expect(checkInTs).toContain('wx.scanCode')
    expect(checkInTs).toContain('mipEventsModule.checkIn')
    expect(moduleSource).toContain(`requestKey('event-checkin')`)
    expect(gatewaySource).toContain(`'mip.events.checkIn'`)
    expect(functionSource).toContain(`case 'mip.events.checkIn'`)
    expect(serviceSource).toContain('mip_event_checkin_credentials')
    expect(serviceSource).toContain(`presented.kind === 'SCAN'`)
    expect(serviceSource).toContain('checkInCredentialQuery(presented.parsed, { lock: true })')
    expect(serviceSource).toContain('checkInResumeRef(presented.credentialKind, presented.credentialRef, { lock: true })')
    expect(serviceSource).toContain('credential.event_id !== presented.eventId')
    expect(serviceSource).toContain(`parsed.kind === 'SHORT' ? 'scan_key' : 'id'`)
    expect(serviceSource).toContain('sha256(parsed.secret)')
    expect(serviceSource).toContain('assertCheckInAllowed')
    expect(serviceSource).toContain(`SET status = 'ATTENDED', version = version + 1`)
  })
})
