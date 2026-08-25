import type { UserTaskCard } from '../../../modules/mip-tasks'
import { mipTasksModule } from '../../../modules/mip-tasks'

interface TaskView extends UserTaskCard {
  statusText: string
  deadlineText: string
}

function taskView(task: UserTaskCard): TaskView {
  const statusText = task.status === 'COMPLETED' ? '已完成' : task.status === 'ENDED' ? '已截止' : '待完成'
  return {
    ...task,
    statusText,
    deadlineText: task.endsAt ? `截止 ${new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false })}` : '不限截止时间',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as TaskView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onShow() {
    void this.loadTasks()
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
      this.setData({
        tasks: this.data.tasks.concat(page.items.map(taskView)),
        nextCursor: page.nextCursor || '',
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
})
