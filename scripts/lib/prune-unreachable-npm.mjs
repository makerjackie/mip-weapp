import fs from 'node:fs'
import path from 'node:path'
import { collectReachableNpmFiles } from './package-size-contract.mjs'

// 嵌套依赖树（miniprogram_npm/<vendor>/miniprogram_npm/**）按微信 npm 语义是 vendor 包
// 自带的依赖闭包，collectReachableNpmFiles 的裸 require 解析只查主包顶层、探不到它，
// 因此整棵保全——2026-10-13 主包缺嵌套 tslib 致全部 TDesign 内联渲染（MIW-79）即此教训。
const NESTED_NPM_PATTERN = /(^|\/)miniprogram_npm\/[^/]+\/miniprogram_npm\//

function collectFiles(root) {
  if (!fs.existsSync(root)) {
    return []
  }
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name)
    return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath]
  })
}

function removeEmptyDirs(root) {
  if (!fs.existsSync(root)) {
    return
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(root, entry.name))
    }
  }
  if (fs.readdirSync(root).length === 0) {
    fs.rmdirSync(root)
  }
}

/**
 * 删除 miniprogram_npm 里可达性分析探不到的文件（未使用 vendor 组件等），
 * 返回 { removedFiles, bytesSaved }。嵌套依赖树整棵保留，见 NESTED_NPM_PATTERN。
 */
export function pruneUnreachableNpmFiles(distRoot) {
  const npmRoot = path.join(distRoot, 'miniprogram_npm')
  if (!fs.existsSync(npmRoot)) {
    return { removedFiles: [], bytesSaved: 0 }
  }
  const reachable = collectReachableNpmFiles(distRoot)
  const removedFiles = []
  let bytesSaved = 0
  for (const absolutePath of collectFiles(npmRoot)) {
    const relativePath = path.relative(distRoot, absolutePath).replaceAll(path.sep, '/')
    if (reachable.has(relativePath) || NESTED_NPM_PATTERN.test(relativePath)) {
      continue
    }
    bytesSaved += fs.statSync(absolutePath).size
    fs.rmSync(absolutePath, { force: true })
    removedFiles.push(relativePath)
  }
  removeEmptyDirs(npmRoot)
  return { removedFiles, bytesSaved }
}

/**
 * MIW-79 守门：npm 缓存命中会跳过 emit、build.mjs 的 fallback 只兜顶层目录，
 * 嵌套依赖树缺失时全部 TDesign 组件内联渲染，且主包因缺内容「恰好合规」地
 * 通过体积门。构建必须在这里失败，而不是把坏 dist 发出去。
 */
export function assertNestedVendorTreePresent(distRoot) {
  const nestedRoot = path.join(distRoot, 'miniprogram_npm', 'tdesign-miniprogram', 'miniprogram_npm')
  const entries = fs.existsSync(nestedRoot) ? fs.readdirSync(nestedRoot) : []
  if (entries.length === 0) {
    throw new Error(
      '构建产物缺嵌套 vendor 依赖树（miniprogram_npm/tdesign-miniprogram/miniprogram_npm/），'
      + '全部 TDesign 组件会内联渲染。npm 缓存可能跳过了 emit：'
      + '先删除 node_modules/weapp-vite/.cache 再重新构建（MIW-79）。',
    )
  }
}
