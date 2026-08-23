import { describe, expect, it } from 'vitest'
import {
  cooperationAbilityDimensions,
  cooperationRoles,
  mipPlaceholderCatalog,
} from '../src/config/mip-catalogs'
import {
  cooperationRoleKeys,
  isCooperationRoleKey,
  resolveUserKind,
} from '../src/modules/mip'
import { activeEntitlement, userSummary } from './fixtures/mip'

describe('MIP domain foundation', () => {
  it('derives player status only from an active entitlement window', () => {
    const entitlement = activeEntitlement()

    expect(resolveUserKind(entitlement, new Date('2026-08-24T00:00:00.000Z'))).toBe('PLAYER')
    expect(resolveUserKind({ ...entitlement, status: 'REFUNDED' }, new Date('2026-08-24T00:00:00.000Z')))
      .toBe('GUEST')
    expect(resolveUserKind(entitlement, new Date(entitlement.endsAt))).toBe('GUEST')
    expect(userSummary({ entitlement }).kind).toBe('PLAYER')
  })

  it('keeps one configurable definition for each cooperation role', () => {
    expect(cooperationRoles.map(role => role.key)).toEqual(cooperationRoleKeys)
    expect(new Set(cooperationRoles.map(role => role.key)).size).toBe(6)
    expect(cooperationRoles.every(role => role.fields.length >= 3)).toBe(true)
    expect(cooperationAbilityDimensions).toHaveLength(6)
    expect(isCooperationRoleKey('connector')).toBe(true)
    expect(isCooperationRoleKey('owner')).toBe(false)
  })

  it('marks fabricated city and industry catalogs for replacement', () => {
    expect(mipPlaceholderCatalog.replaceBeforeProduction).toBe(true)
    expect(mipPlaceholderCatalog.cityBranches.length).toBeGreaterThan(0)
    expect(mipPlaceholderCatalog.industryGroups.every(group => group.options.length > 0)).toBe(true)
  })
})
