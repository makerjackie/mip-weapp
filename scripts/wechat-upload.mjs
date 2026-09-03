import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { readEnv, repositoryRoot } from './lib/project.mjs'

const env = readEnv(path.join(repositoryRoot, '.env.local'))
const args = process.argv.slice(2)

function option(name) {
  const prefix = `--${name}=`
  const inline = args.find(arg => arg.startsWith(prefix))
  if (inline) {
    return inline.slice(prefix.length)
  }

  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] || '' : ''
}

function fail(message) {
  console.error(`[wechat-upload] ${message}`)
  process.exit(1)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法：pnpm build && pnpm wechat:upload -- --version=1.0.0 --desc="更新说明"')
  console.log('检查配置：pnpm wechat:upload -- --check')
  process.exit(0)
}

const appid = env.MINI_PROGRAM_APP_ID || ''
const configuredKeyPath = env.MIP_WECHAT_CODE_UPLOAD_KEY_PATH || ''
const projectPath = repositoryRoot
const buildOutputPath = path.join(repositoryRoot, 'dist')
const keyPath = configuredKeyPath
  ? path.resolve(repositoryRoot, configuredKeyPath)
  : ''

if (!/^wx[0-9a-f]{16}$/i.test(appid)) {
  fail('`.env.local` 中的 MINI_PROGRAM_APP_ID 不存在或格式不正确。')
}

if (!configuredKeyPath) {
  fail('`.env.local` 未配置 MIP_WECHAT_CODE_UPLOAD_KEY_PATH。')
}

let keyStat
try {
  keyStat = fs.statSync(keyPath)
}
catch {
  fail('MIP_WECHAT_CODE_UPLOAD_KEY_PATH 指向的私钥文件不存在。')
}

if (!keyStat.isFile()) {
  fail('MIP_WECHAT_CODE_UPLOAD_KEY_PATH 必须指向文件。')
}

if ((keyStat.mode & 0o077) !== 0) {
  fail('私钥文件权限过宽，请手动将该文件设为 600；脚本不会修改文件夹权限。')
}

if (args.includes('--check')) {
  console.log('[wechat-upload] 配置检查通过，未执行上传。')
  process.exit(0)
}

if (!fs.existsSync(path.join(buildOutputPath, 'app.json'))) {
  fail('未找到 dist/app.json，请先执行 `pnpm build`。')
}

const version = option('version')
const desc = option('desc')
if (!version) {
  fail('上传必须提供 --version，例如 --version=1.0.0。')
}
if (!desc) {
  fail('上传必须提供 --desc，例如 --desc="更新说明"。')
}

const robotValue = option('robot')
const robot = robotValue ? Number(robotValue) : undefined
if (robotValue && (!Number.isInteger(robot) || robot < 1 || robot > 30)) {
  fail('--robot 必须是 1 到 30 之间的整数。')
}

const require = createRequire(import.meta.url)
const ci = require('miniprogram-ci')

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath,
  privateKeyPath: keyPath,
  ignores: ['node_modules/**/*'],
})

console.log(`[wechat-upload] 正在上传版本 ${version}。`)
const result = await ci.upload({
  project,
  version,
  desc,
  robot,
  setting: {
    useProjectConfig: true,
  },
})

console.log('[wechat-upload] 上传完成。')
if (result?.subPackageInfo) {
  console.log(`[wechat-upload] 分包信息已返回：${result.subPackageInfo.length} 项。`)
}
