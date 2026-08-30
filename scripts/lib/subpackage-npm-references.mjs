import fs from 'node:fs'
import path from 'node:path'

function walkJson(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory()
      ? walkJson(absolutePath)
      : (entry.name.endsWith('.json') ? [absolutePath] : [])
  })
}

function subPackages(appJson) {
  return Array.isArray(appJson.subPackages)
    ? appJson.subPackages
    : (Array.isArray(appJson.subpackages) ? appJson.subpackages : [])
}

export function normalizeSubpackageNpmComponentReferences(buildRoot, appJson) {
  const npmRoot = path.join(buildRoot, 'miniprogram_npm')
  let updatedFiles = 0
  let updatedReferences = 0

  for (const item of subPackages(appJson).filter(item => item?.independent !== true)) {
    for (const jsonPath of walkJson(path.join(buildRoot, item.root))) {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      const components = json.usingComponents
      if (!components || typeof components !== 'object') {
        continue
      }

      let changed = false
      for (const [name, reference] of Object.entries(components)) {
        if (typeof reference !== 'string' || !reference.startsWith('.')) {
          continue
        }
        const absoluteTarget = path.resolve(path.dirname(jsonPath), reference)
        if (!absoluteTarget.startsWith(`${npmRoot}${path.sep}`)) {
          continue
        }
        components[name] = `/${path.relative(buildRoot, absoluteTarget).replaceAll(path.sep, '/')}`
        changed = true
        updatedReferences += 1
      }

      if (changed) {
        fs.writeFileSync(jsonPath, JSON.stringify(json))
        updatedFiles += 1
      }
    }
  }

  return { updatedFiles, updatedReferences }
}
