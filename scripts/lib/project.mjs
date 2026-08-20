import fs from 'node:fs'
import path from 'node:path'

export const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function readEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((result, line) => {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
    if (match) {
      result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return result
  }, {})
}

export function getProject() {
  const config = readJson(path.join(repositoryRoot, 'config/project.json'))
  return {
    root: repositoryRoot,
    slug: config.slug,
    name: config.name,
    namespace: config.namespace,
    routes: config.routes,
  }
}
