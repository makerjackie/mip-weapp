#!/usr/bin/env node

// Release entrypoints for the direction-B environment split (MIW-111).
//
//   node scripts/release.mjs trial --desc "说明"   # 测试环境 → 体验版（日常/内测）
//   node scripts/release.mjs prod  --desc "说明" --version 1.0.1   # 生产环境 → 正式版
//
// Both channels build from the matching envs/ target, run the full verify:all
// gate, then upload through the logged-in WeChat DevTools CLI using a flattened
// dist project (root-project uploads fail with 800059). The miniprogram-ci
// private-key channel stays available via pnpm wechat:upload once a key file
// exists; this script intentionally refuses to fall back to the repo root env.
//
// prod additionally prints the manual submission checklist (mp.weixin.qq.com
// wizard + demo video + screenshots) because 提审 needs trusted clicks and
// native file choosers that automation must not fake.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertReleaseBuildMarker, assertReleaseSource, readReleaseSource } from './lib/release-provenance.mjs'

const root = path.resolve(import.meta.dirname, '..')
const devtoolsCli = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

const channel = process.argv[2]
const args = process.argv.slice(3)

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
  console.error(`[release] ${message}`)
  process.exit(1)
}

if (!['trial', 'prod'].includes(channel)) {
  fail('用法：node scripts/release.mjs trial|prod --desc "更新说明" [--version X.Y.Z] [--robot N]')
}

const desc = option('desc')
if (!desc) {
  fail('上传必须提供 --desc（更新说明）。')
}

