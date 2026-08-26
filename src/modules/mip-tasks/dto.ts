import type { TaskCompletion, TaskPage, TaskTemplateMedia, UserTaskCard } from './types'
import { MipTasksError } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const USER_TASK_STATUSES = new Set(['AVAILABLE', 'COMPLETED', 'ENDED'])
const COMPLETION_RESULTS = new Set(['SUCCESS', 'FAILED'])
const IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png'])

function invalidResponse(): never {
  throw new MipTasksError('SERVICE_UNAVAILABLE', '任务服务返回了无效响应', true)
}

function record(value: unknown, allowed: string[], required: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidResponse()
  }
  const item = value as Record<string, unknown>
  const keys = Object.keys(item)
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(item, key))) {
    invalidResponse()
  }
  return item
}

function boundedString(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && value.length === 0)) {
    invalidResponse()
  }
  return value
}

function uuid(value: unknown): string {
  const result = boundedString(value, 36, true)
  if (!UUID_PATTERN.test(result)) {
    invalidResponse()
  }
  return result
}

function enumString(value: unknown, values: Set<string>): string {
  const result = boundedString(value, 32, true)
  if (!values.has(result)) {
    invalidResponse()
  }
  return result
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    invalidResponse()
  }
  return value
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalidResponse()
  }
  return Number(value)
}

function isoString(value: unknown, allowEmpty: boolean): string {
  const result = boundedString(value, 30, !allowEmpty)
  if (allowEmpty && result === '') {
    return result
  }
  const time = Date.parse(result)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) {
    invalidResponse()
  }
  return result
}

function parseCompletionSummary(value: unknown): NonNullable<UserTaskCard['completion']> {
  const item = record(value, ['id', 'completedAt', 'rewardExperience'], [
    'id',
    'completedAt',
    'rewardExperience',
  ])
  return {
    id: uuid(item.id),
    completedAt: isoString(item.completedAt, false),
    rewardExperience: safeInteger(item.rewardExperience, 0, 1_000_000),
  }
}

function parseTemplate(value: unknown): TaskTemplateMedia {
  const item = record(value, ['assetId', 'url', 'contentType', 'bytes'], [
    'assetId',
    'url',
    'contentType',
    'bytes',
  ])
  const contentType = enumString(item.contentType, IMAGE_CONTENT_TYPES)
  return {
    assetId: uuid(item.assetId),
    url: boundedString(item.url, 2048, true),
    contentType,
    bytes: safeInteger(item.bytes, 1, 10 * 1024 * 1024),
  }
}

function parseUserTaskCard(value: unknown, detail: boolean): UserTaskCard {
  const item = record(value, [
    'id',
    'name',
    'content',
    'rewardExperience',
    'attachmentRequired',
    'endsAt',
    'hasTemplate',
    'version',
    'status',
    'completion',
    'template',
  ], [
    'id',
    'name',
    'content',
    'rewardExperience',
    'attachmentRequired',
    'endsAt',
    'hasTemplate',
    'version',
    'status',
  ])
  const status = enumString(item.status, USER_TASK_STATUSES) as UserTaskCard['status']
  const hasTemplate = booleanValue(item.hasTemplate)
  const completion = item.completion === undefined ? undefined : parseCompletionSummary(item.completion)
  const template = item.template === undefined ? undefined : parseTemplate(item.template)
  if ((status === 'COMPLETED') !== Boolean(completion)
    || (!hasTemplate && template)
    || (detail && hasTemplate && !template)) {
    invalidResponse()
  }
  return {
    id: uuid(item.id),
    name: boundedString(item.name, 100, true),
    content: boundedString(item.content, 5000, true),
    rewardExperience: safeInteger(item.rewardExperience, 0, 1_000_000),
    attachmentRequired: booleanValue(item.attachmentRequired),
    endsAt: isoString(item.endsAt, true),
    hasTemplate,
    version: safeInteger(item.version, 1, Number.MAX_SAFE_INTEGER),
    status,
    ...(completion ? { completion } : {}),
    ...(template ? { template } : {}),
  }
}

export function parseUserTaskPage(value: unknown): TaskPage<UserTaskCard> {
  const page = record(value, ['items', 'nextCursor'], ['items'])
  if (!Array.isArray(page.items) || page.items.length > 50) {
    invalidResponse()
  }
  const items = page.items.map(item => parseUserTaskCard(item, false))
  if (new Set(items.map(item => item.id)).size !== items.length) {
    invalidResponse()
  }
  let nextCursor: string | undefined
  if (page.nextCursor !== undefined) {
    nextCursor = boundedString(page.nextCursor, 600, true)
    if (!nextCursor.startsWith('mtu1.') || items.length === 0) {
      invalidResponse()
    }
  }
  return { items, ...(nextCursor ? { nextCursor } : {}) }
}

export function parseUserTaskDetail(value: unknown): UserTaskCard {
  return parseUserTaskCard(value, true)
}

export function parseTaskCompletion(value: unknown): TaskCompletion {
  const item = record(value, [
    'id',
    'taskId',
    'taskName',
    'rewardExperience',
    'resultStatus',
    'completedAt',
    'alreadyCompleted',
    'balanceAfter',
  ], [
    'id',
    'taskId',
    'taskName',
    'rewardExperience',
    'resultStatus',
    'completedAt',
    'alreadyCompleted',
  ])
  const resultStatus = enumString(item.resultStatus, COMPLETION_RESULTS)
  const balanceAfter = item.balanceAfter === undefined || item.balanceAfter === null
    ? item.balanceAfter as undefined | null
    : safeInteger(item.balanceAfter, 0, Number.MAX_SAFE_INTEGER)
  return {
    id: uuid(item.id),
    taskId: uuid(item.taskId),
    taskName: boundedString(item.taskName, 100, true),
    rewardExperience: safeInteger(item.rewardExperience, 0, 1_000_000),
    resultStatus: resultStatus as TaskCompletion['resultStatus'],
    completedAt: isoString(item.completedAt, false),
    alreadyCompleted: booleanValue(item.alreadyCompleted),
    ...(item.balanceAfter !== undefined ? { balanceAfter } : {}),
  }
}
