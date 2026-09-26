#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const templateDirectory = import.meta.dirname
const reviewStatuses = new Set(['pending', 'pass', 'needs-fix', 'blocked', 'data-mismatch', 'accepted-difference'])
const feedbackStatuses = new Set(['pass', 'needs-fix', 'pending'])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function merge(base, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return update ?? base
  }
  const result = { ...base }
  for (const [key, value] of Object.entries(update)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key], value) : value
  }
  return result
}

// Each input owns its relative screenshot paths, including a separate evidence file.
function resolveStepPaths(step, directory) {
  const result = structuredClone(step)
  for (const side of ['prototype', 'actual']) {
    if (result[side]?.path) {
      result[side].path = path.resolve(directory, result[side].path)
    }
  }
  for (const image of result.additionalImages || []) {
    if (image.path) {
      image.path = path.resolve(directory, image.path)
    }
  }
  return result
}

function imageInfo(file) {
  if (!file || !fs.existsSync(file)) {
    return { available: false }
  }
  const bytes = fs.readFileSync(file)
  let mime, width, height
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png'
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  }
  else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg'
    for (let index = 2; index < bytes.length - 9;) {
      if (bytes[index] !== 255) {
        index++
        continue
      }
      const marker = bytes[index + 1]
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        height = bytes.readUInt16BE(index + 5)
        width = bytes.readUInt16BE(index + 7)
        break
      }
      if (marker === 216 || marker === 217) {
        index += 2
        continue
      }
      index += 2 + bytes.readUInt16BE(index + 2)
    }
  }
  if (!width || !height) {
    throw new Error(`截图必须是有效 PNG/JPEG：${file}`)
  }
  return { available: true, width, height, sha256: sha256(bytes), src: `data:${mime};base64,${bytes.toString('base64')}` }
}

function previousFeedback(file, ids) {
  if (!file) {
    return null
  }
  const input = readJson(file)
  if (!input.feedback || typeof input.feedback !== 'object' || Array.isArray(input.feedback)) {
    throw new Error('反馈文件缺少 feedback 对象')
  }
  const feedback = {}
  for (const [id, value] of Object.entries(input.feedback)) {
    if (!ids.has(id) || !value || typeof value !== 'object') {
      continue
    }
    feedback[id] = {
      ...(feedbackStatuses.has(value.status) ? { status: value.status } : {}),
      ...(typeof value.note === 'string' ? { note: value.note } : {}),
      ...(typeof value.at === 'string' ? { at: value.at } : {}),
    }
  }
  return { sourceCommit: input.sourceCommit, implementationCommit: input.implementationCommit, exportedAt: input.exportedAt, feedback }
}

function evidenceLines(value) {
  return (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim())
}

