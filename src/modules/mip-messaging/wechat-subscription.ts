import type {
  SubscriptionDecision,
  WechatSubscriptionRequester,
} from './types'

interface TemplateConfig {
  templateId: string
}

function parseTemplates(source: string): Readonly<Record<string, TemplateConfig>> {
  if (!source.trim()) {
    return {}
  }
  try {
    const value = JSON.parse(source) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const normalizedKey = key.trim()
      const templateId = typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && !Array.isArray(item)
          ? String((item as Record<string, unknown>).templateId || '').trim()
          : ''
      return normalizedKey && templateId ? [[normalizedKey, { templateId }]] : []
    }))
  }
  catch {
    return {}
  }
}

function normalizeDecision(value: unknown): SubscriptionDecision {
  if (value === 'accept') {
    return 'ACCEPTED'
  }
  if (value === 'ban') {
    return 'BANNED'
  }
  return 'REJECTED'
}

export function createWechatSubscriptionRequester(
  templatesJson: string,
  request: typeof wx.requestSubscribeMessage | undefined = wx.requestSubscribeMessage,
): WechatSubscriptionRequester {
  const templates = parseTemplates(templatesJson)

  return {
    capability(templateKey) {
      const key = templateKey.trim()
      if (!templates[key]) {
        return { templateKey: key, available: false, reason: 'TEMPLATE_MISSING' }
      }
      if (typeof request !== 'function') {
        return { templateKey: key, available: false, reason: 'CLIENT_UNAVAILABLE' }
      }
      return { templateKey: key, available: true }
    },

    async request(templateKey) {
      const key = templateKey.trim()
      const template = templates[key]
      if (!template) {
        throw new TypeError('SUBSCRIPTION_TEMPLATE_MISSING')
      }
      if (typeof request !== 'function') {
        throw new TypeError('SUBSCRIPTION_CLIENT_UNAVAILABLE')
      }
      const result = await request({ tmplIds: [template.templateId] })
      return normalizeDecision(result[template.templateId])
    },
  }
}
