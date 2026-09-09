import type { UserTaskCard } from '../../../modules/mip-tasks'
import { mipTasksModule, rewardExperienceStarIndexes } from '../../../modules/mip-tasks'

interface TaskView extends UserTaskCard {
  /** figma 1725_18357: 任务周期 row value（仅值部分，标签在模板中固定） */
  periodText: string
  /** figma 1725_18357: 完成条件 row value */
  conditionText: string
  /** 设计先行：已上传附件展示（后端契约补齐前恒为空 → 不渲染附件卡） */
  attachmentName: string
  attachmentTime: string
  starIndexes: number[]
  /** AVAILABLE → 卡片下方拼接 未完成|完成 操作条 */
  showBar: boolean
  showAttachment: boolean
  /** 无附件卡且无操作条时卡片四角全圆角 */
  cardRoundedAll: boolean
  /** 附件卡是单元末尾时底部圆角 */
  attachmentRoundedB: boolean
}

function taskView(task: UserTaskCard): TaskView {
  const showBar = task.status === 'AVAILABLE'
  const attachmentName = task.attachment?.name || ''
  const showAttachment = attachmentName !== ''
  return {
    ...task,
    periodText: task.endsAt ? new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false }) : '不限',
    conditionText: task.attachmentRequired ? '需上传附件' : '无需附件',
    attachmentName,
    attachmentTime: task.attachment?.uploadedAt || '',
    starIndexes: rewardExperienceStarIndexes(task.rewardExperience),
    showBar,
    showAttachment,
    cardRoundedAll: !showBar && !showAttachment,
    attachmentRoundedB: !showBar,
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

  /** figma 1725_18357 右侧页签：派发任务暂无对应路由（NPC 派发参考页 18634/18676/18736 为路由缺口）。 */
  openDispatch() {
    wx.showToast({ title: '派发功能筹备中', icon: 'none' })
  },

  /** 列表操作条「完成」：直接走 completeTask 变更（附件校验失败时后端报错 → message 展示）。 */
  async completeTask(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    if (!taskId) {
      return
    }
    this.setData({ message: '' })
    try {
      await mipTasksModule.mutation.completeTask(taskId)
      wx.showToast({ title: '任务已完成', icon: 'success' })
      await this.loadTasks(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务提交失败' })
    }
  },

  /** 附件删除 API 暂缺：引导到详情页管理附件。 */
  manageAttachment() {
    wx.showToast({ title: '请在任务详情页管理附件', icon: 'none' })
  },
})
