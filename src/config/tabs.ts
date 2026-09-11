export const tabBarItems = [
  {
    value: 'pages/index/index',
    label: '发现',
  },
  {
    value: 'pages/events/index',
    label: '活动',
  },
  {
    value: 'pages/opportunities/index',
    label: '机会',
  },
  {
    value: 'pages/profile/index',
    label: '我的',
  },
] as const

export type TabBarItem = (typeof tabBarItems)[number]
