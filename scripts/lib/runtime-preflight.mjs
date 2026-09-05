import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import {
  detectWechatDevtoolsServicePort,
  execute,
  resolveCliPath,
  setRuntimeWechatDevtoolsServicePort,
} from 'weapp-ide-cli'

const appIdPattern = /^wx[0-9a-f]{16}$/i
const defaultRequiredRoutes = ['pages/index/index']
const settingsStorageHash = createHash('md5').update('reduxPersist:settings').digest('hex')
const settingsStorageFileNames = [
  `localstorage_${settingsStorageHash}.json`,
  `ls_${settingsStorageHash}.json`,
]

export const RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR
  = 'WeChat DevTools service port is configured but not listening. '
    + 'Enable 设置 → 安全设置 → 服务端口 in the currently open DevTools instance.'

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function appRoutes(appConfig) {
  const mainRoutes = appConfig?.pages || []
  const packageRoutes = (appConfig?.subPackages || appConfig?.subpackages || [])
    .flatMap(subpackage => (subpackage.pages || [])
      .map(page => `${String(subpackage.root || '').replace(/\/$/, '')}/${String(page).replace(/^\//, '')}`))
  return [...mainRoutes, ...packageRoutes]
}

function validPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535
}

export function listDevtoolsSecurityPortCandidates(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') {
    return []
  }
  const homeDir = options.homeDir || os.homedir()
  const baseDir = path.join(homeDir, 'Library', 'Application Support', '微信开发者工具')
  if (!fs.existsSync(baseDir)) {
    return []
  }

  const instanceDirs = [baseDir, ...fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(baseDir, entry.name))]
  const ports = new Set()
  for (const instanceDir of instanceDirs) {
    const localDataDir = path.join(instanceDir, 'WeappLocalData')
    for (const fileName of settingsStorageFileNames) {
      const settings = readJson(path.join(localDataDir, fileName))
      const security = settings?.security
      if (security?.enableServicePort === true && validPort(security.port)) {
        ports.add(security.port)
      }
    }
  }
  return [...ports]
}

export async function isTcpPortListening(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}

export async function selectListeningServicePort(candidates, probe = isTcpPortListening) {
  for (const port of [...new Set(candidates.filter(validPort))]) {
    if (await probe(port)) {
      return port
    }
  }
  return undefined
}

export function inspectRuntimeConfiguration(privateConfig, appConfig, options = {}) {
  const requiredRoutes = options.requiredRoutes || defaultRequiredRoutes
  const availableAppRoutes = appRoutes(appConfig)
  const conditionRoutes = privateConfig?.condition?.miniprogram?.list
    ?.map(item => item.pathName)
    .filter(Boolean) || []
  const missingAppRoutes = requiredRoutes.filter(route => !availableAppRoutes.includes(route))
  const missingConditionRoutes = requiredRoutes.filter(route => !conditionRoutes.includes(route))

  return {
    hasPrivateConfig: Boolean(privateConfig),
    hasRealAppId: appIdPattern.test(privateConfig?.appid || ''),
    compileHotReload: privateConfig?.setting?.compileHotReLoad === true,
    appRoutesComplete: missingAppRoutes.length === 0,
    conditionRoutesComplete: missingConditionRoutes.length === 0,
    missingAppRoutes,
    missingConditionRoutes,
  }
}

export function inspectRuntimeFiles(root, options = {}) {
  const sourceRoot = options.sourceRoot || 'src'
  const privateConfigPath = options.privateConfigPath || path.join(root, 'project.private.config.json')
  const publicConfigPath = options.publicConfigPath || path.join(root, 'project.config.json')
  const appConfigPath = options.appConfigPath || path.join(root, sourceRoot, 'app.json')
  const result = inspectRuntimeConfiguration(
    readJson(privateConfigPath),
    readJson(appConfigPath),
    options,
  )
  const publicConfig = readJson(publicConfigPath)
  return {
    ...result,
    hasPublicRealAppId: appIdPattern.test(publicConfig?.appid || ''),
    publicPrivateAppIdMatch: publicConfig?.appid === readJson(privateConfigPath)?.appid,
  }
}

export async function assertRuntimePreflight(root, options = {}) {
  const files = inspectRuntimeFiles(root, options)
  if (!files.hasPrivateConfig || !files.hasRealAppId) {
    throw new Error('Runtime requires a valid project.private.config.json. Run pnpm setup:local first.')
  }
  if (!files.appRoutesComplete || !files.conditionRoutesComplete) {
    const details = [
      files.missingAppRoutes.length > 0 ? `app.json missing: ${files.missingAppRoutes.join(', ')}` : '',
      files.missingConditionRoutes.length > 0 ? `DevTools conditions missing: ${files.missingConditionRoutes.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    throw new Error(`Runtime routes or DevTools conditions are incomplete (${details}). Run pnpm setup:local again.`)
  }
  if (options.requirePublicAppId === true
    && (!files.hasPublicRealAppId || !files.publicPrivateAppIdMatch)) {
    throw new Error(
      'Runtime DevTools host is missing its local AppID. Rebuild the isolated local host before automation.',
    )
  }

  const detectedServicePort = await detectWechatDevtoolsServicePort()
  const configuredPorts = [
    detectedServicePort.servicePort,
    ...listDevtoolsSecurityPortCandidates(),
  ]
  if (detectedServicePort.servicePortEnabled !== true && configuredPorts.length === 0) {
    throw new Error('WeChat DevTools service port is disabled. Enable 设置 → 安全设置 → 服务端口.')
  }
  const listeningServicePort = await selectListeningServicePort(configuredPorts)
  if (!listeningServicePort) {
    throw new Error(RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR)
  }
  setRuntimeWechatDevtoolsServicePort(listeningServicePort)

  try {
    const { cliPath } = await resolveCliPath()
    if (!cliPath) {
      throw new Error('WeChat DevTools CLI is unavailable')
    }
    const result = await execute(cliPath, ['islogin'], {
      pipeStdout: false,
      pipeStderr: false,
      timeout: 10000,
    })
    if (!parseDevtoolsLoginResult(`${result.stdout || ''}\n${result.stderr || ''}`)) {
      throw new Error('WeChat DevTools did not confirm login')
    }
  }
  catch {
    throw new Error('WeChat DevTools login is invalid. Re-open DevTools and scan the login QR code.')
  }

  return {
    ...files,
    devtoolsLoggedIn: true,
    servicePortEnabled: true,
    servicePort: listeningServicePort,
  }
}

export function parseDevtoolsLoginResult(output) {
  const text = stripVTControlCharacters(String(output))
  const values = [...text.matchAll(/["']?login["']?\s*:\s*(true|false)\b/g)].map(match => match[1])
  return values.length > 0 && values.every(value => value === 'true')
}
