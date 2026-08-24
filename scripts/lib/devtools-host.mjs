import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appIdPattern = /^wx[0-9a-f]{16}$/i

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function synchronizeDirectory(source, destination, { publishManifestLast = false } = {}) {
  fs.mkdirSync(destination, { recursive: true })
  const sourceEntries = new Set(fs.readdirSync(source))
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (publishManifestLast && entry.name === 'app.json') {
      continue
    }
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      synchronizeDirectory(sourcePath, destinationPath)
    }
    else {
      fs.copyFileSync(sourcePath, destinationPath)
    }
  }
  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (!sourceEntries.has(entry.name)) {
      fs.rmSync(path.join(destination, entry.name), {
        force: true,
        recursive: entry.isDirectory(),
      })
    }
  }
  if (publishManifestLast) {
    fs.copyFileSync(path.join(source, 'app.json'), path.join(destination, 'app.json'))
  }
}

/**
 * Keep the automation project outside the source checkout. WeChat DevTools can
 * collapse a nested project into an already-open parent workspace, which makes
 * `cli auto` attach to the wrong Mini Program and wait forever for App
 * readiness. The resolved source path makes hosts unique per case and worktree.
 */
export function resolveLocalDevtoolsHostRoot(
  sourceRoot,
  {
    temporaryRoot = path.join(os.homedir(), 'Library', 'Caches'),
  } = {},
) {
  if (!sourceRoot) {
    throw new Error('DevTools host resolution requires sourceRoot')
  }
  const resolvedSourceRoot = path.resolve(sourceRoot)
  const identity = createHash('sha256')
    .update(resolvedSourceRoot)
    .digest('hex')
    .slice(0, 16)
  return path.join(
    temporaryRoot,
    'mip-weapp-devtools',
    `${path.basename(resolvedSourceRoot)}-${identity}`,
  )
}

/**
 * Build an ignored DevTools project whose public config contains the local
 * AppID. WeChat DevTools CLI reads project.config.json before it consistently
 * applies project.private.config.json, so automation must never open the
 * tracked touristappid project directly.
 */
export function syncLocalDevtoolsHost({
  sourceRoot,
  hostRoot = resolveLocalDevtoolsHostRoot(sourceRoot),
  sourceDist = path.join(sourceRoot, 'dist'),
} = {}) {
  if (!sourceRoot) {
    throw new Error('DevTools host synchronization requires sourceRoot')
  }
  const sourceProjectConfig = path.join(sourceRoot, 'project.config.json')
  const sourcePrivateConfig = path.join(sourceRoot, 'project.private.config.json')
  const sourceAppConfig = path.join(sourceDist, 'app.json')
  for (const requiredPath of [sourceProjectConfig, sourcePrivateConfig, sourceAppConfig]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(
        requiredPath === sourceAppConfig
          ? 'Compiled app.json is missing. Run the production build before DevTools synchronization.'
          : 'Local DevTools configuration is incomplete. Run setup:local first.',
      )
    }
  }

  const publicConfig = readJson(sourceProjectConfig)
  const privateConfig = readJson(sourcePrivateConfig)
  if (!appIdPattern.test(privateConfig.appid || '')) {
    throw new Error('Local DevTools configuration does not contain a valid AppID')
  }

  const hostDist = path.join(hostRoot, 'dist')
  const hostCloudfunctions = path.join(hostRoot, 'cloudfunctions')
  fs.mkdirSync(hostRoot, { recursive: true })
  fs.mkdirSync(hostCloudfunctions, { recursive: true })
  fs.writeFileSync(path.join(hostRoot, 'project.config.json'), `${JSON.stringify({
    ...publicConfig,
    appid: privateConfig.appid,
    miniprogramRoot: 'dist/',
    srcMiniprogramRoot: 'dist/',
    cloudfunctionRoot: 'cloudfunctions/',
    projectname: privateConfig.projectname || publicConfig.projectname,
    setting: { ...publicConfig.setting, ...privateConfig.setting },
    condition: privateConfig.condition,
    libVersion: privateConfig.libVersion || publicConfig.libVersion,
  }, null, 2)}\n`)
  fs.writeFileSync(
    path.join(hostRoot, 'project.private.config.json'),
    `${JSON.stringify(privateConfig, null, 2)}\n`,
  )
  synchronizeDirectory(sourceDist, hostDist, { publishManifestLast: true })

  return {
    hostRoot,
    sourceRoot,
    compiledAppPresent: true,
    localIdentityPresent: true,
  }
}
