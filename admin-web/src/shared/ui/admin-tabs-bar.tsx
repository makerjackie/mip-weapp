import { CloseOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { Button } from 'antd'
import { useState } from 'react'
import { navigationByPath, type AdminNavigationItem, type AdminRoutePath } from '../../app/navigation'

const HOME_PATH: AdminRoutePath = '/overview'

/** 浏览器式多页签：进入菜单追加页签，点击切换，关闭最后一个回到概览。 */
export function AdminTabsBar({ current }: { current: AdminNavigationItem }) {
  const navigate = useNavigate()
  const [tabs, setTabs] = useState<AdminRoutePath[]>([current.path])
  const [trackedPath, setTrackedPath] = useState(current.path)

  // 路由变化时在渲染期同步页签（React 官方的 props 变化调整状态模式）。
  if (trackedPath !== current.path) {
    setTrackedPath(current.path)
    setTabs(tabs => tabs.includes(current.path) ? tabs : [...tabs, current.path])
  }

  const closeTab = (path: AdminRoutePath) => {
    const index = tabs.indexOf(path)
    const next = tabs.filter(item => item !== path)
    if (!next.length) {
      setTabs([HOME_PATH])
      void navigate({ to: HOME_PATH })
      return
    }
    setTabs(next)
    // 关闭当前页签时落到相邻页签；关闭其他页签不改变所在路由。
    if (path === current.path) void navigate({ to: next[Math.min(index, next.length - 1)] })
  }

  return (
    <nav className="admin-tabs" aria-label="已打开页面">
      {tabs.map(path => {
        const item = navigationByPath.get(path)
        if (!item) return null
        const active = path === current.path
        return (
          <div key={path} className={active ? 'admin-tabs__tab is-active' : 'admin-tabs__tab'}>
            <Button
              type="text"
              className="admin-tabs__label"
              title={item.description}
              aria-current={active ? 'page' : undefined}
              onClick={() => void navigate({ to: path })}
            >{item.label}</Button>
            <Button
              type="text"
              className="admin-tabs__close"
              aria-label={`关闭页签：${item.label}`}
              icon={<CloseOutlined />}
              onClick={() => closeTab(path)}
            />
          </div>
        )
      })}
    </nav>
  )
}
