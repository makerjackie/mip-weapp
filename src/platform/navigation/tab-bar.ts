import { tabBarItems } from '../../config/tabs'

interface CustomTabBarHandle {
  setData: (data: { value: string, selected: number }) => void
}

interface TabPageHandle {
  getTabBar?: () => CustomTabBarHandle | undefined
}

export function syncCustomTabBar(page: TabPageHandle, value: string) {
  const selected = tabBarItems.findIndex(item => item.value === value)
  page.getTabBar?.()?.setData({
    value,
    selected: selected >= 0 ? selected : 0,
  })
}
