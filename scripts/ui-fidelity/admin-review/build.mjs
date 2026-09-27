#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const text = value => String(value ?? '').replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]').replace(/\bwx[a-f0-9]{16}\b/gi, '[应用标识]').replace(/\/(?:Users|home|var)\/[^\s，。；"']+/g, '[本地记录]')
const list = value => Array.isArray(value) ? value.map(text) : []
function json(file) {
  if (/private/i.test(path.basename(file))) {
    throw new Error('禁止读取 private 输入')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function buildAdminReview({ checklistPath, capturesPath, outputPath }) {
  const checklist = json(checklistPath)
  const captureDocument = json(capturesPath)
  const items = checklist.items || checklist.steps || []
  const captures = Array.isArray(captureDocument) ? captureDocument : captureDocument.captures || []
  if (!items.length || !Array.isArray(captures)) {
    throw new Error('需要非空 checklist.items 和 captures 数组')
  }
  const destination = path.resolve(outputPath, 'admin')
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) {
    throw new Error('out/admin 必须为空；不覆盖已发布验收意见对应的旧内容')
  }
  const assets = new Map()
  const ids = new Set()
  const steps = items.map((item, index) => {
    const id = text(item.id || `A${index + 1}`)
    if (ids.has(id)) {
      throw new Error(`重复步骤 ID: ${id}`)
    }
    ids.add(id)
    const matching = captures.filter(capture => capture.id === item.id || (capture.route && capture.route === item.route))
    return {
      id,
      title: text(item.title || item.name || item.route || id),
      route: text(item.route),
      requirements: list(item.requirements || item.checks),
      notes: text(item.notes),
      captures: matching.map((capture) => {
        const mode = ['demo-visual', 'real-read', 'real-write'].includes(capture.mode) ? capture.mode : 'unverified'
        let status = ['pass', 'fail', 'pending'].includes(capture.status) ? capture.status : 'pending'
        let image = null
        let publicationNote = '截图缺失或尚未完成公开审核。'
        if (capture.image && capture.approved === true) {
          if (!/^[a-f0-9]{64}$/i.test(capture.sha256 || '')) {
            throw new Error(`${id} 缺少有效的审核 SHA256`)
          }
          const source = path.resolve(path.dirname(capturesPath), capture.image)
          const extension = path.extname(source).toLowerCase()
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
            throw new Error(`${id} 不支持该图片格式`)
          }
          const bytes = fs.readFileSync(source)
          if (sha(bytes) !== capture.sha256.toLowerCase()) {
            throw new Error(`${id} 截图 SHA256 与审核记录不一致`)
          }
          image = `assets/${capture.sha256.toLowerCase()}${extension}`
          assets.set(image, bytes)
          publicationNote = ''
        }
        const operations = list(capture.operations)
        if (!image || mode === 'unverified' || (status === 'pass' && !operations.length)) {
          status = 'pending'
        }
        // A demo screenshot can be reviewed, but cannot prove live reads or writes.
        if (mode === 'demo-visual' && status === 'pass') {
          status = 'demo-reviewed'
        }
        return {
          title: text(capture.title || ''),
          image,
          sha256: image ? capture.sha256.toLowerCase() : null,
          mode,
          status,
          notes: text(capture.notes),
          operations,
          capturedAt: text(capture.capturedAt),
          viewport: typeof capture.viewport === 'string' ? text(capture.viewport) : [capture.viewport?.width, capture.viewport?.height].every(Number.isFinite) ? `${capture.viewport.width} × ${capture.viewport.height}` : '视口未记录',
          publicationNote,
        }
      }),
    }
  })
  const report = {
    title: text(checklist.title || 'MIP 管理后台验收'),
    generatedAt: text(captureDocument.generatedAt || new Date().toISOString()),
    steps,
  }
  const payload = JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const html = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8').replace(/\/\*REPORT_JSON\*\/\s*null/, payload)
  fs.mkdirSync(path.join(destination, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(destination, 'index.html'), html)
  for (const file of ['review.js', 'review.css']) {
    fs.copyFileSync(new URL(`./${file}`, import.meta.url), path.join(destination, file))
  }
  for (const [file, bytes] of assets) {
    fs.writeFileSync(path.join(destination, file), bytes)
  }
  const summary = { pages: steps.length, publishedImages: assets.size, missingScreenshots: steps.filter(step => !step.captures.some(capture => capture.image)).length, output: destination }
  fs.writeFileSync(path.join(destination, 'build-summary.json'), `${JSON.stringify({ ...summary, output: 'admin/' }, null, 2)}\n`)
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, values) => index % 2 ? entries : [...entries, [value.replace(/^--/, ''), values[index + 1]]], []))
  if (!args.checklist || !args.captures || !args.out) {
    throw new Error('用法: build.mjs --checklist checklist.json --captures captures.public.json --out output-directory')
  }
  console.log(JSON.stringify(buildAdminReview({ checklistPath: args.checklist, capturesPath: args.captures, outputPath: args.out }), null, 2))
}
