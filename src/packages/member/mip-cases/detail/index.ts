import type { SuperCaseId } from '../../../../modules/mip'
import type { SuperCaseDetail, SuperCaseProjectView } from '../../../../modules/mip-cases'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { superCaseModule } from '../../../../modules/mip-cases'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../platform/navigation/client'

interface CaseProjectView extends SuperCaseProjectView {
  startedOnText: string
}

interface SuperCaseDetailView extends Omit<SuperCaseDetail, 'projects'> {
  coverUrl: string
  statusText: string
  projects: CaseProjectView[]
}

const CASE_STATUS_LABELS = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已删除',
} as const

function formatCaseDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '.') : value || ''
}

function presentCase(item: SuperCaseDetail): SuperCaseDetailView {
  return {
    ...item,
    coverUrl: item.coverUrl || mipOperationsConfig.defaultCoverPaths.superCase,
    statusText: CASE_STATUS_LABELS[item.status],
    projects: item.projects.map(project => ({
      ...project,
      startedOnText: formatCaseDate(project.startedOn) || '未填写',
    })),
  }
}

Page({
  data: {
    id: '' as SuperCaseId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as SuperCaseDetailView | null,
    mediaUrls: [] as string[],
    acting: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as SuperCaseId })
    void this.load()
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '案例信息不完整' })
      return
    }
    this.setData({ state: 'loading', message: '' })
    try {
      const item = await superCaseModule.get(this.data.id)
      const presented = presentCase(item)
      this.setData({
        state: 'ready',
        item: presented,
        mediaUrls: presented.media.map(media => media.url).filter(Boolean),
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '案例加载失败' })
    }
  },

  previewImage(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.mediaUrls
    if (current && urls.includes(current)) {
      wx.previewImage({ current, urls })
    }
  },

  edit() {
    if (this.data.item?.canEdit && !this.data.acting) {
      caseNavigateTo({ url: `/packages/member/mip-cases/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  async unpublish() {
    const item = this.data.item
    if (!item?.mine || item.status !== 'PUBLISHED' || this.data.acting) {
      return
    }
    this.setData({ acting: true, message: '' })
    const confirmation = await wx.showModal({
      title: '下架案例',
      content: '下架后，其他用户将无法查看这个案例。',
      confirmText: '确认下架',
      confirmColor: '#B30516',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ acting: false })
      return
    }
    try {
      const result = await superCaseModule.unpublish(item.id, item.version)
      this.setData({
        'item.status': result.status,
        'item.version': result.version,
        'item.canEdit': true,
        'item.statusText': CASE_STATUS_LABELS[result.status],
      })
      wx.showToast({ title: '案例已下架', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '案例下架失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async deleteCase() {
    const item = this.data.item
    if (!item?.mine || this.data.acting) {
      return
    }
    this.setData({ acting: true, message: '' })
    const confirmation = await wx.showModal({
      title: '删除案例',
      content: '删除后，这个案例将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ acting: false })
      return
    }
    try {
      await superCaseModule.archive(item.id, item.version)
      wx.showToast({ title: '已删除', icon: 'success' })
      leaveSecondaryPage('/pages/opportunities/index')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '案例删除失败'
      await this.load()
      wx.showToast({ title: message, icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.projectName || 'MIP 超级案例',
      path: `/packages/member/mip-cases/detail/index?id=${this.data.id}`,
    }
  },
})
