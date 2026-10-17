import { describe, expect, it } from 'vitest'
import { adminNavigation, adminSidebarNavigation, navigationByPath } from './navigation'

const sidebarPaths = adminSidebarNavigation.map(item => item.path)
const routerPaths = adminNavigation.map(item => item.path)

describe('admin navigation consolidation (MIW-132)', () => {
  it('groups the sidebar in prototype order', () => {
    expect([...new Set(adminSidebarNavigation.map(item => item.group))]).toEqual([
      '工作台',
      '人才与机会',
      '运营中心',
      '成长体系',
      '系统管理',
    ])
  })

  it('removes cards, knowledge and operations from the sidebar but keeps the routes reachable', () => {
    expect(sidebarPaths).not.toContain('/cards')
    expect(sidebarPaths).not.toContain('/knowledge')
    expect(sidebarPaths).not.toContain('/operations')
    expect(routerPaths).toEqual(expect.arrayContaining(['/cards', '/knowledge', '/operations']))
    expect(navigationByPath.get('/cards')?.label).toBe('名片管理')
    expect(navigationByPath.get('/knowledge')?.label).toBe('知识库')
    expect(navigationByPath.get('/operations')?.label).toBe('运营记录')
  })

  it('adds the NPC task entry to the operations group with the tasks capability', () => {
    const npc = adminSidebarNavigation.find(item => item.path === '/task-approval')
    expect(npc).toMatchObject({ label: 'NPC任务', group: '运营中心', capabilities: ['tasks.manage'] })
    expect(sidebarPaths.indexOf('/task-approval')).toBeGreaterThan(sidebarPaths.indexOf('/events'))
    expect(sidebarPaths.indexOf('/task-approval')).toBeLessThan(sidebarPaths.indexOf('/media'))
  })

  it('renames opportunities and moves task management into the growth group', () => {
    expect(navigationByPath.get('/opportunities')?.label).toBe('机会管理')
    expect(navigationByPath.get('/tasks')?.group).toBe('成长体系')
  })

  it('keeps task-approval out of the router registry to avoid registering it twice', () => {
    expect(routerPaths).not.toContain('/task-approval')
    expect(navigationByPath.get('/task-approval')).toBeDefined()
  })
})
