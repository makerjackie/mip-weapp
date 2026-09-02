import type { UserTaskCard } from '../../../modules/mip-tasks'
import { mipTasksModule, rewardExperienceStarIndexes } from '../../../modules/mip-tasks'

interface TaskView extends UserTaskCard {
  statusText: string
  deadlineText: string
  attachmentText: string
  templateText: string
  starIndexes: number[]
}

function taskView(task: UserTaskCard): TaskView {
  const statusText = task.status === 'COMPLETED' ? '已完成' : task.status === 'ENDED' ? '已截止' : '待完成'
  return {
    ...task,
    statusText,
    deadlineText: task.endsAt ? `任务周期 · ${new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false })}` : '任务周期不限',
    attachmentText: task.attachmentRequired ? '需要上传附件' : '无需附件',
    templateText: task.hasTemplate ? '提供任务模板' : '未配置任务模板',
    starIndexes: rewardExperienceStarIndexes(task.rewardExperience),
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
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onShow() {
    void this.loadTasks()
  },

  onHide() {
    this.requestSeq += 1
  },

  onUnload() {
    this.requestSeq += 1
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
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    if (!this.data.tasks.length) {
      this.setData({ state: 'loading', message: '' })
    }
    this.setData({ loadingMore: false })
    try {
      const page = await mipTasksModule.query.listTasks(undefined, 20, force)
      if (seq !== this.requestSeq) {
        return
      }
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
      if (seq !== this.requestSeq) {
        return
      }
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
    const seq = this.requestSeq
    const cursor = this.data.nextCursor
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipTasksModule.query.listTasks(cursor, 20)
      if (seq !== this.requestSeq) {
        return
      }
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
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '更多任务加载失败' })
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
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
})
