import type { AdminOperationAction, AdminRequestInput } from '../domain/contracts'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_EXPORT_BYTES = 10 * 1024 * 1024
const ticketPattern = /^[\w-]{1,36}$/
const tokenPattern = /^[\w-]{32,96}$/
const fileNamePattern = /^mip-[a-z-]+-[0-9TZ]+\.xlsx$/
const sha256Pattern = /^[a-f0-9]{64}$/
const terminalStatuses = new Set(['CONSUMED', 'EXPIRED', 'REVOKED', 'FAILED'])

export type SensitiveExportKind = 'users' | 'orders'
export type SensitiveExportProgress = 'creating' | 'preparing' | 'checking' | 'downloading' | 'completing' | 'saving'
export type SensitiveExportRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

export interface SensitiveExportInput {
  kind: SensitiveExportKind
  filters: { query?: string; status?: string }
  includesPhone?: boolean
}

export interface SensitiveExportResult {
  ticketId: string
  fileName: string
  rowCount: number
}

interface ExportTicket {
  ticketId: string
  token: string
  expiresAt: string
}

interface ExportStatus {
  status: 'PENDING' | 'READY' | 'RESERVED' | 'CONSUMED' | 'EXPIRED' | 'REVOKED' | 'FAILED'
  rowCount: number | null
  expiresAt: string
  fileName: string
  failureCode: string | null
  retryAfterMs?: number
}

interface ExportReservation {
  tempUrl: string
  fileName: string
  contentBytes: number
  contentSha256: string
  reservationExpiresAt: string
}

export interface SensitiveExportWorkflow {
  readonly input: SensitiveExportInput
  ticket: ExportTicket | null
  status: ExportStatus | null
  reservation: ExportReservation | null
  fileBytes: Uint8Array<ArrayBuffer> | null
  completed: boolean
  saved: boolean
  keys: {
    create: string
    prepare: string
    reserve: string
    complete: string
  }
}

interface SensitiveExportRuntime {
  fetch?: typeof fetch
  crypto?: Crypto
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  save?: (fileName: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>
  onProgress?: (progress: SensitiveExportProgress) => void
  maxStatusChecks?: number
  createKey?: (step: keyof SensitiveExportWorkflow['keys']) => string
}

export class SensitiveExportError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'SensitiveExportError'
    this.code = code
    this.retryable = retryable
  }
}

export function createSensitiveExportWorkflow(
  input: SensitiveExportInput,
  createKey: (step: keyof SensitiveExportWorkflow['keys']) => string = exportKey,
): SensitiveExportWorkflow {
  const normalized = normalizeInput(input)
  return {
    input: normalized,
    ticket: null,
    status: null,
    reservation: null,
    fileBytes: null,
    completed: false,
    saved: false,
    keys: {
      create: createKey('create'),
      prepare: createKey('prepare'),
      reserve: createKey('reserve'),
      complete: createKey('complete'),
    },
  }
}

export async function continueSensitiveExport(
  workflow: SensitiveExportWorkflow,
  request: SensitiveExportRequest,
  runtime: SensitiveExportRuntime = {},
): Promise<SensitiveExportResult> {
  const now = runtime.now || Date.now
  const createKey = runtime.createKey || exportKey
  const save = runtime.save || saveBrowserFile

  if (!workflow.ticket) {
    runtime.onProgress?.('creating')
    workflow.ticket = parseTicket(await request('mip.admin.exports.create', {
      exportType: workflow.input.kind === 'users' ? 'USERS' : 'ORDERS',
      includesPhone: workflow.input.kind === 'users' && workflow.input.includesPhone === true,
      filters: compactFilters(workflow.input.filters),
      idempotencyKey: workflow.keys.create,
    }))
  }
  assertNotExpired(workflow.ticket.expiresAt, now())

  if (!workflow.status || workflow.status.status !== 'READY') {
    runtime.onProgress?.('preparing')
    const prepared = parseStatus(await request('mip.admin.exports.prepare', {
      ticketId: workflow.ticket.ticketId,
      token: workflow.ticket.token,
      idempotencyKey: workflow.keys.prepare,
    }))
    workflow.status = prepared.status === 'PENDING'
      ? await waitUntilReady(workflow, prepared, request, runtime)
      : prepared
    if (workflow.status.status !== 'READY') throw statusError(workflow.status)
  }

  if (workflow.reservation && Date.parse(workflow.reservation.reservationExpiresAt) <= now()) {
    workflow.reservation = null
    workflow.keys.reserve = createKey('reserve')
  }
  if (!workflow.reservation) {
    runtime.onProgress?.('downloading')
    workflow.reservation = parseReservation(await request('mip.admin.exports.reserve', {
      ticketId: workflow.ticket.ticketId,
      token: workflow.ticket.token,
      idempotencyKey: workflow.keys.reserve,
    }))
  }

  if (!workflow.fileBytes) {
    runtime.onProgress?.('downloading')
    workflow.fileBytes = await fetchVerifiedExport(workflow.reservation, runtime)
  }

  if (!workflow.completed) {
    runtime.onProgress?.('completing')
    try {
      parseCompletion(await request('mip.admin.exports.complete', {
        ticketId: workflow.ticket.ticketId,
        token: workflow.ticket.token,
        idempotencyKey: workflow.keys.complete,
      }))
    }
    catch (error) {
      if (errorCode(error) !== 'EXPORT_CONSUMED') throw error
    }
    workflow.completed = true
  }

  runtime.onProgress?.('saving')
  await save(workflow.reservation.fileName, workflow.fileBytes)
  workflow.saved = true
  const result = {
    ticketId: workflow.ticket.ticketId,
    fileName: workflow.reservation.fileName,
    rowCount: workflow.status.rowCount || 0,
  }
  disposeSensitiveExportSecrets(workflow)
  return result
}

