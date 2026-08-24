import { runtimeConfig } from '../../../../config/runtime'
import { mipKnowledgeModule } from '../../../../modules/mip-knowledge'

Page({
  data: { state: 'loading' as 'loading' | 'ready' | 'error', url: '' },
  onLoad(query: Record<string, string | undefined>) {
    void this.loadContent(String(query.contentId || ''))
  },
  async loadContent(contentId: string) {
    try {
      const detail = await mipKnowledgeModule.getContent(contentId)
      if (!detail.access.unlocked || !detail.externalUrl) {
        throw new Error('CONTENT_UNAVAILABLE')
      }
      const parsed = new URL(detail.externalUrl)
      const allowedHosts = new Set(runtimeConfig.knowledgeWebviewAllowedHosts)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash
        || !allowedHosts.has(parsed.hostname.toLowerCase()) || parsed.search.length > 512
        || Array.from(parsed.searchParams).length > 20
        || Array.from(parsed.searchParams).some(([key, value]) => key.length > 64 || value.length > 256)) {
        throw new Error('INVALID_URL')
      }
      this.setData({ state: 'ready', url: parsed.toString() })
    }
    catch {
      this.setData({ state: 'error', url: '' })
    }
  },
})
