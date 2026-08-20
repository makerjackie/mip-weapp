export const tabBarItems = [
  {
    value: 'pages/index/index',
    label: '首页',
    icon: 'home',
    iconActive: 'home-filled',
  },
  {
    value: 'pages/explore/index',
    label: '认识',
    icon: 'usergroup',
    iconActive: 'usergroup-filled',
  },
  {
    value: 'pages/events/index',
    label: '活动',
    icon: 'calendar-event',
    iconActive: 'calendar-event-filled',
  },
  {
    value: 'pages/profile/index',
    label: '我的',
    icon: 'user',
    iconActive: 'user-filled',
  },
] as const

export type TabBarItem = (typeof tabBarItems)[number]
