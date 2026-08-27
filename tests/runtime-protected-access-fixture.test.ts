import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  isRecoverableRuntimeRenderError,
  navigateFreshRuntimeRoute,
  navigateFreshRuntimeTab,
  resolveProtectedAccessRuntimeFixture,
} from '../scripts/verify-runtime.mjs'

const root = path.resolve(import.meta.dirname, '..')
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-pages.json'), 'utf8'))
const accessRoute = contract.routes.find((route: { path: string }) => (
  route.path === 'packages/member/mip-access/index'
))
const privacyRoute = contract.routes.find((route: { path: string }) => (
  route.path === 'packages/member/privacy/index'
))
const homeRoute = contract.routes.find((route: { path: string }) => (
  route.path === 'pages/index/index'
))

function createFixtureRuntime(
  token = 'mip-1720000000000-runtime',
  options: { restoreTapError?: Error, signOutTapAttempt?: number } = {},
) {
  let currentPage: Record<string, unknown>
  let signOutTapCount = 0
  const homePage = {
    path: homeRoute.path,
    data: vi.fn(async () => ({ state: 'ready' })),
    renderedNodes: vi.fn(async (selector: string, options: { routeOnly: boolean }) => {
      expect(selector).toBe(homeRoute.selector)
      expect(options).toEqual({ routeOnly: true })
      return [{ top: 0, bottom: 812, left: 0, right: 375, width: 375, height: 812 }]
    }),
    waitForRendered: vi.fn(async () => undefined),
  }
  const actionPage = (
    pagePath: string,
    routeSelector: string,
    selector: string,
    data: () => Record<string, unknown>,
    onTap: () => void,
  ) => {
    const elementMap = { clear: vi.fn() }
    const element = { tap: vi.fn(async () => onTap()) }
    return {
      path: pagePath,
      data: vi.fn(async () => data()),
      waitForRendered: vi.fn(async () => undefined),
      elementMap,
      renderedNodes: vi.fn(async (actualSelector: string, options: { routeOnly: boolean }) => {
        expect([routeSelector, selector]).toContain(actualSelector)
        expect(options).toEqual({ routeOnly: true })
        return [{
          top: 100,
          bottom: 188,
          left: 20,
          right: 320,
          width: 300,
          height: 88,
        }]
      }),
      $: vi.fn(async (actualSelector: string, options: { fallback: boolean }) => {
        expect(actualSelector).toBe(selector)
        expect(options).toEqual({ fallback: false })
        expect(elementMap.clear).toHaveBeenCalled()
        return element
      }),
      element,
    }
  }
  const accessPage = {
    ...actionPage(accessRoute.path, accessRoute.selector, '#mip-access-sign-in', () => ({
      globalGate: true,
      nextRequirement: 'AUTHENTICATED',
      state: 'ready',
      token,
    }), () => {
      currentPage = homePage
      if (options.restoreTapError) {
        throw options.restoreTapError
      }
    }),
  }
  const privacyPage = {
    ...actionPage(privacyRoute.path, privacyRoute.selector, '#privacy-sign-out', () => ({ state: 'ready' }), () => {
      signOutTapCount += 1
      if (signOutTapCount >= (options.signOutTapAttempt || 1)) {
        currentPage = accessPage
      }
    }),
  }
  currentPage = privacyPage
  const miniProgram = {
    reLaunch: vi.fn(async (url: string) => {
      if (url === `/${privacyRoute.path}`) {
        currentPage = privacyPage
        return { path: 'transitioning' }
      }
      expect(url).toBe(`/${homeRoute.path}`)
      currentPage = homePage
      return { path: 'transitioning' }
    }),
    currentPage: vi.fn(async () => currentPage),
    callWxMethod: vi.fn(async (method: string, options: { selector: string, duration: number }) => {
      expect(method).toBe('pageScrollTo')
      expect(options.duration).toBe(0)
      expect(['#privacy-sign-out', '#mip-access-sign-in']).toContain(options.selector)
    }),
    mockWxMethod: vi.fn(async () => undefined),
    restoreWxMethod: vi.fn(async () => undefined),
    systemInfo: vi.fn(async () => ({ windowHeight: 812, windowWidth: 375 })),
  }
  return { accessPage, homePage, miniProgram, privacyPage }
}

