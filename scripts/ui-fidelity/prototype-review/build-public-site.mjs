#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { buildReportData } from './build-report.mjs'

const directory = import.meta.dirname
const digest = value => createHash('sha256').update(value).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))

// Only public prose and deliberately selected fields leave the local evidence directory.
function publicText(value) {
  if (Array.isArray(value)) {
    return value.map(publicText)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, publicText(entry)]))
  }
  if (typeof value !== 'string') {
    return value
  }
  return value
    .replace(/\/(?:Users|home|var)\/[^\s，。；）"']+/g, '[本地记录]')
    .replace(/\bwx[a-f0-9]{16}\b/gi, '[应用标识]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/\b[a-z0-9-]+-[a-z0-9]{4,}(?=\.tcb|\.service\.tcloudbase)/gi, '[环境标识]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[测试记录]')
}

export function buildPublicSite({ manifestPath, evidencePath, publicationPath, resultsPath, outputPath }) {
  const original = buildReportData({ manifestPath, evidencePath })
  const publication = read(publicationPath)
  const results = resultsPath ? read(resultsPath) : { cases: [] }
  if (!publication.reviewedBy || !publication.reviewedAt || !Array.isArray(publication.approvedImageSha256)) {
    throw new Error('publication 必须提供 reviewedBy、reviewedAt、approvedImageSha256；不能默认公开截图')
  }
  const approved = new Set(publication.approvedImageSha256)
  const assets = new Map()
  const excluded = []
  function image(source, label) {
    if (!source?.available) {
      return { available: false }
    }
    if (!approved.has(source.sha256)) {
      excluded.push(label)
      return { available: false }
    }
    const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(source.src)
    if (!match) {
      throw new Error(`图片来源不受支持：${label}`)
    }
    const bytes = Buffer.from(match[2], 'base64')
    if (digest(bytes) !== source.sha256) {
      throw new Error(`图片摘要不一致：${label}`)
    }
    const file = `assets/${source.sha256}.${match[1] === 'jpeg' ? 'jpg' : 'png'}`
    assets.set(file, bytes)
    return { ...pick(source, ['available', 'width', 'height', 'sha256']), src: file }
  }
  const report = {
    ...pick(original, ['title', 'generatedAt', 'captureSet', 'summary']),
    source: pick(original.source, ['commit', 'url']),
    implementation: pick(original.implementation, ['commit', 'captureNotes']),
    roleProfiles: Object.fromEntries(Object.entries(original.roleProfiles).map(([key, value]) => [key, pick(value, ['label'])])),
    previousFeedback: null,
    steps: original.steps.map((step) => {
      const clean = {
        ...pick(step, ['id', 'name', 'expectedRole', 'evidenceWarnings', 'verification']),
        prototype: { ...pick(step.prototype, ['sourceUrl', 'capturedAt']), image: image(step.prototype.image, `${step.id}:prototype`) },
        actual: { ...pick(step.actual, ['role', 'roleMatches', 'stateMatches', 'capturedAt', 'source', 'chromeOmitted', 'referenceChromeInsetCssPx']), image: image(step.actual.image, `${step.id}:actual`) },
        review: pick(step.review, ['status', 'visualNotes', 'differences']),
        additionalImages: step.additionalImages.map((entry, index) => ({ ...pick(entry, ['side', 'label']), image: image(entry.image, `${step.id}:extra:${index}`) })),
      }
      if (step.actual.source === 'simulated-role' && clean.actual.image.available && clean.prototype.image.available
        && step.review.reviewedImageSha256 === clean.actual.image.sha256 && step.review.reviewedBy && step.review.reviewedAt && step.review.visualNotes) {
        clean.simulationReviewed = true
        clean.verification.visual.status = step.review.status === 'needs-fix' ? 'needs-fix' : 'simulated-reviewed'
        clean.verification.scenario.status = step.actual.roleMatches === true && step.actual.stateMatches === true ? 'simulated' : 'simulated-mismatch'
        // Simulation never earns a real-session or device pass, regardless of input claims.
        clean.verification.device.status = step.review.deviceRequired ? 'pending' : 'unscoped'
        clean.verification.deviceOnly = false
        clean.verification.hasIssue = step.review.status === 'needs-fix' || step.review.interactionStatus === 'failed'
        const operations = clean.verification.interaction.evidence
        if (step.review.interactionStatus === 'pass' && operations.length) {
          clean.verification.interaction.status = 'simulated-recorded'
        }
        clean.verification.aiPending = clean.verification.hasIssue || clean.verification.scenario.status === 'simulated-mismatch' || clean.verification.interaction.status !== 'simulated-recorded'
        clean.verification.nextStep = clean.verification.hasIssue ? 'AI 继续修复模拟画面中已记录的问题。' : '本页已核对本地模拟画面；模拟角色记录与真实微信、手机号、支付和扫码验证分开统计。'
      }
      if (!clean.actual.image.available || !clean.prototype.image.available) {
        clean.review.status = 'pending'
        clean.review.visualNotes = '本页截图未完成公开分享审核，当前不能查看完整对照；不据此认定视觉通过。'
        clean.verification.visual.status = 'pending'
        clean.verification.aiPending = true
        clean.verification.deviceOnly = false
        clean.verification.nextStep = '补齐可公开的演示截图后继续视觉验收；下方测试记录与截图验收独立。'
        clean.evidenceWarnings = [...clean.evidenceWarnings, '未审核的截图未发布，避免公开个人资料或有效二维码。']
      }
      return clean
    }),
  }
  const ids = new Set(report.steps.map(step => step.id))
  const modes = new Set(['test-account-service', 'simulated-role', 'devtools', 'device', 'automated-contract'])
  const cases = (results.cases || []).map((entry) => {
    if (!entry.id || !['pass', 'fail', 'pending'].includes(entry.status) || !modes.has(entry.mode)) {
      throw new Error('测试项必须有 id、合法 status 和 mode')
    }
    if (!Array.isArray(entry.stepIds) || entry.stepIds.some(id => !ids.has(id))) {
      throw new Error(`测试项关联未知步骤：${entry.id}`)
    }
    if (!entry.summary || (entry.status !== 'pending' && !entry.evidence)) {
      throw new Error(`测试项缺少结果说明或证据：${entry.id}`)
    }
    return pick(entry, ['id', 'stepIds', 'status', 'mode', 'summary', 'evidence', 'limitations'])
  })
  report.summary.simulationReviewed = report.steps.filter(step => step.simulationReviewed).length
  report.summary.knownIssues = report.steps.filter(step => step.verification.hasIssue).length
  report.summary.scenarioPending = report.steps.filter(step => ['pending', 'simulated-mismatch'].includes(step.verification.scenario.status)).length
  report.summary.actual = report.steps.filter(step => step.actual.image.available).length
  report.summary.prototype = report.steps.filter(step => step.prototype.image.available).length
  report.summary.passed = report.steps.filter(step => step.review.status === 'pass').length
  report.summary.aiPending = report.steps.filter(step => step.verification.aiPending).length
  report.summary.deviceOnly = report.steps.filter(step => step.verification.deviceOnly).length
  report.captureSet = digest(report.steps.map(step => `${step.id}:${step.actual.image.sha256 || 'omitted'}`).join('|')).slice(0, 16)
  report.testResults = { generatedAt: results.generatedAt || null, cases }
  const safe = publicText(report)
  const json = JSON.stringify(safe).replaceAll('<', '\\u003c')
  let template = fs.readFileSync(path.join(directory, 'template.html'), 'utf8')
  template = template.replace('<title>', '<meta name="robots" content="noindex,nofollow,noarchive" />\n    <title>')
  template = template.replace('<main>', '<main>\n<p class="public-notice">临时验收站 · 测试账号数据 / 演示配置。真实微信操作、模拟角色和服务端测试分别标明。意见只保存在你的浏览器，完成后请导出发回。</p>\n<details class="evidence"><summary>查看本轮测试结果与范围</summary><div id="public-test-results"></div></details>')
  template = template.replace('/*__STYLES__*/', `${fs.readFileSync(path.join(directory, 'review.css'), 'utf8')}\n.public-notice{font-size:13px;color:#555;line-height:1.6}.test-row{padding:12px 0;border-bottom:1px solid #ddd}.test-row p{margin:6px 0;white-space:pre-wrap}`)
  const baseClient = fs.readFileSync(path.join(directory, 'review.js'), 'utf8').replace(
    'const title = side === \'prototype\' ? \'原型\' : \'实际效果\'',
    'const title = side === \'prototype\' ? \'原型\' : \'实现截图 · \' + ({devtools: \'开发者工具\', device: \'微信真机\', \'simulated-role\': \'模拟角色\'}[step.actual.source] || \'来源待确认\')',
  )
  const publicClient = baseClient
    .replace('const visualLabels = {', 'const visualLabels = { \'simulated-reviewed\': \'视觉：模拟画面已核对\',')
    .replace('const interactionLabels = {', 'const interactionLabels = { \'simulated-recorded\': \'交互：本地模拟已测\',')
    .replace('v.scenario.status === \'matched\' ? \'场景：已对应\' : \'角色 / 数据：待补测\'', 'v.scenario.status.startsWith(\'simulated\') ? \'场景：本地模拟\' : v.scenario.status === \'matched\' ? \'场景：已对应\' : \'角色 / 数据：待补测\'')
    .replace('$(\'scenario-warning\').hidden = v.scenario.status === \'matched\'', '$(\'scenario-warning\').hidden = [\'matched\', \'simulated\'].includes(v.scenario.status)')
    .replace('已知问题 ', `模拟画面已核对 ${report.summary.simulationReviewed} 页 · 已知问题 `)
  const client = `${publicClient}\n${fs.readFileSync(path.join(directory, 'public-results.js'), 'utf8')}`
  const html = template.replace('/*__REPORT_DATA__*/', json).replace('/*__CLIENT__*/', client)
  // Use a dedicated fresh output folder, never copy the raw evidence tree.
  if (fs.existsSync(outputPath) && fs.readdirSync(outputPath).length) {
    throw new Error('输出目录必须为空，避免旧私密文件混入发布')
  }
  fs.mkdirSync(path.join(outputPath, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(outputPath, 'index.html'), html)
  for (const [file, bytes] of assets) {
    fs.writeFileSync(path.join(outputPath, file), bytes)
  }
  fs.writeFileSync(path.join(outputPath, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
  fs.writeFileSync(path.join(outputPath, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-cache\n')
  return { outputPath, pages: report.steps.length, images: assets.size, excluded, cases: cases.length, bytes: Buffer.byteLength(html), summary: report.summary }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const values = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]
    if (!['--manifest', '--evidence', '--publication', '--results', '--out'].includes(key) || !process.argv[i + 1]) {
      throw new Error(`无效参数：${key}`)
    }
    values[key.slice(2)] = path.resolve(process.argv[i + 1])
  }
  if (!values.manifest || !values.publication || !values.out) {
    throw new Error('必需 --manifest --publication --out；可选 --evidence --results')
  }
  console.log(JSON.stringify(buildPublicSite({ manifestPath: values.manifest, evidencePath: values.evidence, publicationPath: values.publication, resultsPath: values.results, outputPath: values.out })))
}