const targetDir = channel === 'prod' ? 'envs/prod' : 'envs/test'
if (!fs.existsSync(path.join(root, targetDir, '.env.local'))) {
  fail(`目标 ${targetDir} 未配置：先按模板落 ${targetDir}/.env.local。`)
}
if (process.env.MIP_ENV_DIR && path.resolve(root, process.env.MIP_ENV_DIR) !== path.resolve(root, targetDir)) {
  fail(`环境里的 MIP_ENV_DIR (${process.env.MIP_ENV_DIR}) 与发布通道冲突；用干净环境重跑。`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const now = new Date()
const dateTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const version = option('version')
  || (channel === 'trial' ? `${pkg.version}.${dateTag}` : '')
if (!version) {
  fail('正式发布必须显式 --version（例如 --version 1.0.1）。')
}
if (channel === 'trial' && /^production$/i.test(readEnvValue(targetDir, 'MIP_DEPLOYMENT_STAGE'))) {
  fail('trial 通道不允许 production 语义的目录；检查 envs/test 配置。')
}
if (channel === 'prod' && !/^production$/i.test(readEnvValue(targetDir, 'MIP_DEPLOYMENT_STAGE'))) {
  fail('prod 通道要求 envs/prod 为 MIP_DEPLOYMENT_STAGE=production。')
}

console.log(`[release] 通道=${channel} 目标目录=${targetDir} 版本=${version}`)
if (channel === 'prod') {
  const fetched = spawnSync('git', ['fetch', 'origin', 'main'], { cwd: root, stdio: 'inherit' })
  if (fetched.error || fetched.status !== 0) {
    fail('无法更新 origin/main，已停止上传。')
  }
}
const sourceSha = assertReleaseSource(readReleaseSource(root), { channel })
console.log(`[release] 源码=${sourceSha}`)
console.log(`[release] 上传前执行完整质量门禁（verify:all）。`)
const verification = spawnSync('pnpm', ['verify:all'], { cwd: root, stdio: 'inherit', env: process.env })
if (verification.error || verification.status !== 0) {
  fail('verify:all 未通过，已停止上传。')
}

console.log(`[release] 从 ${targetDir} 构建。`)
assertReleaseSource(readReleaseSource(root), { channel, expectedSha: sourceSha })
const build = spawnSync('pnpm', ['build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MIP_ENV_DIR: targetDir, BUILD_SHA: sourceSha },
})
if (build.error || build.status !== 0) {
  fail('构建失败。')
}

// 烘焙核对：包内函数名前缀必须与通道一致（trial=mip-t-*，prod=mip-*）
const common = fs.readFileSync(path.join(root, 'dist', 'common.js'), 'utf8')
assertReleaseBuildMarker(common, sourceSha)
assertReleaseSource(readReleaseSource(root), { channel, expectedSha: sourceSha })
const hasTest = common.includes('mip-t-identity-api')
const hasProd = common.includes('mip-identity-api')
if (channel === 'trial' && (!hasTest || hasProd)) {
  fail('烘焙核对失败：trial 产物必须只含 mip-t-* 函数名。')
}
if (channel === 'prod' && (!hasProd || hasTest)) {
  fail('烘焙核对失败：prod 产物必须只含生产函数名。')
}
console.log(`[release] 烘焙核对通过（${channel === 'trial' ? 'mip-t-*' : 'mip-*'}）。`)

// dist 平铺临时工程（根工程直传报 800059）
const flat = path.join(root, '.tmp', `upload-${channel}-flat`)
fs.rmSync(flat, { recursive: true, force: true })
fs.mkdirSync(flat, { recursive: true })
fs.cpSync(path.join(root, 'dist'), flat, { recursive: true })
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
delete cfg.cloudfunctionRoot
fs.writeFileSync(
  path.join(flat, 'project.config.json'),
  `${JSON.stringify({ ...cfg, miniprogramRoot: './', srcMiniprogramRoot: './', setting: { ...cfg.setting, packNpmManually: false, packNpmRelationList: [] } }, null, 2)}\n`,
)

const uploadArgs = ['upload', '--project', flat, '--version', version, '--desc', desc]
const robot = option('robot')
if (robot) {
  uploadArgs.push('--robot', robot)
}
console.log(`[release] 经开发者工具 CLI 上传 ${version}。`)
if (!fs.existsSync(devtoolsCli)) {
  fail(`未找到开发者工具 CLI：${devtoolsCli}`)
}
const upload = spawnSync(devtoolsCli, uploadArgs, { cwd: root, stdio: 'inherit' })
if (upload.error || upload.status !== 0) {
  fail('上传失败。')
}
fs.writeFileSync(path.join(root, '.tmp', `release-${channel}-${version}.json`), `${JSON.stringify({
  sourceSha,
  version,
  channel,
  targetDir,
  uploadedAt: new Date().toISOString(),
  developmentUploadSucceeded: true,
  trialAssignmentVerified: false,
  reviewSubmitted: false,
  publicReleased: false,
}, null, 2)}\n`)

if (channel === 'trial') {
  console.log(`
[release] ✅ 开发版本 ${version} 已上传（测试环境 mip-t-*），尚未确认设为体验版。
下一步：微信公众平台 → 版本管理 → 将该版本设为体验版（若非最新），扫码分发。
提醒：测试环境数据独立（mip_test 库），支付禁用，可放心内测。`)
}
else {
  console.log(`
[release] ✅ 开发版本 ${version} 已上传（连接生产环境），尚未提审或公开发布。提审人工清单：
1. mp.weixin.qq.com → 版本管理 → 开发版本里找到 ${version} → 提交审核
2. 向导确认链：勾选平台规则 → 下一步 → 安全测试继续提交 → 接口未配置（wx.getLocation 未使用，勾选后继续）→ 隐私指引继续提交
3. 提审表单：类目/功能页面按默认；演示视频 ~/Downloads/MIP-YANSHOU-VIDEO.mp4；截图 .tmp/review-shots/
4. 审核通过后 → 全量发布；发布后真机验证一笔 live 支付与会员到账
5. 生产验证命令：node scripts/verify-cloud.mjs --confirm-env=<EnvID>（MIP_ENV_DIR=envs/prod）`)
}

function readEnvValue(dir, key) {
  const file = path.join(root, dir, '.env.local')
  if (!fs.existsSync(file)) {
    return ''
  }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/)
    if (match && match[1] === key) {
      return match[2].trim()
    }
  }
  return ''
}
