import type { UserTaskCard } from '../../../../modules/mip-tasks'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { mipTasksModule, rewardExperienceStarIndexes } from '../../../../modules/mip-tasks'
import { chooseSingleImage } from '../../../../platform/wechat/image-upload'

const MAXIMUM_ORIGINAL_BYTES = 10 * 1024 * 1024

/** figma 1725_18515: 面板正文按行分块；以 • 开头的行使用悬挂缩进（padding-left 21px / text-indent -13px）。 */
interface TextBlock {
  text: string
  bullet: boolean
}

function toBlocks(value: string): TextBlock[] {
  return value
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => ({ text: line, bullet: line.startsWith('•') }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    taskId: '',
    task: null as UserTaskCard | null,
    starIndexes: [] as number[],
    periodText: '',
    conditionText: '',
    purposeBlocks: [] as TextBlock[],
    contentBlocks: [] as TextBlock[],
    standardBlocks: [] as TextBlock[],
    conditionHint: '',
    showConditionPanel: false,
    attachmentName: '',
    attachmentTime: '',
    attachmentAssetId: '',
    attachmentUrl: '',
    uploading: false,
    submitting: false,
    savingTemplate: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const taskId = String(options.taskId || '')
    this.setData({ taskId })
    void this.loadTask()
  },

  async loadTask() {
    if (!this.data.task) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const task = await mipTasksModule.query.getTask(this.data.taskId)
      const attachmentName = task.attachment?.name || ''
      this.setData({
        state: 'ready',
        task,
        starIndexes: rewardExperienceStarIndexes(task.rewardExperience),
        periodText: task.endsAt
          ? new Date(task.endsAt).toLocaleString('zh-CN', { hour12: false })
          : '不限',
        conditionText: task.attachmentRequired ? '需上传附件' : '无需附件',
        purposeBlocks: toBlocks(task.purpose || ''),
        contentBlocks: toBlocks(task.content),
        standardBlocks: toBlocks(task.completionStandard || ''),
        conditionHint: task.attachmentHint || '',
        showConditionPanel: task.attachmentRequired && attachmentName === '',
        attachmentName,
        attachmentTime: task.attachment?.uploadedAt || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '任务加载失败' })
    }
  },

  async chooseAttachment() {
    if (this.data.uploading || this.data.task?.status !== 'AVAILABLE') {
      return
    }
    this.setData({ uploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage(MAXIMUM_ORIGINAL_BYTES)
      const asset = await mipMediaModule.uploadImageFromPath('TASK_ATTACHMENT', sourcePath)
      this.setData({ attachmentAssetId: asset.assetId, attachmentUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '附件上传失败' })
    }
    finally {
      this.setData({ uploading: false })
    }
  },

  async submitTask() {
    const task = this.data.task
    if (!task || task.status !== 'AVAILABLE' || this.data.submitting) {
      return
    }
    if (task.attachmentRequired && !this.data.attachmentAssetId) {
      this.setData({ message: '请先上传任务附件' })
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      await mipTasksModule.mutation.completeTask(task.id, this.data.attachmentAssetId || undefined)
      wx.showToast({ title: '任务已完成', icon: 'success' })
      await this.loadTask()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务提交失败' })
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  async saveTemplate() {
    const url = this.data.task?.template?.url || ''
    if (!url || this.data.savingTemplate) {
      return
    }
    this.setData({ savingTemplate: true, message: '' })
    try {
      await mipTasksModule.saveTemplateImage(url)
      wx.showToast({ title: '模板已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '模板保存失败' })
    }
    finally { this.setData({ savingTemplate: false }) }
  },

  /** 附件删除 API 暂缺（后端未存储文件名/删除通道）：提示到上传流程处理。 */
  manageAttachment() {
    wx.showToast({ title: '附件管理筹备中', icon: 'none' })
  },
})
