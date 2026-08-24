export const tabBarItems = [
  {
    value: 'pages/index/index',
    label: '发现',
    icon: 'compass',
    iconActive: 'compass-filled',
  },
  {
    value: 'pages/events/index',
    label: '活动',
    icon: 'calendar-event',
    iconActive: 'calendar-event-filled',
  },
  {
    value: 'pages/opportunities/index',
    label: '机会',
    icon: 'work',
    iconActive: 'work-filled',
  },
  {
    value: 'pages/profile/index',
    label: '我的',
    icon: 'user',
    iconActive: 'user-filled',
  },
] as const

export type TabBarItem = (typeof tabBarItems)[number]
