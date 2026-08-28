import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loginWithCloudbaseManagementApiKey } from './cloudbase-management-auth.mjs'
import {
  callCloudbaseMcp,
  restartCloudbaseMcp,
} from './cloudbase-mcp-runner.mjs'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/
const STAGES = new Set(['development', 'test', 'staging', 'production'])

export function loadMipMediaMigrationEnvironment(filePath, expectedStage) {
  const absolute = path.resolve(String(filePath || ''))
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
    || stat.size > 1024 * 1024) {
    throw new Error('MIP_MEDIA_COPY_ENV_FILE_INVALID')
  }
  const values = parseDotEnv(fs.readFileSync(absolute, 'utf8'))
  const result = {
    appId: String(values.MINI_PROGRAM_APP_ID || ''),
    environmentId: String(values.CLOUDBASE_ENV_ID || ''),
    apiKey: String(values.CLOUDBASE_API_KEY || ''),
    mediaScopeSecret: String(values.MIP_MEDIA_SCOPE_SECRET || ''),
    stage: String(values.MIP_DEPLOYMENT_STAGE || '').toLowerCase(),
  }
  if (!APP_ID_PATTERN.test(result.appId)
    || !result.environmentId
    || result.apiKey.length < 20
    || result.mediaScopeSecret.length < 32
    || !STAGES.has(result.stage)
    || (expectedStage && result.stage !== expectedStage)) {
    throw new Error('MIP_MEDIA_COPY_ENV_CONFIGURATION_INVALID')
  }
  return Object.freeze({
    ...result,
    environmentFingerprint: sha256(result.environmentId).slice(0, 16),
    appFingerprint: sha256(result.appId).slice(0, 16),
    realPath: fs.realpathSync(absolute),
  })
}

export function assertMipMediaMigrationConfirmations({
  source,
  target,
  confirmSourceEnvironment,
  confirmTargetEnvironment,
  confirmSourceAppId,
  confirmTargetAppId,
}) {
  if (source.realPath === target.realPath
    || source.environmentId === target.environmentId
    || source.appId === target.appId
    || source.environmentId !== confirmSourceEnvironment
    || target.environmentId !== confirmTargetEnvironment
    || source.appId !== confirmSourceAppId
    || target.appId !== confirmTargetAppId
    || target.stage !== 'staging') {
    throw new Error('MIP_MEDIA_COPY_CONFIRMATION_INVALID')
  }
}

export function createMipCloudbaseStorageTransport({
  projectRoot,
  sourceEnvironment,
  targetEnvironment,
  workDirectory,
  runtime = defaultRuntime(),
}) {
  const root = path.resolve(projectRoot)
  const work = path.resolve(workDirectory)
  const sourceDirectory = path.join(work, 'source')
  const targetDirectory = path.join(work, 'target')
  ensurePrivateDirectory(work)
  ensurePrivateDirectory(sourceDirectory)
  ensurePrivateDirectory(targetDirectory)
  let activeFingerprint = ''

  async function activate(environment) {
    if (activeFingerprint === environment.environmentFingerprint) {
      return
    }
    await runtime.activate({ projectRoot: root, environment })
    activeFingerprint = environment.environmentFingerprint
  }

  return Object.freeze({
    async downloadSource({ cloudFileId, objectKey }) {
      await activate(sourceEnvironment)
      const localPath = privateObjectPath(sourceDirectory, cloudFileId)
      removeRegularFile(localPath)
      await runtime.manageStorage({
        projectRoot: root,
        action: 'download',
        localPath,
        cloudPath: objectKey,
      })
      return readDownloadedPrivateFile(localPath)
    },
    async uploadTarget({ objectKey, content }) {
      await activate(targetEnvironment)
      const localPath = privateObjectPath(targetDirectory, objectKey)
      writePrivateObject(localPath, content)
      const uploaded = await runtime.manageStorage({
        projectRoot: root,
        action: 'upload',
        localPath,
        cloudPath: objectKey,
      })
      let cloudFileId = findMatchingCloudFileId(uploaded, objectKey)
      if (!cloudFileId) {
        const info = await runtime.queryStorage({
          projectRoot: root,
          action: 'info',
          cloudPath: objectKey,
        })
        cloudFileId = findMatchingCloudFileId(info, objectKey)
      }
      if (!cloudFileId) {
        const url = await runtime.queryStorage({
          projectRoot: root,
          action: 'url',
          cloudPath: objectKey,
        })
        cloudFileId = findMatchingCloudFileId(url, objectKey)
      }
      if (!cloudFileId) {
        throw new Error('MIP_MEDIA_COPY_TARGET_REFERENCE_INVALID')
      }
      return { fileID: cloudFileId }
    },
    async downloadTarget({ cloudFileId }) {
      await activate(targetEnvironment)
      const objectKey = cloudObjectKey(cloudFileId)
      const localPath = privateObjectPath(targetDirectory, `readback\0${cloudFileId}`)
      removeRegularFile(localPath)
      await runtime.manageStorage({
        projectRoot: root,
        action: 'download',
        localPath,
        cloudPath: objectKey,
      })
      return readDownloadedPrivateFile(localPath)
    },
  })
}

