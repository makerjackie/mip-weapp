import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// 复刻微信开发者工具「上传时过滤无依赖文件」（project.config.json
// ignoreUploadUnusedFiles: true）的可观测后果：上传包按静态依赖分析保留文件，
// WXML {{}} 动态绑定探不到，仅以 js 字符串字面量存在的资产会被剔除出体验版/正式版
// （MIW-100 实证：card-bg-*.webp 工具预览正常、真机缺图露兜底色）。
//
// 本地守门近似：dist 内的图片资产必须在任一运行时文本（wxml/wxss/wxs/json）里被
// 静态引用过；js 字面量不计入资产引用——与线上过滤行为一致（js 引用只认 require）。
// miniprogram_npm 内资产不在本契约范围（npm 可达性由 build.mjs 的 prune 契约管理）。

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'])
const RUNTIME_TEXT_EXTENSIONS = new Set(['.wxml', '.wxss', '.wxs', '.json'])
const ASSET_PATH_PATTERN = /[^\s"'`()<>{},;]+\.(?:png|jpe?g|webp|gif|svg|ico)/gi

function walkFiles(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath]
  })
}

function toPackagePath(distRoot, absolutePath) {
  return `/${path.relative(distRoot, absolutePath).replaceAll(path.sep, '/')}`
}

/** 静态引用集合：wxml/wxss/wxs/json 文本里出现的资产路径（绝对形态 /x/y.ext）。 */
export function collectStaticAssetReferences(distRoot) {
  const references = new Set()
  for (const absolutePath of walkFiles(distRoot)) {
    if (!RUNTIME_TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      continue
    }
    const text = fs.readFileSync(absolutePath, 'utf8')
    const relativeDir = path.dirname(absolutePath)
    for (const match of text.matchAll(ASSET_PATH_PATTERN)) {
      const token = match[0].replace(/^\.\//, '')
      references.add(token.startsWith('/') ? token : toPackagePath(distRoot, path.resolve(relativeDir, token)))
    }
  }
  return references
}

/**
 * 返回会被上传过滤剔除的资产：
 * - stripped: 未静态引用且未命中 allowlist（致命）
 * - allowlisted: 未静态引用但命中 allowlist（已知、带理由，暂时放行）
 * allowlist 条目必须全部命中，防止清单腐化成永久豁免。
 */
export function findStrippedAssetCandidates(distRoot, allowlist = []) {
  const references = collectStaticAssetReferences(distRoot)
  const assets = walkFiles(distRoot)
    .filter(absolutePath => !toPackagePath(distRoot, absolutePath).startsWith('/miniprogram_npm/'))
    .filter(absolutePath => ASSET_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()))
    .map(absolutePath => toPackagePath(distRoot, absolutePath))
    .sort()

  const allowlistReasons = new Map()
  for (const entry of allowlist) {
    if (typeof entry?.path !== 'string' || typeof entry?.reason !== 'string' || !entry.reason.trim()) {
      throw new TypeError(`Allowlist entries need non-empty path and reason: ${JSON.stringify(entry)}`)
    }
    allowlistReasons.set(entry.path, entry.reason)
  }

  const stripped = []
  const allowlisted = []
  for (const asset of assets) {
    if (references.has(asset)) {
      continue
    }
    const reason = allowlistReasons.get(asset)
      ?? [...allowlistReasons.entries()].find(([pattern]) => pattern.endsWith('*') && asset.startsWith(pattern.slice(0, -1)))?.[1]
    if (reason) {
      allowlisted.push({ asset, reason })
    }
    else {
      stripped.push(asset)
    }
  }
  // stale = allowlist 条目不再命中任何「未被静态引用」的资产（资产已静态引用或已删除）。
  const unreferenced = assets.filter(asset => !references.has(asset))
  const stale = [...allowlistReasons.keys()].filter((pattern) => {
    return pattern.endsWith('*')
      ? !unreferenced.some(asset => asset.startsWith(pattern.slice(0, -1)))
      : !unreferenced.includes(pattern)
  })
  return { stripped, allowlisted, stale, assetCount: assets.length }
}

export function assertUploadAssetReachability(distRoot, options = {}) {
  const allowlistPath = options.allowlistPath
    ?? path.resolve(import.meta.dirname, '../../config/upload-asset-allowlist.json')
  const allowlist = fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    : []
  const summary = findStrippedAssetCandidates(distRoot, allowlist)

  const problems = []
  if (summary.stripped.length) {
    problems.push(`Assets referenced only via dynamic bindings (or not at all) and therefore stripped from trial/production uploads by ignoreUploadUnusedFiles — reference them statically in wxml/wxss or justify an allowlist entry:\n${summary.stripped.map(item => `  ${item}`).join('\n')}`)
  }
  if (summary.stale.length) {
    problems.push(`Stale upload-asset allowlist entries that no longer match any stripped asset (remove them):\n${summary.stale.map(item => `  ${item}`).join('\n')}`)
  }
  if (problems.length) {
    throw new Error(`Upload asset reachability contract failed.\n${problems.join('\n')}`)
  }
  if (options.verbose ?? process.stdout.isTTY) {
    for (const item of summary.allowlisted) {
      console.warn(`[upload-reachability] allowlisted (dynamic-only): ${item.asset} — ${item.reason}`)
    }
  }
  return summary
}
