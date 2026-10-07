import type { SuperCaseId } from '../../../../modules/mip'
import type { SuperCaseDetail, SuperCaseProjectView } from '../../../../modules/mip-cases'
import { superCaseModule } from '../../../../modules/mip-cases'
import { caseNavigateTo } from '../../../../platform/navigation/client'

interface CaseProjectView extends SuperCaseProjectView {
  startedOnText: string
}

// figma 2704_13347 我的编辑：banner 统一品牌图，无封面/状态字段，案例管理不在详情页。
interface SuperCaseDetailView extends Omit<SuperCaseDetail, 'projects'> {
  projects: CaseProjectView[]
}

function formatCaseDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '.') : value || ''
}

function presentCase(item: SuperCaseDetail): SuperCaseDetailView {
  return {
    ...item,
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
    if (this.data.item?.canEdit) {
      caseNavigateTo({ url: `/packages/member/mip-cases/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.projectName || 'MIP 超级案例',
      path: `/packages/member/mip-cases/detail/index?id=${this.data.id}`,
    }
  },
})