export function disposeSensitiveExportSecrets(workflow: SensitiveExportWorkflow) {
  if (workflow.ticket) workflow.ticket.token = ''
  workflow.fileBytes?.fill(0)
  workflow.fileBytes = null
  workflow.reservation = null
}

async function waitUntilReady(
  workflow: SensitiveExportWorkflow,
  initial: ExportStatus,
  request: SensitiveExportRequest,
  runtime: SensitiveExportRuntime,
) {
  let status = initial
  const wait = runtime.wait || (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
  const checks = Math.max(1, Math.min(runtime.maxStatusChecks ?? 8, 20))
  for (let attempt = 0; attempt < checks && status.status === 'PENDING'; attempt += 1) {
    runtime.onProgress?.('checking')
    await wait(Math.max(300, Math.min(status.retryAfterMs || 500, 2_000)))
    status = parseStatus(await request('mip.admin.exports.status', {
      ticketId: workflow.ticket!.ticketId,
      token: workflow.ticket!.token,
    }))
  }
  if (status.status === 'PENDING') {
    workflow.keys.prepare = (runtime.createKey || exportKey)('prepare')
    throw new SensitiveExportError('EXPORT_NOT_READY', '导出文件尚未就绪，请稍后继续', true)
  }
  return status
}

async function fetchVerifiedExport(reservation: ExportReservation, runtime: SensitiveExportRuntime) {
  const fetchImpl = runtime.fetch || globalThis.fetch
  const cryptoApi = runtime.crypto || globalThis.crypto
  if (typeof fetchImpl !== 'function' || !cryptoApi?.subtle) {
    throw new SensitiveExportError('EXPORT_DOWNLOAD_UNAVAILABLE', '当前浏览器无法安全下载导出文件')
  }
  const source = httpsUrl(reservation.tempUrl)
  if (Date.parse(reservation.reservationExpiresAt) <= (runtime.now || Date.now)()) {
    throw new SensitiveExportError('EXPORT_URL_EXPIRED', '导出下载地址已过期', true)
  }
  let response: Response
  try {
    response = await fetchImpl(source, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  }
  catch {
    throw new SensitiveExportError('EXPORT_DOWNLOAD_FAILED', '导出文件下载失败', true)
  }
  if (!response.ok || (response.url && new URL(response.url).protocol !== 'https:')) {
    throw new SensitiveExportError('EXPORT_DOWNLOAD_FAILED', '导出文件下载失败', true)
  }
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength && declaredLength !== reservation.contentBytes) {
    throw new SensitiveExportError('EXPORT_INTEGRITY_FAILED', '导出文件校验失败')
  }
  const bytes = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>
  if (bytes.byteLength !== reservation.contentBytes
    || bytes.byteLength < 4
    || bytes.byteLength > MAX_EXPORT_BYTES
    || bytes[0] !== 0x50
    || bytes[1] !== 0x4b
    || bytes[2] !== 0x03
    || bytes[3] !== 0x04) {
    bytes.fill(0)
    throw new SensitiveExportError('EXPORT_INTEGRITY_FAILED', '导出文件校验失败')
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  const actualHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (actualHash !== reservation.contentSha256) {
    bytes.fill(0)
    throw new SensitiveExportError('EXPORT_INTEGRITY_FAILED', '导出文件校验失败')
  }
  return bytes
}

async function saveBrowserFile(fileName: string, bytes: Uint8Array<ArrayBuffer>) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new SensitiveExportError('EXPORT_SAVE_UNAVAILABLE', '当前浏览器无法保存导出文件')
  }
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: XLSX_CONTENT_TYPE }))
  try {
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = fileName
    link.rel = 'noopener noreferrer'
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
  }
  finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function parseTicket(value: unknown): ExportTicket {
  const item = record(value)
  if (!ticketPattern.test(String(item.ticketId || ''))
    || !tokenPattern.test(String(item.token || ''))
    || item.status !== 'PENDING'
    || !validDate(item.expiresAt)) invalidResponse()
  return { ticketId: String(item.ticketId), token: String(item.token), expiresAt: String(item.expiresAt) }
}

