import type { AdminListQuery, AdminListRoute, AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import { demo } from '../../services/demo-data'

export function createDemoReadPage(route: AdminListRoute, query: AdminListQuery): AdminReadPage {
  const page = unfilteredDemoPage(route)
  const text = query.query.toLocaleLowerCase('zh-CN')
  return {
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      rows: section.rows.filter(row => (!query.status || String(row.state || row.status || '') === query.status)
        && (!text || Object.values(row).some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(text)))),
    })),
  }
}

function unfilteredDemoPage(route: AdminListRoute): AdminReadPage {
  if (route === 'tasks') return {
    sections: [
      {
        title: '任务',
        rows: demo.tasks.map((item, index) => ({ ...item, detailId: `demo-task-${index + 1}` })),
        columns: columns([['name', '任务名称'], ['reward', '经验奖励'], ['assignment', '分配范围'], ['assigned', '已分配'], ['completed', '已完成'], ['endsAt', '截止时间'], ['updatedAt', '更新时间'], ['state', '状态']]),
        detailTarget: 'tasks',
      },
      {
        title: '近期完成记录',
        rows: demo.taskCompletions.map(item => ({ ...item })),
        columns: columns([['task', '任务'], ['member', '成员'], ['reward', '经验奖励'], ['completedAt', '完成时间'], ['state', '结果']]),
        detailTarget: null,
      },
    ],
    nextCursor: null,
  }
  if (route === 'permissions') return {
    sections: [{
      title: '运营成员',
      rows: demo.roles.map(item => ({ name: item.name, role: item.capabilities, scope: item.scope, grantedAt: '—', state: '启用' })),
      columns: columns([['name', '姓名'], ['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间'], ['state', '状态']]),
    }], nextCursor: null,
  }
  if (route === 'messages') return {
    sections: [
      {
        title: '消息活动',
        rows: demo.messages.map((item, index) => ({ ...item, detailId: `demo-message-${index + 1}`, scope: item.audience, state: item.status })),
        columns: columns([['title', '消息标题'], ['audience', '发送范围'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
      },
      {
        title: '消息模板',
        rows: [],
        columns: columns([['name', '模板名称'], ['title', '消息标题'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
      },
    ], nextCursor: null,
  }
  if (route === 'knowledge') return {
    sections: [{
      title: '知识内容',
      rows: demo.knowledge.map((item, index) => ({ ...item, detailId: `demo-knowledge-${index + 1}`, category: '运营规范', author: '运营团队', access: '会员可见', state: item.status })),
      columns: columns([['title', '文档标题'], ['type', '内容类型'], ['category', '分类'], ['author', '作者'], ['access', '访问范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }], nextCursor: null,
  }
  if (route === 'banners') return empty([
    { title: 'Banner', columns: columns([['image', '图片'], ['title', '管理名称'], ['target', '跳转目标'], ['order', '顺序'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: 'banners' },
  ])
  if (route === 'game') return empty([
    { title: '赛季', columns: columns([['name', '赛季'], ['period', '周期'], ['rules', '规则说明'], ['version', '版本'], ['state', '状态']]), detailTarget: 'gameSeasons' },
    { title: '战队', columns: columns([['name', '战队'], ['season', '赛季'], ['members', '成员'], ['state', '状态']]), detailTarget: 'gameTeams' },
    { title: '盲盒目录', columns: columns([['name', '目录'], ['cost', '抽取消耗'], ['cards', '卡片数'], ['stock', '剩余库存'], ['version', '版本'], ['state', '状态']]), detailTarget: 'gameCatalogs' },
  ])
  if (route === 'opportunities') return empty([
    { title: '机会', columns: columns([['title', '标题'], ['publisher', '发布人'], ['type', '类型'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: 'opportunities' },
    { title: '用户内容', columns: columns([['title', '标题'], ['author', '作者'], ['type', '类型'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: 'userContent' },
  ])
  if (route === 'growth') return empty([
    { title: '等级', columns: columns([['name', '等级'], ['minimum', '最低经验'], ['benefits', '权益'], ['state', '状态']]), detailTarget: null },
    { title: '成长流水', columns: columns([['user', '用户'], ['change', '变动'], ['reason', '原因'], ['createdAt', '时间']]), detailTarget: null },
    { title: '徽章', columns: columns([['name', '徽章'], ['holderCount', '持有人数'], ['state', '状态']]), detailTarget: null },
  ])
  if (route === 'operations') return empty([
    { title: '公告', columns: columns([['title', '标题'], ['scope', '范围'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '社区举报', columns: columns([['title', '举报内容'], ['reporter', '举报人'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '运营异常', columns: columns([['title', '异常'], ['resource', '资源'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '运营待办', columns: columns([['title', '待办'], ['owner', '负责人'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
  ])
  return empty([{ columns: columns([['title', '记录']]), detailTarget: null }])
}

function empty(sections: Array<{ title?: string; columns: Array<{ key: string; label: string }>; detailTarget: AdminListSectionDetailTarget }>): AdminReadPage {
  return { sections: sections.map(section => ({ ...section, rows: [] })), nextCursor: null }
}

type AdminListSectionDetailTarget = 'tasks' | 'banners' | 'gameSeasons' | 'gameTeams' | 'gameCatalogs' | 'opportunities' | 'userContent' | null

function columns(values: Array<[string, string]>) {
  return values.map(([key, label]) => ({ key, label }))
}

export function demoRows(page: AdminReadPage): AdminTableRow[] {
  return page.sections.flatMap(section => section.rows)
}
