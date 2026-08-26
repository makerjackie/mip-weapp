import type {
  AssignableGameMember,
  AssignableGameMemberPage,
  GameTeam,
} from './types'
import { MipGameError } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_REF_PATTERN = /^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/
const CANDIDATE_KEY_PATTERN = /^gmk2\.[\w-]{43}$/
const MEMBER_CURSOR_PATTERN = /^gm2\.[\w-]{16}\.[\w-]{1,500}\.[\w-]{22}$/

function invalid(): never {
  throw new MipGameError('SERVICE_UNAVAILABLE', '赛季服务返回了无效响应', true)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid()
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    invalid()
  }
}

function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    invalid()
  }
  return value
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid()
  }
  return Number(value)
}

function uuid(value: unknown): string {
  const result = text(value, 36, true)
  if (!UUID_PATTERN.test(result)) {
    invalid()
  }
  return result
}

function parseHeadquartersLevel(value: unknown): GameTeam['headquartersLevel'] {
  const item = record(value)
  exact(item, ['number', 'label', 'minimumExperience', 'styleKey'])
  return {
    number: integer(item.number, 1, 8),
    label: text(item.label, 80, true),
    minimumExperience: integer(item.minimumExperience, 0),
    styleKey: text(item.styleKey, 32, true),
  }
}

export function parseGameTeam(
  value: unknown,
  expected: { seasonId?: string, teamId?: string } = {},
): GameTeam {
  const item = record(value)
  exact(item, [
    'id',
    'seasonId',
    'branchId',
    'branchName',
    'name',
    'summary',
    'status',
    'version',
    'memberCount',
    'memberLimit',
    'headquartersLevel',
  ])
  const branchId = text(item.branchId, 36)
  if (branchId && !UUID_PATTERN.test(branchId)) {
    invalid()
  }
  const status = text(item.status, 16, true)
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    invalid()
  }
  const memberLimit = integer(item.memberLimit, 1, 100)
  const memberCount = integer(item.memberCount, 0, memberLimit)
  const result: GameTeam = {
    id: uuid(item.id),
    seasonId: uuid(item.seasonId),
    branchId,
    branchName: text(item.branchName, 100),
    name: text(item.name, 100, true),
    summary: text(item.summary, 500),
    status,
    version: integer(item.version, 1),
    memberCount,
    memberLimit,
    headquartersLevel: parseHeadquartersLevel(item.headquartersLevel),
  }
  if ((expected.seasonId && result.seasonId !== expected.seasonId)
    || (expected.teamId && result.id !== expected.teamId)) {
    invalid()
  }
  return result
}

export function parseGameTeamPage(value: unknown, expectedSeasonId?: string): { items: GameTeam[] } {
  const page = record(value)
  exact(page, ['items'])
  if (!Array.isArray(page.items) || page.items.length > 500) {
    invalid()
  }
  const items = page.items.map(item => parseGameTeam(item, { seasonId: expectedSeasonId }))
  if (new Set(items.map(item => item.id)).size !== items.length) {
    invalid()
  }
  return { items }
}

function parseAssignableMember(value: unknown): AssignableGameMember {
  const item = record(value)
  exact(item, ['memberRef', 'candidateKey', 'nickname', 'branchName', 'teamId', 'teamName', 'role'])
  const memberRef = text(item.memberRef, 200, true)
  const candidateKey = text(item.candidateKey, 80, true)
  const teamId = text(item.teamId, 36)
  const teamName = text(item.teamName, 100)
  const role = text(item.role, 16)
  if (!PROFILE_REF_PATTERN.test(memberRef)
    || !CANDIDATE_KEY_PATTERN.test(candidateKey)
    || (teamId !== '' && !UUID_PATTERN.test(teamId))
    || !['', 'CAPTAIN', 'MEMBER'].includes(role)
    || (teamId === '' && (teamName !== '' || role !== ''))
    || (teamId !== '' && (!teamName.trim() || role === ''))) {
    invalid()
  }
  return {
    memberRef,
    candidateKey,
    nickname: text(item.nickname, 80, true),
    branchName: text(item.branchName, 100),
    teamId,
    teamName,
    role: role as AssignableGameMember['role'],
  }
}

export function parseAssignableGameMemberPage(value: unknown): AssignableGameMemberPage {
  const page = record(value)
  exact(page, ['items', 'hasMore', 'nextCursor', 'limit', 'maxTeamMembers'])
  if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean') {
    invalid()
  }
  const limit = integer(page.limit, 1, 100)
  const maxTeamMembers = integer(page.maxTeamMembers, 1, 100)
  const nextCursor = text(page.nextCursor, 600)
  const items = page.items.map(parseAssignableMember)
  if (items.length > limit
    || (page.hasMore && (items.length !== limit || !MEMBER_CURSOR_PATTERN.test(nextCursor)))
    || (!page.hasMore && nextCursor !== '')
    || new Set(items.map(item => item.candidateKey)).size !== items.length
    || new Set(items.map(item => item.memberRef)).size !== items.length) {
    invalid()
  }
  return { items, hasMore: page.hasMore, nextCursor, limit, maxTeamMembers }
}

export function parseTeamMemberReplacement(value: unknown, expectedTeamId?: string): {
  teamId: string
  memberCount: number
  version: number
} {
  const result = record(value)
  exact(result, ['teamId', 'memberCount', 'version'])
  const parsed = {
    teamId: uuid(result.teamId),
    memberCount: integer(result.memberCount, 0, 100),
    version: integer(result.version, 2),
  }
  if (expectedTeamId && parsed.teamId !== expectedTeamId) {
    invalid()
  }
  return parsed
}
