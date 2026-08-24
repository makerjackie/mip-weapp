import type { AdminTaskCard, TaskAssignmentMode, TaskCardStatus, TaskEligibleLevel } from '../../../modules/mip-tasks'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { mipTasksModule } from '../../../modules/mip-tasks'
import { chooseSingleImage } from '../../../modules/platform/image-upload'

interface TaskView extends AdminTaskCard {
  statusText: string
  attachmentText: string
  assignmentText: string
  deadlineText: string
  templateText: string
  eligibleLevelText: string
}

interface TaskEligibleLevelView extends TaskEligibleLevel {
  thresholdText: string
  selected: boolean
}

const statusLabels: Record<TaskCardStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  DELETED: '已删除',
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function localTime(value: Date) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`
}

function deadlineIso(date: string, time: string) {
  const value = new Date(`${date}T${time || '23:59'}:00`)
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('截止时间格式无效')
  }
  return value.toISOString()
}

function taskView(task: AdminTaskCard): TaskView {
  return {
    ...task,
    statusText: statusLabels[task.status],
    attachmentText: task.attachmentRequired ? '需要图片附件' : '无需附件',
    assignmentText: task.assignmentMode === 'SELECTED' ? `指定成员 ${task.assignmentCount} 人` : '全部成员',
    deadlineText: task.endsAt ? `截止 ${new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false })}` : '不限截止时间',
    templateText: task.template ? '已配置模板' : '无模板',
    eligibleLevelText: task.eligibleLevels.length
      ? `等级：${task.eligibleLevels.map(level => level.name).join('、')}`
      : '全部等级',
  }
}

function eligibleLevelView(level: TaskEligibleLevel, selectedIds: string[]): TaskEligibleLevelView {
  return {
    ...level,
    thresholdText: `${level.minimumExperience} 经验值`,
    selected: selectedIds.includes(level.id),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error' | 'forbidden' | 'conflict',
    tasks: [] as TaskView[],
    status: '' as TaskCardStatus | '',
    query: '',
    nextCursor: '',
    loadingMore: false,
    editorOpen: false,
    editingId: '',
    expectedVersion: 0,
    name: '',
    content: '',
    rewardExperience: '0',
    attachmentRequired: false,
    assignmentMode: 'ALL' as TaskAssignmentMode,
    eligibleLevelOptions: [] as TaskEligibleLevelView[],
    eligibleLevelIds: [] as string[],
    eligibleLevelsState: 'loading' as 'loading' | 'ready' | 'error',
    eligibleLevelsMessage: '',
    endsDate: '',
    endsTime: '23:59',
    templateAssetId: '',
    templateUrl: '',
    uploadingTemplate: false,
    processing: false,
    message: '',
  },

  onShow() {
    void this.loadEligibleLevels()
    void this.loadTasks()
  },

  async loadEligibleLevels() {
    this.setData({ eligibleLevelsState: 'loading', eligibleLevelsMessage: '' })
    try {
      const levels = await mipTasksModule.gateway.listEligibleLevels()
      const activeLevelIds = new Set(levels.map(level => level.id))
      const unavailableLevels = this.data.eligibleLevelOptions.filter(level => (
        level.selected && level.status !== 'ACTIVE' && !activeLevelIds.has(level.id)
      ))
      this.setData({
        eligibleLevelOptions: [
          ...levels.map(level => eligibleLevelView(level, this.data.eligibleLevelIds)),
          ...unavailableLevels,
        ],
        eligibleLevelsState: 'ready',
      })
    }
    catch (error) {
      this.setData({
        eligibleLevelsState: 'error',
        eligibleLevelsMessage: error instanceof Error ? error.message : '成长等级加载失败',
      })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadTasks()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadTasks() {
    if (!this.data.tasks.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipTasksModule.gateway.listAdminTasks({
        status: this.data.status,
        query: this.data.query,
      }, undefined, 20)
      const tasks = page.items.map(taskView)
      this.setData({
        state: tasks.length ? 'ready' : 'empty',
        tasks,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      const code = (error as { code?: string })?.code
      this.setData({
        state: code === 'FORBIDDEN' ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : '任务管理加载失败',
      })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipTasksModule.gateway.listAdminTasks({
        status: this.data.status,
        query: this.data.query,
      }, this.data.nextCursor, 20)
      this.setData({
        tasks: this.data.tasks.concat(page.items.map(taskView)),
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多任务加载失败' })
    }
    finally { this.setData({ loadingMore: false }) }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.status || '') as TaskCardStatus | '' })
    void this.loadTasks()
  },

  openCreate() {
    this.setData({
      editorOpen: true,
      editingId: '',
      expectedVersion: 0,
      name: '',
      content: '',
      rewardExperience: '0',
      attachmentRequired: false,
      assignmentMode: 'ALL',
      eligibleLevelIds: [],
      eligibleLevelOptions: this.data.eligibleLevelOptions.map(level => ({ ...level, selected: false })),
      endsDate: '',
      endsTime: '23:59',
      templateAssetId: '',
      templateUrl: '',
      message: '',
    })
  },

  async editTask(event: WechatMiniprogram.TouchEvent) {
    const task = this.data.tasks.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!task) {
      return
    }
    this.setData({ editorOpen: true, processing: true, message: '' })
    try {
      const detail = await mipTasksModule.gateway.getAdminTask(task.id)
      const endsAt = detail.endsAt ? new Date(detail.endsAt) : null
      const catalogIds = new Set(this.data.eligibleLevelOptions.map(level => level.id))
      const unavailableLevels = detail.eligibleLevels
        .filter(level => !catalogIds.has(level.id))
        .map(level => eligibleLevelView(level, detail.eligibleLevels.map(item => item.id)))
      this.setData({
        editorOpen: true,
        editingId: detail.id,
        expectedVersion: detail.version,
        name: detail.name,
        content: detail.content,
        rewardExperience: String(detail.rewardExperience),
        attachmentRequired: detail.attachmentRequired,
        assignmentMode: detail.assignmentMode,
        eligibleLevelIds: detail.eligibleLevels.map(level => level.id),
        eligibleLevelOptions: [
          ...this.data.eligibleLevelOptions.map(level => ({
            ...level,
            selected: detail.eligibleLevels.some(selected => selected.id === level.id),
          })),
          ...unavailableLevels,
        ],
        endsDate: endsAt ? localDate(endsAt) : '',
        endsTime: endsAt ? localTime(endsAt) : '23:59',
        templateAssetId: detail.template?.assetId || '',
        templateUrl: detail.template?.url || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务详情加载失败' })
    }
    finally { this.setData({ processing: false }) }
  },

  closeEditor() { this.setData({ editorOpen: false }) },
  updateName(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ name: event.detail.value }) },
  updateContent(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ content: event.detail.value }) },
  updateReward(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ rewardExperience: event.detail.value }) },
  toggleAttachment(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) { this.setData({ attachmentRequired: event.detail.value }) },
  chooseAssignmentMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '')
    if (mode === 'ALL' || mode === 'SELECTED') {
      this.setData({ assignmentMode: mode })
    }
  },
  toggleEligibleLevel(event: WechatMiniprogram.TouchEvent) {
    const levelId = String(event.currentTarget.dataset.levelId || '')
    if (!this.data.eligibleLevelOptions.some(level => level.id === levelId)) {
      return
    }
    const eligibleLevelIds = this.data.eligibleLevelIds.includes(levelId)
      ? this.data.eligibleLevelIds.filter(id => id !== levelId)
      : [...this.data.eligibleLevelIds, levelId]
    this.setData({
      eligibleLevelIds,
      eligibleLevelOptions: this.data.eligibleLevelOptions.map(level => ({
        ...level,
        selected: eligibleLevelIds.includes(level.id),
      })),
    })
  },
  updateEndsDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ endsDate: event.detail.value }) },
  updateEndsTime(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ endsTime: event.detail.value }) },
  clearDeadline() { this.setData({ endsDate: '', endsTime: '23:59' }) },

  async uploadTemplate() {
    if (this.data.uploadingTemplate) {
      return
    }
    this.setData({ uploadingTemplate: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage(10 * 1024 * 1024)
      const asset = await mipMediaModule.uploadImageFromPath('TASK_TEMPLATE', sourcePath)
      this.setData({ templateAssetId: asset.assetId, templateUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务模板上传失败' })
    }
    finally { this.setData({ uploadingTemplate: false }) }
  },
  removeTemplate() { this.setData({ templateAssetId: '', templateUrl: '' }) },

  async saveTask() {
    if (this.data.processing) {
      return
    }
    const rewardExperience = Number(this.data.rewardExperience)
    if (this.data.eligibleLevelsState !== 'ready') {
      this.setData({ message: '成长等级尚未加载，暂时不能保存任务' })
      return
    }
    if (!this.data.name.trim() || !this.data.content.trim()
      || !Number.isInteger(rewardExperience) || rewardExperience < 0) {
      this.setData({ message: '请完整填写任务名称、内容和奖励经验值' })
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipTasksModule.gateway.saveTask({
        taskId: this.data.editingId || undefined,
        expectedVersion: this.data.editingId ? this.data.expectedVersion : undefined,
        task: {
          name: this.data.name,
          content: this.data.content,
          rewardExperience,
          attachmentRequired: this.data.attachmentRequired,
          assignmentMode: this.data.assignmentMode,
          eligibleLevelIds: this.data.eligibleLevelIds,
          endsAt: this.data.endsDate ? deadlineIso(this.data.endsDate, this.data.endsTime) : undefined,
          templateAssetId: this.data.templateAssetId || undefined,
        },
      })
      wx.showToast({ title: '任务已保存', icon: 'success' })
      this.setData({ editorOpen: false })
      await this.loadTasks()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务保存失败' })
    }
    finally { this.setData({ processing: false }) }
  },

  async changeStatus(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processing) {
      return
    }
    const task = this.data.tasks.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    const action = String(event.currentTarget.dataset.action || '')
    if (!task || !['publish', 'unpublish', 'delete'].includes(action)) {
      return
    }
    const labels = { publish: '发布', unpublish: '下架', delete: '删除' } as const
    const descriptions = {
      publish: '发布后用户可以查看并提交任务。',
      unpublish: '下架后用户不能查看或提交任务。',
      delete: '任务将从管理列表中移除，已有完成流水和成长流水保留。',
    } as const
    const key = action as keyof typeof labels
    const modal = await wx.showModal({ title: `确认${labels[key]}任务`, content: descriptions[key] })
    if (!modal.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      if (action === 'publish') {
        await mipTasksModule.gateway.publishTask(task.id, task.version)
      }
      if (action === 'unpublish') {
        await mipTasksModule.gateway.unpublishTask(task.id, task.version)
      }
      if (action === 'delete') {
        await mipTasksModule.gateway.deleteTask(task.id, task.version)
      }
      wx.showToast({ title: `任务已${labels[key]}`, icon: 'success' })
      await this.loadTasks()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务状态更新失败' })
    }
    finally { this.setData({ processing: false }) }
  },

  openCompletions(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    void wx.navigateTo({ url: `/packages/admin/task-completions/index${taskId ? `?taskId=${taskId}` : ''}` })
  },

  openAssignments(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version || 0)
    if (taskId && version > 0) {
      void wx.navigateTo({ url: `/packages/admin/task-assignments/index?taskId=${taskId}&version=${version}` })
    }
  },
})
