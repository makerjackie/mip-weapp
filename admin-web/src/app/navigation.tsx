import {
  AppstoreOutlined,
  BookOutlined,
  BulbOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  FileSearchOutlined,
  MessageOutlined,
  PictureOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  ShoppingCartOutlined,
  TrophyOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'

export type AdminRoutePath =
  | '/overview'
  | '/users'
  | '/events'
  | '/orders'
  | '/tasks'
  | '/banners'
  | '/media'
  | '/game'
  | '/opportunities'
  | '/growth'
  | '/permissions'
  | '/messages'
  | '/knowledge'
  | '/operations'

export interface AdminNavigationItem {
  path: AdminRoutePath
  label: string
  description: string
  group: '工作台' | '业务管理' | '会员运营' | '平台设置'
  icon: ReactNode
  capabilities: string[]
  requireAny?: boolean
}

export const adminNavigation: AdminNavigationItem[] = [
  { path: '/overview', label: '网站概览', description: '查看会员、活动、订单和运营状态', group: '工作台', icon: <AppstoreOutlined />, capabilities: ['admin.dashboard'] },
  { path: '/users', label: '用户管理', description: '查看用户、会员、服务器和账号状态', group: '业务管理', icon: <UserOutlined />, capabilities: ['users.read'] },
  { path: '/events', label: '活动管理', description: '管理活动、报名、签到和活动内容', group: '业务管理', icon: <CalendarOutlined />, capabilities: ['events.read'] },
  { path: '/orders', label: '订单管理', description: '查看订单、支付和退款事实', group: '业务管理', icon: <ShoppingCartOutlined />, capabilities: ['orders.read'] },
  { path: '/tasks', label: '任务管理', description: '管理任务、成员分配和完成记录', group: '业务管理', icon: <CheckSquareOutlined />, capabilities: ['tasks.manage'] },
  { path: '/banners', label: 'Banner 管理', description: '管理首页 Banner 和跳转目标', group: '业务管理', icon: <PictureOutlined />, capabilities: ['banners.manage'] },
  { path: '/media', label: '素材上传', description: '上传并复用受控运营素材', group: '业务管理', icon: <UploadOutlined />, capabilities: ['banners.manage', 'events.album.manage', 'events.write', 'opportunities.moderate', 'userContent.moderate', 'tasks.manage'], requireAny: true },
  { path: '/game', label: '战队管理', description: '管理赛季、战队、赛况、排行和盲盒', group: '业务管理', icon: <TrophyOutlined />, capabilities: ['game.manage'] },
  { path: '/opportunities', label: '机会与内容', description: '管理机会、合作内容和治理记录', group: '业务管理', icon: <BulbOutlined />, capabilities: ['opportunities.moderate', 'userContent.moderate'], requireAny: true },
  { path: '/growth', label: '成长与勋章', description: '查看等级、权益、流水和勋章', group: '会员运营', icon: <RiseOutlined />, capabilities: ['growth.read', 'badges.manage'], requireAny: true },
  { path: '/permissions', label: '权限管理', description: '管理运营成员、角色策略和服务器', group: '平台设置', icon: <SafetyCertificateOutlined />, capabilities: ['roles.change', 'branches.manage', 'audit.read'], requireAny: true },
  { path: '/messages', label: '消息管理', description: '管理站内消息、模板和发送计划', group: '平台设置', icon: <MessageOutlined />, capabilities: ['messages.manage'] },
  { path: '/knowledge', label: '知识库', description: '管理内容、来源、审核和采集计划', group: '平台设置', icon: <BookOutlined />, capabilities: ['knowledge.manage'] },
  { path: '/operations', label: '运营记录', description: '查看公告、举报、异常和运营待办', group: '平台设置', icon: <FileSearchOutlined />, capabilities: ['announcements.manage', 'community.reports.manage', 'operations.exceptions.read', 'messages.delivery.review'], requireAny: true },
]

export const navigationByPath = new Map(adminNavigation.map(item => [item.path, item]))
