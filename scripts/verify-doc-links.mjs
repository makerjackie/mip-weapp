#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { MIP_CORE_FUNCTION_ROLES } from './lib/mip-function-manifest.mjs'

const root = path.resolve(import.meta.dirname, '..')

function markdownFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`Unable to list documentation files: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter(source => fs.existsSync(path.join(root, source)))
}

const failures = []
const sources = markdownFiles()
for (const source of sources) {
  const markdown = fs.readFileSync(path.join(root, source), 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '')
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) {
      continue
    }
    target = target.split('#', 1)[0].split('?', 1)[0]
    try {
      target = decodeURIComponent(target)
    }
    catch {
      failures.push(`${source}: invalid URL encoding in ${match[1]}`)
      continue
    }
    const resolved = path.resolve(path.dirname(path.join(root, source)), target)
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
      failures.push(`${source}: missing ${match[1]}`)
    }
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

const runtimePages = readJson('config/runtime-pages.json')
const migrationLock = readJson('database/mysql/mip/migrations.lock.json')
const operationContract = readJson('src/modules/mip-admin/generated/admin-operation-contract.json')
const status = fs.readFileSync(path.join(root, 'docs/mip/PROJECT_STATUS.md'), 'utf8')
const tableCount = new Set(migrationLock.migrations.flatMap(migration => migration.createsTables || [])).size
const queryCount = operationContract.operations.filter(operation => operation.kind === 'QUERY').length
const mutationCount = operationContract.operations.filter(operation => operation.kind === 'MUTATION').length
const mainRouteCount = runtimePages.routes.filter(route => !route.path.startsWith('packages/')).length
const memberRouteCount = runtimePages.routes.filter(route => route.path.startsWith('packages/member/')).length
const adminRouteCount = runtimePages.routes.filter(route => route.path.startsWith('packages/admin/')).length
const cloudFunctionCount = fs.readdirSync(path.join(root, 'cloudfunctions'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('mip-'))
  .length

const repositoryFacts = [
  [`${runtimePages.routeCount} 条小程序路由`, new RegExp(`${runtimePages.routeCount}\\s*条小程序路由`)],
  [`${mainRouteCount} 条主包`, new RegExp(`${mainRouteCount}\\s*条主包`)],
  [`${memberRouteCount} 条用户分包`, new RegExp(`${memberRouteCount}\\s*条用户分包`)],
  [`${adminRouteCount} 条管理分包`, new RegExp(`${adminRouteCount}\\s*条管理分包`)],
  [`${migrationLock.migrations.length} 个迁移`, new RegExp(`${migrationLock.migrations.length}\\s*个(?:锁定|追加)迁移`)],
  [`${tableCount} 张 runtime 表`, new RegExp(`${tableCount}\\s*张\\s*runtime\\s*表`)],
  [`${operationContract.operationCount} 个管理 operation`, new RegExp(`${operationContract.operationCount}\\s*个(?:渠道中立管理\\s*)?operation`)],
  [`${queryCount} 查询`, new RegExp(`${queryCount}\\s*查询`)],
  [`${mutationCount} 写`, new RegExp(`${mutationCount}\\s*写`)],
  [`${cloudFunctionCount} 个 mip-* 函数目录`, new RegExp(`${cloudFunctionCount}\\s*个\\s*\\x60mip-\\*\\x60\\s*函数目录`)],
  [`${MIP_CORE_FUNCTION_ROLES.length} 个核心函数`, new RegExp(`核心部署清单为\\s*${MIP_CORE_FUNCTION_ROLES.length}\\s*个函数`)],
]

if (runtimePages.routeCount !== runtimePages.routes.length) {
  failures.push(`config/runtime-pages.json: routeCount ${runtimePages.routeCount} does not match ${runtimePages.routes.length} routes`)
}
if (operationContract.operationCount !== operationContract.operations.length) {
  failures.push(`admin operation contract: operationCount ${operationContract.operationCount} does not match ${operationContract.operations.length} operations`)
}
for (const [label, pattern] of repositoryFacts) {
  if (!pattern.test(status)) {
    failures.push(`docs/mip/PROJECT_STATUS.md: missing current repository fact ${label}`)
  }
}

const stableDocs = [
  'README.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/CLOUDBASE.md',
  'docs/DATABASE.md',
  'docs/DEPLOYMENT.md',
  'docs/OPERATIONS.md',
  'docs/mip/README.md',
  'docs/mip/ARCHITECTURE.md',
  'docs/mip/ACCEPTANCE.md',
  'docs/mip/COVERAGE_MATRIX.md',
]
const authorityOnlyPatterns = [
  /\d+\s*条小程序路由/g,
  /\d+\s*个(?:锁定|追加|已应用)迁移/g,
  /\d+\s*张\s*(?:MIP\s*)?(?:runtime\s*)?表/g,
  /\d+\s*个(?:渠道中立管理\s*)?operation/g,
]
for (const source of stableDocs) {
  const markdown = fs.readFileSync(path.join(root, source), 'utf8')
  for (const pattern of authorityOnlyPatterns) {
    const matches = markdown.match(pattern) || []
    for (const match of matches) {
      failures.push(`${source}: dynamic repository fact must be maintained only in docs/mip/PROJECT_STATUS.md: ${match}`)
    }
  }
}

const semanticSources = sources.filter(source => !/^docs\/(?:mip\/(?:evidence|sources)|research)\//.test(source))
const staleTerms = [
  'MEMBERSHIP_PAYMENT_MODE',
  'membership-notification-every-5m',
  '未来独立后台',
  '当前管理端仍在小程序管理分包',
]
for (const source of semanticSources) {
  const markdown = fs.readFileSync(path.join(root, source), 'utf8')
  for (const term of staleTerms) {
    if (markdown.includes(term)) {
      failures.push(`${source}: stale documentation term ${term}`)
    }
  }
}

if (failures.length) {
  throw new Error(`Documentation contract failed:\n${failures.join('\n')}`)
}
console.log('Documentation links and repository facts passed')