// These dimensions describe evidence coverage, not a single product pass/fail score.
function verificationOf(step) {
  const { review, actual, prototype } = step
  const current = prototype.image.available && actual.image.available
    && prototype.capturedAt && actual.capturedAt
    && ['devtools', 'device'].includes(actual.source)
    && review.reviewedBy && review.reviewedAt && review.visualNotes
    && review.reviewedImageSha256 === actual.image.sha256
  const visualStates = { 'pass': 'pass', 'needs-fix': 'needs-fix', 'accepted-difference': 'explained', 'data-mismatch': 'reviewed', 'blocked': 'reviewed' }
  const visualStatus = current ? visualStates[review.status] || 'pending' : 'pending'
  const scenarioStatus = actual.roleMatches === true && actual.stateMatches === true
    && !['blocked', 'data-mismatch'].includes(review.status)
    ? 'matched'
    : 'pending'
  const interactions = [...evidenceLines(actual.interactionEvidence), ...evidenceLines(review.interactionNotes)]
  let interactionStatus = 'pending'
  if (review.interactionStatus === 'failed') {
    interactionStatus = 'failed'
  }
  else if (current && interactions.length) {
    interactionStatus = review.interactionStatus === 'pass' ? 'pass' : 'partial'
  }
  const deviceEvidence = evidenceLines(review.deviceNotes)
  let deviceStatus = 'unscoped'
  if (review.deviceStatus === 'failed') {
    deviceStatus = 'failed'
  }
  else if (review.deviceStatus === 'pass' && current && (deviceEvidence.length || actual.source === 'device')) {
    deviceStatus = 'pass'
  }
  else if (typeof review.deviceRequired === 'boolean') {
    deviceStatus = review.deviceRequired ? 'pending' : 'not-required'
  }
  const visualComplete = ['pass', 'explained'].includes(visualStatus)
  const hasIssue = visualStatus === 'needs-fix' || interactionStatus === 'failed' || deviceStatus === 'failed'
  const deviceScopeMissing = deviceStatus === 'pending' && !deviceEvidence.length
  const aiPending = hasIssue || !visualComplete || scenarioStatus !== 'matched' || interactionStatus !== 'pass' || deviceScopeMissing
  const deviceOnly = !aiPending && deviceStatus === 'pending'
  let nextStep = '当前场景的视觉与交互已有记录，可继续逐页批注。'
  if (hasIssue) {
    nextStep = 'AI 继续处理已记录的问题，并重新验证。'
  }
  else if (scenarioStatus !== 'matched') {
    nextStep = 'AI 补齐对应角色或演示数据后复测；所需账号条件会单独说明。'
  }
  else if (deviceScopeMissing) {
    nextStep = 'AI 补充具体真机测试范围；未单列前不转为人工验收任务。'
  }
  else if (aiPending) {
    nextStep = 'AI 继续完成截图核对和可自行操作的测试。'
  }
  else if (deviceOnly) {
    nextStep = '当前场景的视觉与交互已有记录；剩余仅为下方列出的真机项目。'
  }
  else if (deviceStatus === 'unscoped') {
    nextStep = '当前场景的视觉与交互已有记录；真机范围尚未单列。'
  }
  return {
    visual: { status: visualStatus },
    interaction: { status: interactionStatus, evidence: interactions },
    scenario: { status: scenarioStatus },
    device: { status: deviceStatus, evidence: deviceEvidence },
    hasIssue,
    aiPending,
    deviceOnly,
    nextStep,
  }
}