function parseStatus(value: unknown): ExportStatus {
  const item = record(value)
  const status = String(item.status || '')
  if (!['PENDING', 'READY', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REVOKED', 'FAILED'].includes(status)
    || !(item.rowCount === null || (Number.isInteger(item.rowCount) && Number(item.rowCount) >= 0))
    || !validDate(item.expiresAt)
    || !fileNamePattern.test(String(item.fileName || ''))
    || !(item.failureCode === null || typeof item.failureCode === 'string')
    || (item.retryAfterMs !== undefined && (!Number.isInteger(item.retryAfterMs) || Number(item.retryAfterMs) < 0))) invalidResponse()
  return item as unknown as ExportStatus
}

function parseReservation(value: unknown): ExportReservation {
  const item = record(value)
  if (item.status !== 'RESERVED'
    || !fileNamePattern.test(String(item.fileName || ''))
    || item.contentType !== XLSX_CONTENT_TYPE
    || !Number.isInteger(item.contentBytes)
    || Number(item.contentBytes) <= 0
    || Number(item.contentBytes) > MAX_EXPORT_BYTES
    || !sha256Pattern.test(String(item.contentSha256 || ''))
    || !validDate(item.reservationExpiresAt)
    || Object.hasOwn(item, 'objectKey')
    || Object.hasOwn(item, 'fileId')) invalidResponse()
  return {
    tempUrl: httpsUrl(item.tempUrl),
    fileName: String(item.fileName),
    contentBytes: Number(item.contentBytes),
    contentSha256: String(item.contentSha256),
    reservationExpiresAt: String(item.reservationExpiresAt),
  }
}

function parseCompletion(value: unknown) {
  const item = record(value)
  if (item.status !== 'CONSUMED' || !validDate(item.consumedAt)) invalidResponse()
}

function normalizeInput(value: SensitiveExportInput): SensitiveExportInput {
  if (!value || !['users', 'orders'].includes(value.kind)) {
    throw new SensitiveExportError('VALIDATION_FAILED', '导出类型无效')
  }
  const query = textFilter(value.filters?.query, 80)
  const status = textFilter(value.filters?.status, 40)
  return {
    kind: value.kind,
    filters: { ...(query ? { query } : {}), ...(status ? { status } : {}) },
    includesPhone: value.kind === 'users' && value.includesPhone === true,
  }
}

function compactFilters(filters: SensitiveExportInput['filters']) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value)))
}

function textFilter(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new SensitiveExportError('VALIDATION_FAILED', '导出筛选条件无效')
  }
  return value.trim()
}

function assertNotExpired(value: string, now: number) {
  if (Date.parse(value) <= now) throw new SensitiveExportError('EXPORT_EXPIRED', '导出任务已过期')
}

function statusError(status: ExportStatus) {
  if (status.status === 'CONSUMED') return new SensitiveExportError('EXPORT_CONSUMED', '导出文件已下载')
  if (status.status === 'EXPIRED') return new SensitiveExportError('EXPORT_EXPIRED', '导出任务已过期')
  if (status.status === 'REVOKED') return new SensitiveExportError('EXPORT_INTEGRITY_FAILED', '导出文件不可用')
  if (status.status === 'FAILED') return new SensitiveExportError(status.failureCode || 'EXPORT_FAILED', '导出任务处理失败')
  if (terminalStatuses.has(status.status)) return new SensitiveExportError('EXPORT_FAILED', '导出任务处理失败')
  return new SensitiveExportError('EXPORT_NOT_READY', '导出文件尚未就绪', true)
}

function httpsUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('INVALID')
    return parsed.toString()
  }
  catch {
    throw new SensitiveExportError('INVALID_RESPONSE', '运营服务返回了无效的导出下载信息')
  }
}

function exportKey(step: keyof SensitiveExportWorkflow['keys']) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `web-export-${step}-${random}`.slice(0, 128)
}

function validDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function invalidResponse(): never {
  throw new SensitiveExportError('INVALID_RESPONSE', '运营服务返回了无效的导出状态')
}

function errorCode(value: unknown) {
  return value && typeof value === 'object' && 'code' in value ? String(value.code || '') : ''
}
