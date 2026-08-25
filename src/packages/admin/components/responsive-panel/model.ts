export const ADMIN_RESPONSIVE_PANEL_BREAKPOINT = 960

export type AdminResponsivePanelPlacement = 'bottom' | 'right'

interface WindowResizeResult {
  size: {
    windowWidth: number
  }
}

export interface ResponsivePanelWindowApi {
  getWindowInfo: () => { windowWidth: number }
  onWindowResize: (listener: (result: WindowResizeResult) => void) => void
  offWindowResize: (listener: (result: WindowResizeResult) => void) => void
}

export function resolveAdminResponsivePanelPlacement(windowWidth: number): AdminResponsivePanelPlacement {
  return Number.isFinite(windowWidth) && windowWidth >= ADMIN_RESPONSIVE_PANEL_BREAKPOINT
    ? 'right'
    : 'bottom'
}

export function createAdminResponsivePanelController(
  windowApi: ResponsivePanelWindowApi,
  updatePlacement: (placement: AdminResponsivePanelPlacement) => void,
) {
  const handleWindowResize = (result: WindowResizeResult) => {
    updatePlacement(resolveAdminResponsivePanelPlacement(result.size.windowWidth))
  }

  return {
    attach() {
      updatePlacement(resolveAdminResponsivePanelPlacement(windowApi.getWindowInfo().windowWidth))
      windowApi.onWindowResize(handleWindowResize)
    },
    detach() {
      windowApi.offWindowResize(handleWindowResize)
    },
  }
}
