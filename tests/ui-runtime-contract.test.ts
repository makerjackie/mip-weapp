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
  readyAssertion?: string
  query?: string[]
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
    const rejectedStates = ['loading', 'error', 'forbidden', 'conflict', 'expired', 'disabled']
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

  it('does not render concrete identity, storage, or credential values in WXML', () => {
    for (const route of contract.routes) {
      const wxml = fs.readFileSync(wxmlPathForRoute(route.path), 'utf8')
      for (const item of sensitiveWxmlPatterns) {
        expect(item.pattern.test(wxml), `${route.path} leaked ${item.id}`).toBe(false)
      }
    }
  })

  it('drives runtime verification from the route contract and safe query placeholders', () => {
    expect(verifyRuntime).toContain('config/runtime-pages.json')
    expect(verifyRuntime).toContain('runtimePages.routes')
    expect(verifyRuntime).toContain('runtimePages.routeCount')
    expect(verifyRuntime).toContain('queryForRoute')
    expect(verifyRuntime).toContain('safePlaceholderUuid')
    expect(verifyRuntime).toContain('safe-placeholder-uuid')
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
    expect(verifyRuntime).toContain('visibleAssertion')
  })

  it('keeps real-device capabilities explicit and unresolved by DevTools', () => {
    const capabilityIds = contract.deviceRequiredCapabilities.map(item => item.id).sort()
    expect(capabilityIds).toEqual([
      'ai-voice',
      'calendar-location',
      'customer-service',
      'event-album-photo',
      'phone-auth',
      'photo-save',
      'qr-checkin',
      'share',
      'subscription-message',
      'wechat-pay',
    ])
    const routeSet = new Set(contractRoutes)
    for (const capability of contract.deviceRequiredCapabilities) {
      expect(capability.reason).toBeTruthy()
      for (const route of capability.routes) {
        expect(routeSet.has(route), `${capability.id} references inactive route ${route}`).toBe(true)
      }
    }
    expect(verifyRuntime).toContain('DEVICE_REQUIRED_NOT_VERIFIED')
    expect(verifyRuntime).toMatch(/buildDeviceRequiredReport\(runtimePages\)/)
    expect(verifyRuntime).toContain(`const sessionId = 'mip-weapp-runtime'`)
  })

  it('maps current activity device capabilities to MIP pages', () => {
    const byId = new Map(contract.deviceRequiredCapabilities.map(item => [item.id, item]))
    expect(byId.get('calendar-location')?.routes).toEqual(['packages/member/mip-events/detail/index'])
    expect(byId.get('event-album-photo')?.routes).toEqual(['packages/member/event-album/index'])
    expect(byId.get('photo-save')?.routes).toEqual(['packages/admin/event-console/index'])
    expect(byId.get('qr-checkin')?.routes).toEqual(expect.arrayContaining([
      'packages/member/mip-events/check-in/index',
      'packages/admin/event-registrations/index',
    ]))
    expect(byId.get('subscription-message')?.routes).toEqual(['packages/member/mip-notifications/index'])
    expect(byId.get('ai-voice')?.routes).toEqual(['packages/member/mip-ai/index'])
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
    expect(serviceSource).toContain('checkInCredentialQuery(parsedToken, { lock: true })')
    expect(serviceSource).toContain(`parsed.kind === 'SHORT' ? 'scan_key' : 'id'`)
    expect(serviceSource).toContain('sha256(parsed.secret)')
    expect(serviceSource).toContain('assertCheckInAllowed')
    expect(serviceSource).toContain(`SET status = 'ATTENDED', version = version + 1`)
  })
})
