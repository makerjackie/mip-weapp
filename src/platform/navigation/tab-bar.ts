interface CustomTabBarHandle {
  setData: (data: { value: string }) => void
}

interface TabPageHandle {
  getTabBar?: () => CustomTabBarHandle | undefined
}

export function syncCustomTabBar(page: TabPageHandle, value: string) {
  page.getTabBar?.()?.setData({ value })
}