export function buildReportData({ manifestPath, evidencePath, feedbackPath }) {
  const manifest = readJson(manifestPath)
  const evidence = evidencePath ? readJson(evidencePath) : {}
  const ids = new Set(manifest.steps?.map(step => step.id))
  if (manifest.steps?.length !== 43 || ids.size !== 43) {
    throw new Error('验收清单必须恰好包含 43 个唯一步骤')
  }
  for (const id of Object.keys(evidence.steps || {})) {
    if (!ids.has(id)) {
      throw new Error(`未知步骤：${id}`)
    }
  }
  const steps = manifest.steps.map((source) => {
    const base = resolveStepPaths(source, path.dirname(manifestPath))
    const update = resolveStepPaths(evidence.steps?.[source.id] || {}, evidencePath ? path.dirname(evidencePath) : path.dirname(manifestPath))
    const step = merge(base, update)
    step.review = merge({ status: 'pending', differences: [], interactionStatus: 'pending', deviceStatus: 'pending' }, step.review)
    if (!reviewStatuses.has(step.review.status)) {
      throw new Error(`未知复核状态：${step.id}`)
    }
    step.prototype.image = imageInfo(step.prototype.path)
    step.actual.image = imageInfo(step.actual.path)
    step.additionalImages = (step.additionalImages || []).map(image => ({ ...image, image: imageInfo(image.path) }))
    const reviewedHash = step.review.reviewedImageSha256
    step.evidenceWarnings = []
    if (reviewedHash && reviewedHash !== step.actual.image.sha256) {
      step.review = { ...step.review, status: 'pending', visualNotes: '截图已更新，等待重新核对。', differences: ['当前截图与上次复核的 SHA 不同，旧结论不沿用。'], interactionStatus: 'pending', deviceStatus: 'pending' }
      step.actual.stateMatches = null
    }
    if (step.review.status === 'pass') {
      const valid = step.prototype.image.available && step.actual.image.available
        && step.actual.roleMatches === true && step.actual.stateMatches === true
        && ['devtools', 'device'].includes(step.actual.source)
        && step.prototype.capturedAt && step.actual.capturedAt
        && step.review.reviewedBy && step.review.reviewedAt && step.review.visualNotes
        && reviewedHash === step.actual.image.sha256
      if (!valid) {
        step.review.status = 'pending'
        step.evidenceWarnings.push('通过证据不足，保留待复核。')
      }
    }
    if (!step.prototype.image.available || !step.actual.image.available) {
      step.evidenceWarnings.push('缺少截图，不能判断通过。')
    }
    if (step.actual.image.available && step.actual.roleMatches !== true) {
      step.evidenceWarnings.push('实际身份与原型角色尚未对齐。')
    }
    if (step.actual.image.available && step.actual.stateMatches !== true) {
      step.evidenceWarnings.push('实际场景与原型尚未对齐。')
    }
    step.verification = verificationOf(step)
    // 750×1624 contains custom navigation; 750×1448 omits native navigation.
    step.actual.chromeOmitted ??= step.actual.image.width === 750 && step.actual.image.height === 1448
    step.actual.referenceChromeInsetCssPx ??= step.actual.chromeOmitted ? 88 : 0
    delete step.prototype.path
    delete step.actual.path
    for (const image of step.additionalImages) {
      delete image.path
    }
    return step
  })
  return {
    title: 'MIP · 逐页验收',
    generatedAt: new Date().toISOString(),
    source: manifest.source,
    implementation: merge(manifest.implementation, evidence.implementation),
    roleProfiles: manifest.roleProfiles,
    previousFeedback: previousFeedback(feedbackPath, ids),
    captureSet: sha256(steps.map(step => `${step.id}:${step.prototype.image.sha256}:${step.actual.image.sha256}`).join('|')).slice(0, 16),
    steps,
    summary: {
      total: 43,
      prototype: steps.filter(s => s.prototype.image.available).length,
      actual: steps.filter(s => s.actual.image.available).length,
      passed: steps.filter(s => s.review.status === 'pass').length,
      knownIssues: steps.filter(s => s.verification.hasIssue).length,
      scenarioPending: steps.filter(s => s.verification.scenario.status === 'pending').length,
      aiPending: steps.filter(s => s.verification.aiPending).length,
      deviceOnly: steps.filter(s => s.verification.deviceOnly).length,
    },
  }
}

export function writeReport(options) {
  const report = buildReportData(options)
  const template = fs.readFileSync(path.join(templateDirectory, 'template.html'), 'utf8')
  const css = fs.readFileSync(path.join(templateDirectory, 'review.css'), 'utf8')
  const client = fs.readFileSync(path.join(templateDirectory, 'review.js'), 'utf8')
  const json = JSON.stringify(report).replaceAll('<', '\\u003c')
  const html = template.replace('/*__STYLES__*/', css).replace('/*__REPORT_DATA__*/', json).replace('/*__CLIENT__*/', client)
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })
  fs.writeFileSync(options.outputPath, html)
  return { output: options.outputPath, bytes: Buffer.byteLength(html), ...report.summary }
}

function optionsFromArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const [name, inlineValue] = args[index].split(/=(.*)/s)
    if (!['--manifest', '--evidence', '--feedback', '--out'].includes(name)) {
      throw new Error(`未知参数：${name}`)
    }
    const value = inlineValue ?? args[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`缺少参数值：${name}`)
    }
    options[name.slice(2)] = path.resolve(value)
  }
  if (!options.manifest || !options.out) {
    throw new Error('用法：node build-report.mjs --manifest <json> [--evidence <json>] [--feedback <json>] --out <html>')
  }
  return { manifestPath: options.manifest, evidencePath: options.evidence, feedbackPath: options.feedback, outputPath: options.out }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(writeReport(optionsFromArgs(process.argv.slice(2)))))
}
