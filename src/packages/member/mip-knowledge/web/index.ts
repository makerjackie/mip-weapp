import { runtimeConfig } from '../../../../config/runtime'
import { mipKnowledgeModule } from '../../../../modules/mip-knowledge/module'
import { resolveKnowledgeWebviewUrl } from '../../../../modules/mip-knowledge/webview-url'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    contentId: '',
    url: '',
    message: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    const contentId = String(query.contentId || '')
    this.setData({ contentId })
    void this.loadContent(contentId)
  },
  async loadContent(contentId: string) {
    if (!contentId) {
      this.setData({ state: 'error', url: '', message: '内容参数无效。' })
      return
    }
    this.setData({ state: 'loading', url: '', message: '' })
    try {
      const detail = await mipKnowledgeModule.getContent(contentId)
      const url = detail.access.unlocked
        ? resolveKnowledgeWebviewUrl(detail.externalUrl, runtimeConfig.knowledgeWebviewAllowedHosts)
        : ''
      if (!url) {
        this.setData({ state: 'empty', url: '', message: '当前内容没有可打开的网页。' })
        return
      }
      this.setData({ state: 'ready', url, message: '' })
    }
    catch {
      this.setData({ state: 'error', url: '', message: '暂时无法加载内容，请稍后重试。' })
    }
  },
  reload() {
    void this.loadContent(this.data.contentId)
  },
})
