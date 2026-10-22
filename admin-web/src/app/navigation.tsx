import {
  AppstoreOutlined,
  AuditOutlined,
  BulbOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CrownOutlined,
  FileSearchOutlined,
  GoldOutlined,
  MessageOutlined,
  PictureOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  ClusterOutlined,
  ShoppingCartOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  UserOutlined,
  TrophyOutlined,
  BookOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'

// MIW-129：原 /growth 从侧栏与类型中移除，旧链接经路由重定向进入 /levels。
// MIW-132：/task-approval 进入侧栏「运营中心」，路由仍由 router.tsx 的 taskApprovalRoute 注册。
export type AdminRoutePath =
  | '/overview'
  | '/users'
  | '/cards'
  | '/events'
  | '/orders'
  | '/tasks'
  | '/task-approval'
  | '/banners'
  | '/videos'
  | '/media'
  | '/game'
  | '/opportunities'
  | '/levels'
  | '/experience'
  | '/contribution'
  | '/entitlements'
  | '/permissions'
  | '/servers'
  | '/admin-accounts'
  | '/audit-logs'
  | '/messages'
  | '/knowledge'
  | '/operations'

export interface AdminNavigationItem {
  path: AdminRoutePath
  label: string
  description: string
  group: '工作台' | '人才与机会' | '运营中心' | '成长体系' | '系统管理'
  icon: ReactNode
  capabilities: string[]
  requireAny?: boolean
}

// MIW-132：全部后台路由的唯一清单，分组与顺序对齐原型（工作台 → 人才与机会 → 运营中心 → 成长体系 → 系统管理）。
// 名片管理、知识库、运营记录仅移出侧栏，路由与页面保留，仍可从用户档案、页签等处直达。
const adminItems: AdminNavigationItem[] = [
  { path: '/overview', label: '网站概览', description: '查看会员、活动、订单和运营状态', group: '工作台', icon: <AppstoreOutlined />, capabilities: ['admin.dashboard'] },
  { path: '/users', label: '用户管理', description: '查看用户、会员、服务器和账号状态', group: '人才与机会', icon: <UserOutlined />, capabilities: ['users.read'] },
  { path: '/opportunities', label: '机会管理', description: '管理机会、合作内容和治理记录', group: '人才与机会', icon: <BulbOutlined />, capabilities: ['opportunities.moderate', 'userContent.moderate'], requireAny: true },
  { path: '/cards', label: '名片管理', description: '查看个人名片、模板和修改记录', group: '人才与机会', icon: <UserOutlined />, capabilities: ['users.read'] },
  { path: '/events', label: '活动管理', description: '管理活动、报名、签到和活动内容', group: '运营中心', icon: <CalendarOutlined />, capabilities: ['events.read'] },
  { path: '/banners', label: 'Banner 管理', description: '管理首页 Banner 和跳转目标', group: '运营中心', icon: <PictureOutlined />, capabilities: ['banners.manage'] },
  { path: '/videos', label: '视频回顾', description: '管理往期活动回顾的封面与视频号跳转', group: '运营中心', icon: <PictureOutlined />, capabilities: ['events.recaps.manage'] },
  { path: '/orders', label: '订单管理', description: '查看订单、支付和退款事实', group: '运营中心', icon: <ShoppingCartOutlined />, capabilities: ['orders.read'] },
  { path: '/task-approval', label: 'NPC任务', description: '查看 NPC 任务提交与审批记录', group: '运营中心', icon: <AuditOutlined />, capabilities: ['tasks.manage'] },
  // 素材上传与战队管理不在原型菜单内，属真实功能，保留在「运营中心」。
  { path: '/media', label: '素材上传', description: '上传并复用受控运营素材', group: '运营中心', icon: <UploadOutlined />, capabilities: ['banners.manage', 'events.write', 'events.recaps.manage', 'opportunities.moderate', 'userContent.moderate', 'tasks.manage'], requireAny: true },
  { path: '/game', label: '战队管理', description: '管理赛季、战队、赛况、排行和盲盒', group: '运营中心', icon: <TrophyOutlined />, capabilities: ['game.manage'] },
  // MIW-129：原「成长与勋章」按设计稿拆为「成长体系」组四个独立菜单页。
  { path: '/levels', label: '等级管理', description: '管理等级门槛、等级权益、等级变更和勋章目录', group: '成长体系', icon: <RiseOutlined />, capabilities: ['growth.read', 'badges.manage'], requireAny: true },
  { path: '/experience', label: '经验值管理', description: '查询经验值流水和成长奖励规则', group: '成长体系', icon: <ThunderboltOutlined />, capabilities: ['growth.read'] },
  { path: '/contribution', label: '贡献值管理', description: '查询贡献值流水和贡献值规则', group: '成长体系', icon: <GoldOutlined />, capabilities: ['growth.read'] },
  { path: '/entitlements', label: '权益管理', description: '查询权益流水、入会审核和会员方案', group: '成长体系', icon: <CrownOutlined />, capabilities: ['memberships.read'] },
  // MIW-132：任务管理并入「成长体系」组，对齐原型。
  { path: '/tasks', label: '任务管理', description: '管理任务、成员分配和完成记录', group: '成长体系', icon: <CheckSquareOutlined />, capabilities: ['tasks.manage'] },
  { path: '/permissions', label: '权限管理', description: '管理运营成员、角色策略和审计记录', group: '系统管理', icon: <SafetyCertificateOutlined />, capabilities: ['roles.change', 'audit.read'], requireAny: true },
  { path: '/servers', label: '服务器管理', description: '管理服务器资料、负责人和启停状态', group: '系统管理', icon: <ClusterOutlined />, capabilities: ['branches.manage'] },
  { path: '/admin-accounts', label: '后台账号', description: '管理后台运营账号、角色和状态', group: '系统管理', icon: <UserOutlined />, capabilities: ['roles.change'] },
  { path: '/audit-logs', label: '审计日志', description: '查询完整操作审计记录', group: '系统管理', icon: <FileSearchOutlined />, capabilities: ['audit.read'] },
  { path: '/messages', label: '消息管理', description: '管理站内消息、模板和发送计划', group: '系统管理', icon: <MessageOutlined />, capabilities: ['messages.manage'] },
  { path: '/knowledge', label: '知识库', description: '管理内容、来源、审核和采集计划', group: '系统管理', icon: <BookOutlined />, capabilities: ['knowledge.manage'] },
  { path: '/operations', label: '运营记录', description: '查看公告、举报、异常和运营待办', group: '系统管理', icon: <FileSearchOutlined />, capabilities: ['announcements.manage', 'community.reports.manage', 'operations.exceptions.read', 'messages.delivery.review'], requireAny: true },
]

// router.tsx 仍由该清单注册页面路由；/task-approval 已由 MIW-130 单独注册，此处排除以免路由重复。
export const adminNavigation: AdminNavigationItem[] = adminItems.filter(item => item.path !== '/task-approval')

// 侧栏菜单（MIW-132 收敛）：名片管理、知识库、运营记录移出侧栏，NPC任务进入「运营中心」。
const SIDEBAR_REMOVED_PATHS: AdminRoutePath[] = ['/cards', '/knowledge', '/operations']
export const adminSidebarNavigation: AdminNavigationItem[] = adminItems.filter(item => !SIDEBAR_REMOVED_PATHS.includes(item.path))

// 页签栏与高亮按全量清单解析，直达被移出侧栏的页面时仍能显示正确的页签与上下文。
export const navigationByPath = new Map(adminItems.map(item => [item.path, item]))
