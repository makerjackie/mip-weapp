import { readFileSync } from 'node:fs'
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
import { flattenProfileIndustries, groupProfileIndustries } from '../src/modules/mip-identity'
import { activeEntitlement, userSummary } from './fixtures/mip'

describe('MIP domain foundation', () => {
  it('publishes the built app manifest only after referenced page files', () => {
    const buildScript = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8')
    const devtoolsHost = readFileSync(new URL('../scripts/lib/devtools-host.mjs', import.meta.url), 'utf8')
    const sync = buildScript.lastIndexOf('synchronizeDirectory(stagingDir, outputDir)')
    const manifest = buildScript.lastIndexOf('fs.copyFileSync(path.join(stagingDir, \'app.json\')')

    expect(sync).toBeGreaterThan(-1)
    expect(manifest).toBeGreaterThan(sync)
    expect(devtoolsHost).toContain('synchronizeDirectory(sourceDist, hostDist, { publishManifestLast: true })')
  })

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

  it('keeps the replaceable seed aligned with the two-level client catalog', () => {
    const seed = JSON.parse(readFileSync(
      new URL('../database/mysql/mip/seed.demo.json', import.meta.url),
      'utf8',
    )) as {
      version: string
      replaceBeforeProduction: boolean
      tags: Array<{
        id: string
        kind: 'CITY' | 'INDUSTRY' | 'ABILITY'
        parentId?: string
        key: string
        label: string
        selectable: boolean
        popular: boolean
      }>
    }
    const parents = seed.tags.filter(tag => tag.kind === 'INDUSTRY' && !tag.parentId)
    const industryGroups = parents.map(parent => ({
      key: parent.key,
      label: parent.label,
      selectable: parent.selectable,
      options: seed.tags
        .filter(tag => tag.kind === 'INDUSTRY' && tag.parentId === parent.id)
        .map(tag => ({ key: tag.key, label: tag.label, popular: tag.popular, selectable: tag.selectable })),
    }))

    expect(seed.replaceBeforeProduction).toBe(true)
    expect(seed.version).toBe(mipPlaceholderCatalog.version)
    expect(industryGroups.map(group => ({
      key: group.key,
      label: group.label,
      options: group.options.map(({ selectable: _selectable, ...option }) => option),
    }))).toEqual(mipPlaceholderCatalog.industryGroups.map(group => ({
      key: group.key,
      label: group.label,
      options: group.options.map(option => ({
        key: option.key,
        label: option.label,
        popular: option.popular === true,
      })),
    })))
    expect(industryGroups.every(group => !group.selectable)).toBe(true)
    expect(industryGroups.every(group => group.options.every(option => option.selectable))).toBe(true)
    expect(seed.tags
      .filter(tag => tag.kind === 'CITY')
      .map(({ key, label, popular }) => ({ key, label, popular })))
      .toEqual(mipPlaceholderCatalog.cityTags.map(tag => ({
        key: tag.key,
        label: tag.label,
        popular: tag.popular === true,
      })))
  })

  it('builds profile choices from second-level industries only', () => {
    const tags = [
      {
        id: 'group-1',
        kind: 'INDUSTRY' as const,
        key: 'internet_ai',
        label: '互联网与人工智能',
        selectable: false,
      },
      {
        id: 'industry-1',
        kind: 'INDUSTRY' as const,
        parentId: 'group-1',
        key: 'internet',
        label: '互联网',
        selectable: true,
      },
    ]
    expect(groupProfileIndustries(tags)).toHaveLength(1)
    expect(flattenProfileIndustries(tags)).toEqual([expect.objectContaining({
      id: 'industry-1',
      displayLabel: '互联网与人工智能 · 互联网',
    })])
  })
})