describe('runtime protected access fixture', () => {
  it('restarts only when the requested route exists but its rendered root is unavailable', () => {
    expect(isRecoverableRuntimeRenderError(new Error(
      'Runtime navigation representative loading did not render: Runtime fixture expected rendered pages/membership/index:#mip-membership-page, received pages/membership/index',
    ))).toBe(true)
    expect(isRecoverableRuntimeRenderError(new Error(
      'Runtime fixture expected rendered pages/membership/index:#mip-membership-page, received pages/index/index',
    ))).toBe(false)
    expect(isRecoverableRuntimeRenderError(new Error('connection failed'))).toBe(false)
  })

  it('repeats a safe navigation when logic changes route before the rendered tree catches up', async () => {
    let navigationCount = 0
    const transitionPage = {
      path: homeRoute.path,
      renderedNodes: vi.fn(async () => []),
    }
    const renderedPage = {
      path: homeRoute.path,
      renderedNodes: vi.fn(async () => [{ width: 375, height: 812 }]),
    }
    const miniProgram = {
      currentPage: vi.fn(async () => (
        navigationCount < 2 ? transitionPage : renderedPage
      )),
    }
    const navigate = vi.fn(async () => {
      navigationCount += 1
      return transitionPage
    })

    await expect(navigateFreshRuntimeRoute(
      miniProgram,
      homeRoute,
      'home probe',
      navigate,
      50,
    )).resolves.toBe(renderedPage)
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(transitionPage.renderedNodes).toHaveBeenCalled()
    expect(renderedPage.renderedNodes).toHaveBeenCalledWith(
      homeRoute.selector,
      { routeOnly: true },
    )
  })

  it('relaunches a tab route once when its path is ready but its root is not rendered', async () => {
    let recovered = false
    const transitionPage = {
      path: `/${homeRoute.path}`,
      renderedNodes: vi.fn(async () => []),
    }
    const renderedPage = {
      path: `/${homeRoute.path}`,
      renderedNodes: vi.fn(async () => [{ width: 375, height: 812 }]),
    }
    const miniProgram = {
      switchTab: vi.fn(async (url: string) => {
        expect(url).toBe(`/${homeRoute.path}`)
        return transitionPage
      }),
      reLaunch: vi.fn(async (url: string) => {
        expect(url).toBe(`/${homeRoute.path}`)
        recovered = true
        return renderedPage
      }),
      currentPage: vi.fn(async () => (recovered ? renderedPage : transitionPage)),
    }

    await expect(navigateFreshRuntimeTab(
      miniProgram,
      homeRoute,
      'home tab probe',
      1,
    )).resolves.toBe(renderedPage)
    expect(miniProgram.switchTab).toHaveBeenCalledOnce()
    expect(miniProgram.reLaunch).toHaveBeenCalledOnce()
    expect(transitionPage.renderedNodes).toHaveBeenCalledWith(
      homeRoute.selector,
      { routeOnly: true },
    )
    expect(renderedPage.renderedNodes).toHaveBeenCalledWith(
      homeRoute.selector,
      { routeOnly: true },
    )
  })

  it('does not relaunch a tab when navigation reaches a different route', async () => {
    const tabRoute = contract.routes.find((route: { path: string, tab?: boolean }) => (
      route.tab && route.path !== homeRoute.path
    ))
    expect(tabRoute).toBeDefined()
    const wrongPage = {
      path: '/pages/index/index',
      renderedNodes: vi.fn(async () => []),
    }
    const miniProgram = {
      switchTab: vi.fn(async () => wrongPage),
      reLaunch: vi.fn(),
      currentPage: vi.fn(async () => wrongPage),
    }

    await expect(navigateFreshRuntimeTab(
      miniProgram,
      tabRoute,
      'wrong tab probe',
      1,
    )).rejects.toThrow('received pages/index/index')
    expect(miniProgram.reLaunch).not.toHaveBeenCalled()
  })

  it('uses the UI-bound local logout to create a real global-guard intent and restores identity', async () => {
    expect(accessRoute).toMatchObject({
      externalWaitStates: ['expired'],
      query: ['token'],
      protectedAccessFixture: {
        kind: 'local-sign-out-global-guard',
        sourceRoute: privacyRoute.path,
        sourceSelector: '#privacy-sign-out',
        sourceHandler: 'signOutLocally',
        confirmationMethod: 'showModal',
        expectedIntentAction: 'ENTER_APP',
        expectedNextRequirement: 'AUTHENTICATED',
        restoreSelector: '#mip-access-sign-in',
        restoreHandler: 'signIn',
        restoreRoute: homeRoute.path,
      },
    })
    expect(accessRoute.queryFixture).toBeUndefined()

    const runtime = createFixtureRuntime()
    const resolved = await resolveProtectedAccessRuntimeFixture(
      runtime.miniProgram,
      contract,
      accessRoute,
      contract.sensitivePatterns,
    )

    expect(resolved).toMatchObject({
      status: 'resolved',
      query: 'token=mip-1720000000000-runtime',
      queryMode: 'protected-action-intent',
    })
    expect(runtime.miniProgram.mockWxMethod).toHaveBeenCalledWith('showModal', {
      cancel: false,
      confirm: true,
      errMsg: 'showModal:ok',
    })
    expect(runtime.privacyPage.elementMap.clear).toHaveBeenCalledOnce()
    expect(runtime.privacyPage.$).toHaveBeenCalledWith('#privacy-sign-out', { fallback: false })
    expect(runtime.privacyPage.element.tap).toHaveBeenCalledOnce()
    expect(runtime.miniProgram.restoreWxMethod).toHaveBeenCalledWith('showModal')

    await resolved.restore()
    expect(runtime.accessPage.elementMap.clear).toHaveBeenCalledOnce()
    expect(runtime.accessPage.$).toHaveBeenCalledWith('#mip-access-sign-in', { fallback: false })
    expect(runtime.accessPage.element.tap).toHaveBeenCalledOnce()
    expect(runtime.miniProgram.callWxMethod).toHaveBeenNthCalledWith(1, 'pageScrollTo', {
      selector: '#privacy-sign-out',
      duration: 0,
    })
    expect(runtime.miniProgram.callWxMethod).toHaveBeenNthCalledWith(2, 'pageScrollTo', {
      selector: '#mip-access-sign-in',
      duration: 0,
    })
    expect(runtime.miniProgram.reLaunch).toHaveBeenNthCalledWith(2, `/${homeRoute.path}`)
    const restoreTapOrder = runtime.accessPage.element.tap.mock.invocationCallOrder[0]
    const freshReloadOrder = runtime.miniProgram.reLaunch.mock.invocationCallOrder[1]
    expect(runtime.miniProgram.currentPage.mock.invocationCallOrder.some(
      callOrder => callOrder > restoreTapOrder && callOrder < freshReloadOrder,
    )).toBe(true)
    expect(runtime.homePage.data).toHaveBeenCalled()
  })

  it('restores the signed-in server identity when intent validation fails after local logout', async () => {
    const runtime = createFixtureRuntime('contains spaces')

    await expect(resolveProtectedAccessRuntimeFixture(
      runtime.miniProgram,
      contract,
      accessRoute,
      contract.sensitivePatterns,
    )).rejects.toThrow('bounded opaque intent token')

    expect(runtime.privacyPage.element.tap).toHaveBeenCalledOnce()
    expect(runtime.accessPage.element.tap).toHaveBeenCalledOnce()
    expect(runtime.homePage.data).toHaveBeenCalled()
    expect(runtime.miniProgram.restoreWxMethod).toHaveBeenCalledWith('showModal')
  })

  it('retries the visible local sign-out control when its first native tap does not dispatch', async () => {
    const runtime = createFixtureRuntime('mip-1720000000000-retry', { signOutTapAttempt: 2 })

    const resolved = await resolveProtectedAccessRuntimeFixture(
      runtime.miniProgram,
      contract,
      accessRoute,
      contract.sensitivePatterns,
    )

    expect(resolved).toMatchObject({
      status: 'resolved',
      query: 'token=mip-1720000000000-retry',
      queryMode: 'protected-action-intent',
    })
    expect(runtime.privacyPage.element.tap).toHaveBeenCalledTimes(2)
    expect(runtime.miniProgram.restoreWxMethod).toHaveBeenCalledWith('showModal')
    await resolved.restore()
    expect(runtime.homePage.data).toHaveBeenCalled()
  })

  it('accepts element destruction when the rendered sign-in tap already changed route', async () => {
    const runtime = createFixtureRuntime('mip-1720000000000-destroyed', {
      restoreTapError: new Error('element destroyed'),
    })

    const resolved = await resolveProtectedAccessRuntimeFixture(
      runtime.miniProgram,
      contract,
      accessRoute,
      contract.sensitivePatterns,
    )

    await expect(resolved.restore()).resolves.toBeUndefined()
    expect(runtime.accessPage.element.tap).toHaveBeenCalledOnce()
    expect(runtime.homePage.data).toHaveBeenCalled()
  })

  it('locks source and restore actions to visible native wrappers without handler fallback', () => {
    const privacyMarkup = fs.readFileSync(
      path.join(root, 'src/packages/member/privacy/index.wxml'),
      'utf8',
    )
    const accessMarkup = fs.readFileSync(
      path.join(root, 'src/packages/member/mip-access/index.wxml'),
      'utf8',
    )
    const verifier = fs.readFileSync(path.join(root, 'scripts/verify-runtime.mjs'), 'utf8')
    const actionHelper = verifier.slice(
      verifier.indexOf('async function tapVisibleRuntimeFixtureAction'),
      verifier.indexOf('async function restoreProtectedAccessRuntimeFixture'),
    )
    const resolver = verifier.slice(
      verifier.indexOf('export async function resolveProtectedAccessRuntimeFixture'),
      verifier.indexOf('async function resolveRouteQuery'),
    )
    const privacyWrapper = privacyMarkup.match(/<view[^>]*id="privacy-sign-out"[^>]*>[\s\S]*?<\/view>/)?.[0]
    const accessWrapper = accessMarkup.match(/<view[^>]*id="mip-access-sign-in"[^>]*>[\s\S]*?<\/view>/)?.[0]

    expect(privacyWrapper).toContain('class="mt-5 flex min-h-[88rpx] items-center"')
    expect(privacyWrapper).toContain('bind:tap="signOutLocally"')
    expect(privacyWrapper).not.toMatch(/<t-button[^>]*bind:tap=/)
    expect(accessWrapper).toContain('class="mt-7 flex min-h-[88rpx] items-center"')
    expect(accessWrapper).toContain('bind:tap="signIn"')
    expect(accessWrapper).not.toMatch(/<t-button[^>]*bind:tap=/)
    expect(actionHelper).toContain('miniProgram.callWxMethod(\'pageScrollTo\', { selector, duration: 0 })')
    expect(actionHelper).toContain('page.renderedNodes(selector, { routeOnly: true })')
    expect(actionHelper).toContain('queryFreshRenderedActionElement(page, selector)')
    expect(actionHelper).toContain('await element.tap()')
    expect(verifier).toContain('page?.elementMap?.clear?.()')
    expect(verifier).toContain('page.$(selector, { fallback: false })')
    expect(verifier).toContain('(route.query || []).length > 0 && !route.protectedAccessFixture')
    expect(verifier).toContain('export async function navigateFreshRuntimeRoute(')
    expect(verifier).toContain('render recovery')
    expect(verifier).toContain('const returned = await waitForCurrentRuntimeRoute(miniProgram, homeRoute)')
    expect(resolver).not.toContain('.callMethod(')
  })
})
