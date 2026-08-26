import fs from 'node:fs'
import path from 'node:path'

function normalizeAssetPath(filePath) {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//, '')
}

export function discoverSourceWebpAssets(root) {
  const sourceRoot = path.join(root, 'src')
  const assets = []

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
      }
      else if (entry.name.toLowerCase().endsWith('.webp')) {
        assets.push(normalizeAssetPath(path.relative(sourceRoot, absolutePath)))
      }
    }
  }

  walk(sourceRoot)
  return assets.sort()
}

export function analyzedWebpFiles(report) {
  if (!Array.isArray(report?.packages)) {
    throw new TypeError('Analyze report does not contain packages.')
  }

  return report.packages.flatMap((item) => {
    if (!Array.isArray(item?.files)) {
      return []
    }
    return item.files
      .filter(file => typeof file?.file === 'string' && file.file.toLowerCase().endsWith('.webp'))
      .map(file => ({
        file: normalizeAssetPath(file.file),
        size: Number(file.size) || 0,
      }))
  })
}

export function assertWebpAssetsAnalyzed(expectedAssets, report) {
  const analyzed = analyzedWebpFiles(report)
  const analyzedPaths = new Set(analyzed.map(item => item.file))
  const missing = expectedAssets
    .map(normalizeAssetPath)
    .filter(file => !analyzedPaths.has(file))

  if (missing.length) {
    throw new Error(`Analyze report omitted WebP assets: ${missing.join(', ')}`)
  }

  return {
    assetCount: analyzed.length,
    totalBytes: analyzed.reduce((sum, item) => sum + item.size, 0),
  }
}
