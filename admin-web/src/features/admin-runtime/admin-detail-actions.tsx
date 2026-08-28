import { Button, Space } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import type { AdminDetailRoute, AdminDetailView } from '../../modules/admin-details'
import type { AdminOperationLaunchContext, AdminRowOperation } from '../../modules/admin-row-operations'
import { messageScheduleCancelAction } from '../../modules/admin-row-operations'
import { useAdminOperations } from './admin-operation-provider'

export function AdminDetailActions({ route, id, view, onTaskExport, onMediaUpload }: {
  route: AdminDetailRoute
  id: string
  view: AdminDetailView
  onTaskExport?: (taskId: string) => void
  onMediaUpload?: () => void
}) {
  const { hasCapability } = useAdminSession()
  const { launch } = useAdminOperations()
  const button = (
    action: string,
    label: string,
    targetId = id,
    capability?: string,
    options: AdminOperationLaunchContext & { targetStatus?: 'PUBLISHED' | 'UNPUBLISHED' } = {},
  ) => !capability || hasCapability(capability)
    ? <Button key={`${action}-${label}`} onClick={() => void launch(action, targetId, view, options)}>{label}</Button>
    : null

  const actions: React.ReactNode[] = []
  if (route === 'users') {
    actions.push(
      button('mip.admin.memberships.grant', '补录会员', id, 'memberships.adjust'),
      button('mip.admin.users.update', '编辑资料', id, 'users.fields.edit'),
      button('mip.admin.users.changePrimaryBranch', '变更服务器', id, 'users.fields.edit'),
      button('mip.admin.users.setControl', '访问控制', id, 'users.access.manage'),
      button('mip.admin.roles.set', '设置角色', id, 'roles.change'),
      button('mip.admin.badges.grant', '授予勋章', id, 'badges.manage'),
      button('mip.admin.growth.adjust', '调整成长值', id, 'growth.adjust'),
    )
  }
  else if (route === 'events') {
    const targetStatus = view.status === '已发布' ? 'UNPUBLISHED'
      : ['草稿', '已下架'].includes(view.status) ? 'PUBLISHED' : null
    actions.push(button('mip.admin.events.save', '编辑活动', id, 'events.write'))
    if (targetStatus) actions.push(button(
      'mip.admin.events.changeStatus',
      targetStatus === 'PUBLISHED' ? '发布活动' : '下架活动',
      id,
      'events.write',
      { targetStatus },
    ))
    if (view.status === '草稿') actions.push(button('mip.admin.events.archive', '归档活动', id, 'events.write'))
    actions.push(
      button('mip.admin.events.clone', '克隆活动', id, 'events.write'),
      button('mip.admin.events.tags.replace', '活动标签', id, 'events.write'),
      button('mip.admin.communications.publishEventReminder', '发布提醒', id, 'communications.publish'),
    )
  }
  else if (route === 'orders') actions.push(button('mip.admin.refunds.submit', '提交退款', id, 'refunds.submit'))
  else if (route === 'tasks') {
    const task = record(view.source?.task)
    const status = String(task.status || '')
    const selected = String(task.assignmentMode || '') === 'SELECTED'
    actions.push(button('mip.admin.tasks.save', '编辑任务', id, 'tasks.manage'))
    if (['DRAFT', 'UNPUBLISHED'].includes(status)) actions.push(button('mip.admin.tasks.publish', '发布任务', id, 'tasks.manage'))
    if (status === 'PUBLISHED') actions.push(button('mip.admin.tasks.unpublish', '下架任务', id, 'tasks.manage'))
    if (selected) actions.push(
      button('mip.admin.tasks.assignMembers', '分配成员', id, 'tasks.manage'),
      button('mip.admin.tasks.revokeMembers', '撤销成员', id, 'tasks.manage'),
    )
    actions.push(button('mip.admin.tasks.delete', '删除任务', id, 'tasks.manage'))
    if (hasCapability('tasks.manage') && onTaskExport) actions.push(<Button key="task-export" onClick={() => onTaskExport(id)}>导出完成记录</Button>)
  }
  else if (route === 'banners') {
    const banner = record(view.source?.banner)
    const version = positiveVersion(banner.version)
    const status = String(banner.status || '')
    if (onMediaUpload) actions.push(<Button key="banner-upload" onClick={onMediaUpload}>上传图片</Button>)
    actions.push(button('mip.admin.banners.save', '编辑 Banner', id, 'banners.manage'))
    if (version) {
      if (['ACTIVE', 'INACTIVE'].includes(status)) actions.push(button(
        'mip.admin.banners.changeStatus', status === 'ACTIVE' ? '停用' : '启用', id, 'banners.manage',
        { expectedVersion: version, values: { status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } },
      ))
      actions.push(
        button('mip.admin.banners.move', '上移', id, 'banners.manage', { expectedVersion: version, values: { direction: 'UP' } }),
        button('mip.admin.banners.move', '下移', id, 'banners.manage', { expectedVersion: version, values: { direction: 'DOWN' } }),
      )
      if (status !== 'DELETED') actions.push(button('mip.admin.banners.delete', '删除', id, 'banners.manage', { expectedVersion: version }))
    }
  }
  else if (route === 'gameSeasons') {
    const season = record(view.source?.season)
    const version = positiveVersion(season.version)
    const status = String(season.status || '')
    if (status !== 'CLOSED') actions.push(button('mip.admin.game.seasons.save', '编辑赛季', id, 'game.manage'))
    if (version && ['DRAFT', 'ACTIVE'].includes(status)) actions.push(button(
      'mip.admin.game.seasons.changeStatus', status === 'DRAFT' ? '启用赛季' : '结束赛季', id, 'game.manage',
      { expectedVersion: version, values: { seasonId: id, status: status === 'DRAFT' ? 'ACTIVE' : 'CLOSED' } },
    ))
    actions.push(
      button('mip.admin.game.teams.save', '新增战队', '', 'game.manage'),
      button('mip.admin.game.matches.save', '新增周赛', '', 'game.manage'),
      button('mip.admin.game.rankings.generate', '生成排行', '', 'game.manage'),
    )
  }
  else if (route === 'gameTeams') {
    const team = record(view.source?.team)
    const teamId = String(team.id || id)
    const version = positiveVersion(team.version)
    const status = String(team.status || '')
    const seasonId = String(view.source?.seasonId || team.seasonId || '')
    actions.push(button('mip.admin.game.teams.save', '编辑战队', teamId, 'game.manage'))
    if (version && ['ACTIVE', 'INACTIVE'].includes(status)) actions.push(button(
      'mip.admin.game.teams.changeStatus', status === 'ACTIVE' ? '停用战队' : '启用战队', teamId, 'game.manage',
      { expectedVersion: version, values: { seasonId, teamId, status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } },
    ))
    actions.push(button('mip.admin.game.teams.members.replace', '替换成员', teamId, 'game.manage'))
  }
  else if (route === 'gameCatalogs') {
    const catalog = record(view.source?.catalog)
    const version = positiveVersion(catalog.version)
    const status = String(catalog.status || '')
    actions.push(button('mip.admin.game.blindBoxes.catalogs.save', '编辑目录', id, 'game.manage'))
    if (version && ['PUBLISHED', 'UNPUBLISHED'].includes(status)) actions.push(button(
      'mip.admin.game.blindBoxes.catalogs.changeStatus', status === 'PUBLISHED' ? '下架目录' : '发布目录', id, 'game.manage',
      { expectedVersion: version, values: { catalogId: id, status: status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED' } },
    ))
    actions.push(button('mip.admin.game.blindBoxes.cards.save', '新增卡片', '', 'game.manage'))
  }
  else if (route === 'messages') {
    const source = record(view.source)
    const cancel = messageScheduleCancelAction(record(source.campaign), record(source.dispatch))
    actions.push(
      button('mip.admin.messageCampaigns.save', '编辑消息', id, 'messages.manage'),
      button('mip.admin.messageCampaigns.snapshot', '生成收件人快照', id, 'messages.manage'),
      button('mip.admin.messageCampaigns.schedule', '设置发送时间', id, 'messages.manage'),
      cancel ? button(cancel.action, cancel.label, cancel.targetId, 'messages.manage', cancel) : null,
      button('mip.admin.messageCampaigns.publish', '发布消息', id, 'messages.manage'),
      button('mip.admin.messageCampaigns.withdraw', '撤回消息', id, 'messages.manage'),
    )
  }
  else if (route === 'knowledge') actions.push(
    button('mip.admin.knowledge.contents.save', '编辑内容', id, 'knowledge.manage'),
    button('mip.admin.knowledge.contents.review', '审核内容', id, 'knowledge.manage'),
  )
  else if (route === 'opportunities') actions.push(
    button('mip.admin.opportunities.save', '编辑机会', id, 'opportunities.moderate'),
    button('mip.admin.opportunities.publish', '发布机会', id, 'opportunities.moderate'),
    button('mip.admin.opportunities.end', '结束机会', id, 'opportunities.moderate'),
    button('mip.admin.opportunities.unpublish', '下架机会', id, 'opportunities.moderate'),
    button('mip.admin.opportunities.archive', '归档机会', id, 'opportunities.archive'),
  )

  return actions.some(Boolean) ? <Space size={8} wrap>{actions}</Space> : null
}

export function useDetailRowAction(view: AdminDetailView | null) {
  const { launch } = useAdminOperations()
  return (operation: AdminRowOperation) => launch(
    operation.action,
    operation.targetId,
    view,
    operation,
  )
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function positiveVersion(value: unknown) {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}