export function createPrivateMipMediaWorkDirectory(packageDirectory, repoRoot) {
  const packageRoot = path.resolve(packageDirectory)
  const work = path.resolve(path.dirname(packageRoot), `.${path.basename(packageRoot)}.media-copy-work`)
  const relative = path.relative(path.resolve(repoRoot), work)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('MIP_MEDIA_COPY_WORK_DIRECTORY_INVALID')
  }
  ensurePrivateDirectory(work)
  return work
}

export function readMipMediaCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  }
}

export function writeMipMediaCheckpoint(filePath, checkpoint) {
  const parent = path.dirname(filePath)
  const parentStat = fs.lstatSync(parent)
  const existing = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || (existing && (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o077) !== 0))) {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  }
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, filePath)
    fs.chmodSync(filePath, 0o600)
  }
  finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor)
    }
    const partial = fs.lstatSync(temporary, { throwIfNoEntry: false })
    if (partial?.isFile() && !partial.isSymbolicLink()) {
      fs.unlinkSync(temporary)
    }
  }
}

export function removeMipMediaWorkDirectory(workDirectory, packageDirectory) {
  const work = path.resolve(workDirectory)
  const expected = path.resolve(
    path.dirname(path.resolve(packageDirectory)),
    `.${path.basename(path.resolve(packageDirectory))}.media-copy-work`,
  )
  if (work !== expected || !fs.existsSync(work)) {
    return
  }
  fs.rmSync(work, { recursive: true, force: true })
}

export function validateCheckpointEnvelope(checkpoint, plan) {
  if (!checkpoint) {
    return []
  }
  if (checkpoint.format !== 'mip-long-term-media-copy-checkpoint-v1'
    || checkpoint.planSha256 !== plan.planSha256
    || !Array.isArray(checkpoint.updates)
    || checkpoint.completedCount !== checkpoint.updates.length
    || checkpoint.recordsSha256 !== sha256(
      checkpoint.updates.map(update => JSON.stringify(update)).join('\n'),
    )) {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  }
  return checkpoint.updates
}

function defaultRuntime() {
  return {
    async activate({ projectRoot, environment }) {
      process.env.CLOUDBASE_API_KEY = environment.apiKey
      process.env.CLOUDBASE_ENV_ID = environment.environmentId
      delete process.env.CLOUDBASE_AUTH_MODE
      restartCloudbaseMcp(projectRoot)
      loginWithCloudbaseManagementApiKey(projectRoot, {
        apiKey: environment.apiKey,
        envId: environment.environmentId,
      })
      const response = callCloudbaseMcp(projectRoot, 'queryEnv', {
        action: 'info',
        envId: environment.environmentId,
      }, 30000)
      if (!containsEnvironmentId(response, environment.environmentId)) {
        throw new Error('MIP_MEDIA_COPY_ENV_BINDING_INVALID')
      }
    },
    async manageStorage({ projectRoot, ...args }) {
      return callCloudbaseMcp(projectRoot, 'manageStorage', args, 300000)
    },
    async queryStorage({ projectRoot, ...args }) {
      return callCloudbaseMcp(projectRoot, 'queryStorage', args, 30000)
    },
  }
}

function parseDotEnv(source) {
  const result = {}
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z_]\w*)=(.*)$/i.exec(line.trim())
    if (!match) {
      continue
    }
    let value = match[2].trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\'')))) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

function ensurePrivateDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('MIP_MEDIA_COPY_WORK_DIRECTORY_INVALID')
  }
  fs.chmodSync(directory, 0o700)
}

function privateObjectPath(directory, value) {
  return path.join(directory, `${sha256(value)}.bin`)
}

function removeRegularFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('MIP_MEDIA_COPY_LOCAL_OBJECT_INVALID')
  }
  fs.rmSync(filePath)
}

function writePrivateObject(filePath, value) {
  fs.writeFileSync(filePath, value, { mode: 0o600 })
  fs.chmodSync(filePath, 0o600)
}

function readDownloadedPrivateFile(filePath) {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('MIP_MEDIA_COPY_LOCAL_OBJECT_INVALID')
  }
  fs.chmodSync(filePath, 0o600)
  return fs.readFileSync(filePath)
}

function containsEnvironmentId(value, expected) {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (value.EnvId === expected || value.envId === expected) {
    return true
  }
  return Object.values(value).some(child => containsEnvironmentId(child, expected))
}

function findMatchingCloudFileId(value, objectKey, seen = new Set()) {
  if (typeof value === 'string') {
    try {
      return cloudObjectKey(value) === objectKey ? value : ''
    }
    catch {
      return ''
    }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return ''
  }
  seen.add(value)
  for (const child of Object.values(value)) {
    const found = findMatchingCloudFileId(child, objectKey, seen)
    if (found) {
      return found
    }
  }
  return ''
}

function cloudObjectKey(value) {
  if (typeof value !== 'string' || !value.startsWith('cloud://')
    || value.includes('..') || value.includes('\\') || /\s/.test(value)) {
    throw new Error('MIP_MEDIA_COPY_CLOUD_FILE_INVALID')
  }
  const tail = value.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) {
    throw new Error('MIP_MEDIA_COPY_CLOUD_FILE_INVALID')
  }
  return tail.slice(slash + 1)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
