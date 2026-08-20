import type { NotificationSubscriptionResult, NotificationTemplateKey } from '../membership/types'
import { runtimeConfig } from '../../config/runtime'

interface TemplateEntry {
  templateId: string
  fields: Record<string, string>
}

const activityKeys: NotificationTemplateKey[] = [
  'registration',
  'event_update',
  'event_reminder',
  'event_cancel',
  'refund',
]

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function templateConfig() {
  if (!runtimeConfig.subscribeTemplatesJson.trim()) {
    return {} as Partial<Record<NotificationTemplateKey, TemplateEntry>>
  }
  try {
    const parsed = JSON.parse(runtimeConfig.subscribeTemplatesJson) as unknown
    if (!record(parsed)) {
      return {}
    }
    return Object.fromEntries(activityKeys.flatMap((key) => {
      const entry = parsed[key]
      if (!record(entry) || typeof entry.templateId !== 'string' || !entry.templateId.trim()) {
        return []
      }
      return [[key, {
        templateId: entry.templateId.trim(),
        fields: record(entry.fields) ? entry.fields as Record<string, string> : {},
      }]]
    })) as Partial<Record<NotificationTemplateKey, TemplateEntry>>
  }
  catch {
    return {}
  }
}

export function activitySubscriptionAvailable() {
  return activityKeys.some(key => Boolean(templateConfig()[key]?.templateId))
}

function status(value: string): NotificationSubscriptionResult['status'] {
  if (value === 'accept') {
    return 'ACCEPTED'
  }
  if (value === 'ban') {
    return 'BANNED'
  }
  if (value === 'filter') {
    return 'FILTERED'
  }
  return 'REJECTED'
}

/**
 * Must only be called from a direct member gesture. One request accepts at most
 * five template IDs; normal activity templates are one-time subscriptions.
 */
export async function requestActivitySubscriptions(): Promise<NotificationSubscriptionResult[]> {
  const config = templateConfig()
  const entries = activityKeys
    .map(key => ({ key, templateId: config[key]?.templateId || '' }))
    .filter(item => item.templateId)
    .slice(0, 5)
  if (!entries.length) {
    throw new Error('活动提醒尚未完成配置')
  }
  const result = await wx.requestSubscribeMessage({
    tmplIds: entries.map(item => item.templateId),
  })
  return entries.map(item => ({
    templateKey: item.key,
    status: status(String((result as Record<string, unknown>)[item.templateId] || 'reject')),
  }))
}
