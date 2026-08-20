import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
  routes: RuntimeRoute[]
}

interface AppJson {
  pages: string[]
  subPackages: Array<{ root: string, pages: string[] }>
}

interface ExampleConfig {
  routes: Array<{ name: string, pathName: string }>
}

function appJsonRoutes(appJson: AppJson): string[] {
  const main = appJson.pages || []
  const sub = (appJson.subPackages || []).flatMap(pkg =>
    (pkg.pages || []).map(page => `${pkg.root.replace(/\/$/, '')}/${page}`),
  )
  return [...main, ...sub]
}

function selectorToId(selector: string): string {
  expect(selector.startsWith('#')).toBe(true)
  return selector.slice(1)
}

function wxmlPathForRoute(routePath: string): string {
  return path.join(root, 'src', `${routePath}.wxml`)
}

/** User-facing WXML must not display raw identity/storage secrets. */
const sensitiveWxmlPatterns: Array<{ id: string, pattern: RegExp }> = [
  { id: 'openid', pattern: /\bopenid\b/i },
  { id: 'open_id', pattern: /\bopen_id\b/i },
  { id: 'from_openid', pattern: /\bfrom_openid\b/i },
  { id: 'cloud://', pattern: /cloud:\/\//i },
  { id: 'mysql://', pattern: /mysql:\/\//i },
  { id: 'jdbc:', pattern: /jdbc:/i },
  { id: 'fileID', pattern: /\bfileID\b/ },
  { id: 'fileId', pattern: /\bfileId\b/ },
  { id: 'fileid', pattern: /\bfileid\b/ },
  { id: 'ticket_code', pattern: /\bticket_code\b/i },
  { id: 'secretid', pattern: /\bsecretid\b/i },
  { id: 'secretkey', pattern: /\bsecretkey\b/i },
  { id: 'appsecret', pattern: /\bappsecret\b/i },
  { id: 'phone_number', pattern: /\bphone_number\b/i },
]

describe('mip-weapp UI runtime contract', () => {
  const contract = readJson<RuntimePagesContract>('config/runtime-pages.json')
  const appJson = readJson<AppJson>('src/app.json')
  const exampleConfig = readJson<ExampleConfig>('config/project.json')
  const verifyRuntime = read('scripts/verify-runtime.mjs')
  const appRoutes = appJsonRoutes(appJson)
  const exampleRoutes = (exampleConfig.routes || []).map(route => route.pathName)
  const contractRoutes = contract.routes.map(route => route.path)

  it('runtime-pages.json declares exactly 41 unique routes', () => {
    expect(contract.schemaVersion).toBe(1)
    expect(contract.case).toBe('mip-weapp')
    expect(contract.routeCount).toBe(41)
    expect(contract.routes).toHaveLength(41)

    const paths = contract.routes.map(route => route.path)
    const ids = contract.routes.map(route => route.id)
    expect(new Set(paths).size).toBe(41)
    expect(new Set(ids).size).toBe(41)
    expect(paths).toContain('packages/admin/event-console/index')
    expect(paths).toContain('packages/admin/event-registrations/index')
    expect(paths).toContain('packages/member/notifications/index')
    expect(paths).toContain('packages/member/event-participants/index')
    expect(paths).toContain('packages/admin/exceptions/index')
  })

  it('matches app.json pages + subPackages exactly', () => {
    expect(appRoutes).toHaveLength(41)
    expect([...appRoutes].sort()).toEqual([...contractRoutes].sort())
    expect(new Set(appRoutes).size).toBe(41)
  })

  it('matches config/project.json routes pathName set exactly', () => {
    expect(exampleRoutes).toHaveLength(41)
    expect([...exampleRoutes].sort()).toEqual([...contractRoutes].sort())
    expect(exampleRoutes).toContain('packages/admin/event-registrations/index')
  })

  it('each contracted route WXML exposes the declared root selector id', () => {
    for (const route of contract.routes) {
      const wxmlFile = wxmlPathForRoute(route.path)
      expect(fs.existsSync(wxmlFile), `missing WXML for ${route.path}`).toBe(true)
      const wxml = fs.readFileSync(wxmlFile, 'utf8')
      const id = selectorToId(route.selector)
      expect(wxml).toContain(`id="${id}"`)
    }
  })

  it('data pages declare loading/error states; payment-result declares result states', () => {
    for (const route of contract.routes) {
      if (route.kind === 'result') {
        expect(route.path).toBe('packages/member/payment-result/index')
        expect(route.states).toEqual(expect.arrayContaining(['checking', 'success', 'pending', 'failed']))
        expect(route.states).not.toContain('error')
        continue
      }
      if (route.kind === 'data' || route.kind === 'static-data') {
        expect(route.states, `${route.path} missing error recovery state`).toContain('error')
        if (route.kind === 'data') {
          expect(route.states, `${route.path} missing loading state`).toContain('loading')
        }
        expect(route.states).toContain('ready')
        expect(route.readyAssertion).toContain('ready')
      }
    }
  })

  it('admin pages declare forbidden handling in the route contract', () => {
    const adminRoutes = contract.routes.filter(route => route.group === 'admin')
    expect(adminRoutes.length).toBeGreaterThanOrEqual(6)
    for (const route of adminRoutes) {
      expect(route.states, `${route.path} must declare forbidden`).toContain('forbidden')
    }

    const shared = read('src/packages/admin/shared/page-state.ts')
    expect(shared).toContain('adminLoadFailure')
    expect(shared).toContain('FORBIDDEN')
    expect(shared).toContain('\'forbidden\'')

    const dashboard = read('src/packages/admin/dashboard/index.ts')
    expect(dashboard).toMatch(/adminLoadFailure|forbidden|FORBIDDEN/)
  })

  it('user-facing page WXML has no sensitive identity/storage literals', () => {
    for (const route of contract.routes) {
      const wxml = fs.readFileSync(wxmlPathForRoute(route.path), 'utf8')
      for (const item of sensitiveWxmlPatterns) {
        expect(item.pattern.test(wxml), `${route.path} leaked ${item.id}`).toBe(false)
      }
    }
  })

  it('verify-runtime.mjs loads runtime-pages.json and covers event-registrations', () => {
    expect(verifyRuntime).toContain('config/runtime-pages.json')
    expect(verifyRuntime).toContain('runtime-pages.json')
    expect(verifyRuntime).toContain('packages/admin/event-registrations/index')
    expect(verifyRuntime).toContain('assertNoSensitivePageData')
    expect(verifyRuntime).toContain('sensitivePatterns')
    expect(verifyRuntime).toMatch(/state === 'ready'/)
    expect(verifyRuntime).toContain('routeCount === 41')
    expect(verifyRuntime).toContain('packages/member/event-participants/index')
    expect(contract.routes.find(route => route.path === 'packages/admin/event-registrations/index')?.selector)
      .toBe('#admin-event-registrations-page')
  })

  it('lists DEVICE_REQUIRED capabilities and marks them not_verified in the verifier', () => {
    expect(contract.deviceRequiredCapabilities.length).toBeGreaterThanOrEqual(3)
    const ids = contract.deviceRequiredCapabilities.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining([
      'phone-auth',
      'wechat-pay',
      'customer-service',
      'share',
      'photo-upload',
      'qr-checkin',
      'two-account-follow',
      'subscription-message',
    ]))

    for (const capability of contract.deviceRequiredCapabilities) {
      expect(capability.id).toBeTruthy()
      expect(capability.reason).toBeTruthy()
      expect(Array.isArray(capability.routes)).toBe(true)
    }

    expect(verifyRuntime).toContain('deviceRequiredCapabilities')
    expect(verifyRuntime).toContain('DEVICE_REQUIRED_NOT_VERIFIED')
    expect(verifyRuntime).toContain('buildDeviceRequiredReport')
    expect(verifyRuntime).toMatch(/report\.deviceRequired\s*=\s*buildDeviceRequiredReport\(\)/)
  })

  it('declares the activity capabilities that still require real-device proof', () => {
    const byId = new Map(contract.deviceRequiredCapabilities.map(item => [item.id, item]))
    expect(byId.get('photo-upload')?.routes).toEqual(expect.arrayContaining([
      'packages/member/event-album/index',
      'packages/admin/event-album/index',
    ]))
    expect(byId.get('qr-checkin')?.routes).toEqual(expect.arrayContaining([
      'packages/member/ticket/index',
      'packages/admin/event-registrations/index',
    ]))
    expect(byId.get('two-account-follow')?.routes).toEqual(expect.arrayContaining([
      'packages/member/member-detail/index',
      'packages/member/connections/index',
    ]))
  })

  it('error is never a contracted success assertion for data routes', () => {
    for (const route of contract.routes) {
      if (route.kind === 'data' || route.kind === 'static-data') {
        expect(route.readyAssertion).not.toMatch(/error/)
        expect(route.readyAssertion).toMatch(/ready/)
        expect(route.acceptStates ?? ['ready']).not.toEqual(
          expect.arrayContaining(['loading', 'error', 'forbidden']),
        )
      }
      if (route.kind === 'result') {
        expect(route.readyAssertion).toMatch(/checking|success|pending|failed/)
        expect(route.readyAssertion).not.toMatch(/\berror\b/)
      }
    }
    expect(verifyRuntime).toContain('cannot count as runtime success')
    expect(verifyRuntime).toContain('error/forbidden/loading are not runtime success states')
  })

  it('event-registrations requires eventId query like event-detail', () => {
    const roster = contract.routes.find(route => route.path === 'packages/admin/event-registrations/index')
    const detail = contract.routes.find(route => route.path === 'packages/member/event-detail/index')
    expect(roster?.query).toEqual(['eventId'])
    expect(detail?.query).toEqual(['eventId'])
    expect(roster?.selector).toBe('#admin-event-registrations-page')
    expect(verifyRuntime).toMatch(
      /packages\/admin\/event-registrations\/index[\s\S]*?eventId=\$\{encodeURIComponent\(context\.eventId/,
    )
  })

  it('uses a single activity-management entry before task-specific pages', () => {
    const dashboard = read('src/packages/admin/dashboard/index.ts')
    const managedEvents = read('src/packages/admin/managed-events/index.ts')
    const managedEventsView = read('src/packages/admin/managed-events/index.wxml')
    const eventConsole = read('src/packages/admin/event-console/index.ts')
    const eventEditor = read('src/packages/admin/events/index.wxml')

    expect(dashboard).toContain('/packages/admin/managed-events/index')
    expect(managedEvents).toContain('/packages/admin/event-console/index?eventId=')
    expect(managedEventsView).toContain('进入管理')
    expect(managedEventsView).not.toContain('编辑活动</t-button>')
    expect(managedEventsView).not.toContain('管理团队</t-button>')
    expect(managedEventsView).not.toContain('相册审核</t-button>')

    expect(eventConsole).toContain('/packages/admin/events/index?eventId=')
    expect(eventConsole).toContain('/packages/admin/event-registrations/index?eventId=')
    expect(eventConsole).toContain('/packages/admin/event-managers/index?eventId=')
    expect(eventConsole).toContain('/packages/admin/event-album/index?eventId=')
    expect(eventEditor).toContain('更多活动操作')
    expect(eventEditor).toContain('取消活动')
  })

  it('renders the dynamic check-in credential with a native Canvas 2D matrix', () => {
    const ticketTs = read('src/packages/member/ticket/index.ts')
    const ticketWxml = read('src/packages/member/ticket/index.wxml')
    const ticketJson = read('src/packages/member/ticket/index.json')
    const qrMatrix = read('src/utils/qr-matrix.ts')
    expect(ticketWxml).toContain('id="checkin-qrcode-canvas"')
    expect(ticketWxml).toContain('type="2d"')
    expect(ticketWxml).toContain('h-[180px] w-[180px]')
    expect(ticketWxml).toContain('src="{{passImagePath}}"')
    expect(ticketJson).not.toContain('tdesign-miniprogram/qrcode/qrcode')
    expect(qrMatrix).toContain('QrCode.encodeSegments')
    expect(qrMatrix).toContain('Ecc.MEDIUM')
    expect(ticketTs).toContain('wx.nextTick')
    expect(ticketTs).toContain('select(\'#checkin-qrcode-canvas\')')
    expect(ticketTs).toContain('createQrMatrix')
    expect(ticketTs).toContain('wx.canvasToTempFilePath')
    expect(ticketTs).toContain('passImagePath')
    expect(ticketTs).toContain('passRendered: true')
  })
})
