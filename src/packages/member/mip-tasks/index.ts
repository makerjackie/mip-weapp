import type { UserTaskCard } from '../../../modules/mip-tasks'
import { mipTasksModule } from '../../../modules/mip-tasks'

interface TaskView extends UserTaskCard {
  statusText: string
  deadlineText: string
  attachmentText: string
  templateText: string
}

function taskView(task: UserTaskCard): TaskView {
  const statusText = task.status === 'COMPLETED' ? '已完成' : task.status === 'ENDED' ? '已截止' : '待完成'
  return {
    ...task,
    statusText,
    deadlineText: task.endsAt ? `截止 ${new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false })}` : '不限截止时间',
    attachmentText: task.attachmentRequired ? '需要上传附件' : '无需附件',
    templateText: task.hasTemplate ? '提供任务模板' : '未配置任务模板',
  }
}

function visibleTasks(tasks: TaskView[], filter: 'pending' | 'ended') {
  return tasks.filter(task => filter === 'ended' ? task.status !== 'AVAILABLE' : task.status === 'AVAILABLE')
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as TaskView[],
    visibleTasks: [] as TaskView[],
    filter: 'pending' as 'pending' | 'ended',
    canDispatch: false,
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onShow() {
    void this.loadTasks()
    void this.loadCapability()
  },

  async loadCapability() {
    try {
      await mipTasksModule.query.getAdminSession()
      this.setData({ canDispatch: true })
    }
    catch {
      this.setData({ canDispatch: false })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadTasks(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadTasks(force = false) {
    if (!this.data.tasks.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipTasksModule.query.listTasks(undefined, 20, force)
      const tasks = page.items.map(taskView)
      this.setData({
        state: tasks.length ? 'ready' : 'empty',
        tasks,
        visibleTasks: visibleTasks(tasks, this.data.filter),
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: this.data.tasks.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '任务加载失败',
      })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipTasksModule.query.listTasks(this.data.nextCursor, 20)
      const knownTaskIds = new Set(this.data.tasks.map(task => task.id))
      if (page.items.some(task => knownTaskIds.has(task.id))) {
        throw new Error('任务列表返回了重复内容，请刷新后重试')
      }
      const tasks = this.data.tasks.concat(page.items.map(taskView))
      this.setData({
        tasks,
        nextCursor: page.nextCursor || '',
        visibleTasks: visibleTasks(tasks, this.data.filter),
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多任务加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  openTask(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    if (taskId) {
      void wx.navigateTo({ url: `/packages/member/mip-tasks/detail/index?taskId=${taskId}` })
    }
  },

  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || 'pending') as 'pending' | 'ended'
    this.setData({ filter, visibleTasks: visibleTasks(this.data.tasks, filter) })
  },

  openDispatch() {
    if (this.data.canDispatch) {
      void wx.navigateTo({ url: '/packages/admin/tasks/index' })
    }
  },
})
