import type { OperationField, OperationValues } from './admin-operation-ui.ts'
import { record } from './admin-read-formatters.ts'

/** Existing ownership and content kind are immutable server facts. */
export function userContentEditorFields(fields: readonly OperationField[], editing: boolean): readonly OperationField[] {
  return fields.map(field => ({ ...field,
    ...(field.fields ? { fields: userContentEditorFields(field.fields, editing) } : {}),
    ...(['contentId', 'expectedVersion'].includes(String(field.key)) ? { hidden: true } : {}),
    ...(field.key === 'ownerUserId' ? { remoteUserSearch: true } : {}),
    ...(editing && ['kind', 'ownerUserId'].includes(String(field.key)) ? { readOnly: true, readOnlyReason: '已有内容的类型和归属不能修改' } : {}),
  }))
}

export function userContentEditorValues(payload: unknown): OperationValues {
  const item = record(payload), owner = record(item.owner)
  if (!['COOPERATION_CARD', 'SUPER_CASE'].includes(String(item.kind)) || typeof item.id !== 'string' || !item.id
    || !Number.isInteger(item.version) || Number(item.version) < 1 || typeof owner.userId !== 'string' || !owner.userId) {
    throw new Error('用户内容详情字段不完整，请重新加载。')
  }
  const keys = item.kind === 'COOPERATION_CARD'
    ? ['roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores', 'status']
    : ['projectName', 'summary', 'startedOn', 'endedOn', 'responsibility', 'cityTagId', 'industryTagId', 'caseType', 'description', 'coverAssetId', 'mediaAssetIds', 'status']
  return { kind: item.kind, contentId: item.id, ownerUserId: owner.userId, expectedVersion: item.version,
    draft: { kind: item.kind, ...Object.fromEntries(keys.map(key => [key, item[key]])) },
    _canSave: item.status !== 'ARCHIVED',
    _mediaUrls: Object.fromEntries([
      ...(item.coverAssetId && item.coverUrl ? [[String(item.coverAssetId), String(item.coverUrl)]] : []),
      ...(Array.isArray(item.media) ? item.media.map(record).filter(media => media.assetId && media.url).map(media => [String(media.assetId), String(media.url)]) : []),
    ]),
  }
}
