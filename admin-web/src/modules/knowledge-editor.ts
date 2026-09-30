import type { OperationValues } from './admin-operation-ui'

export function knowledgeEditorValues(value: Record<string, unknown>): OperationValues {
  if (typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !value.category || typeof value.category !== 'object' || !('id' in value.category) || typeof value.category.id !== 'string') {
    throw new Error('知识内容缺少对象、分类或版本，请刷新后重试')
  }
  const source = value.source && typeof value.source === 'object' && 'id' in value.source ? value.source.id : ''
  const output: OperationValues = { contentId: value.id, categoryId: value.category.id, sourceId: source || '', expectedVersion: value.version,
    _canSave: value.editable !== false && value.status !== 'PUBLISHED' }
  for (const key of ['contentType', 'title', 'summary', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName', 'accessType', 'commentsEnabled', 'moderationMode']) output[key] = value[key] ?? (key === 'commentsEnabled' ? true : '')
  return output
}
