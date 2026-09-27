#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const text = value => String(value ?? '').replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]').replace(/\bwx[a-f0-9]{16}\b/gi, '[应用标识]').replace(/\/(?:Users|home|var)\/[^\s，。；"']+/g, '[本地记录]')
const list = value => Array.isArray(value) ? value.map(text) : []
function json(file) {
  if (/private/i.test(path.basename(file))) {
    throw new Error('禁止读取 private 输入')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function buildAdminReview({ checklistPath, capturesPath, outputPath, prototypeHtmlPath, prototypeMapPath = fileURLToPath(new URL('./prototype-map.json', import.meta.url)) }) {
  const checklist = json(checklistPath)
  const captureDocument = json(capturesPath)
  const prototypeMap = json(prototypeMapPath)
  const items = checklist.items || checklist.steps || []
  const captures = Array.isArray(captureDocument) ? captureDocument : captureDocument.captures || []
  if (!items.length || !Array.isArray(captures)) {
    throw new Error('需要非空 checklist.items 和 captures 数组')
  }
  const destination = path.resolve(outputPath, 'admin')
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) {
    throw new Error('out/admin 必须为空；不覆盖已发布验收意见对应的旧内容')
  }
  let publishedPrototypePath = null
  const prototypeSource = prototypeMap.source
  if (prototypeHtmlPath) {
    const sourcePath = path.resolve(prototypeHtmlPath)
    if (path.basename(sourcePath) !== prototypeSource.filename) {
      throw new Error(`原型文件名与映射清单不符: ${prototypeSource.filename}`)
    }
    const original = fs.readFileSync(sourcePath)
    if (sha(original) !== prototypeSource.sha256) {
      throw new Error('原型 HTML SHA256 与映射清单不一致')
    }
    let html = original.toString('utf8')
    // Workbuddy's V0.4 mock account list contains phone-shaped sample values.
    // Keep the source immutable and mask those values in the published copy.
    html = html.replace(/\b1[3-9]\d{9}\b/g, '1**********')
    const prototypeRouteInit = 'let open=[\'dashboard\'],active=\'dashboard\',expandedGroups='
    if (html.split(prototypeRouteInit).length !== 2) {
      throw new Error('无法在已校验的原型 HTML 中定位页面初始化逻辑')
    }
    html = html.replace(prototypeRouteInit, 'const initialPage = new URLSearchParams(location.search).get(\'page\') || \'dashboard\';let open=[initialPage],active=initialPage,expandedGroups=')
    html = html.replace('</body>', '<script>document.body.classList.add("prd-hidden")</script></body>')
    publishedPrototypePath = 'prototypes/workbuddy-v0.4.html'
    fs.mkdirSync(path.join(destination, 'prototypes'), { recursive: true })
    fs.writeFileSync(path.join(destination, publishedPrototypePath), html)
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
      prototype: prototypeMap.pages?.[item.id] && publishedPrototypePath
        ? {
            title: text(prototypeMap.pages[item.id].title),
            sourceTitle: text(prototypeSource.title),
            src: `${publishedPrototypePath}?page=${encodeURIComponent(prototypeMap.pages[item.id].anchor)}`,
          }
        : null,
      prototypeUnavailableReason: text(
        prototypeMap.missing?.[item.id]
        || (prototypeMap.pages?.[item.id] ? '本次生成没有提供已校验的原型 HTML 文件。' : '没有找到与本页对应的原型画面。'),
      ),
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
  const reviewJs = fs.readFileSync(new URL('./review.js', import.meta.url))
  const reviewCss = fs.readFileSync(new URL('./review.css', import.meta.url))
  const reviewJsAsset = `review.${sha(reviewJs)}.js`
  const reviewCssAsset = `review.${sha(reviewCss)}.css`
  const html = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8')
    .replace(/\/\*REPORT_JSON\*\/\s*null/, payload)
    // Keep the report shell atomic across CDN/browser caches during deployment.
    .replace('<script src="/*REVIEW_JS_ASSET*/" defer></script>', () => `<script>${reviewJs.toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace('<link rel="stylesheet" href="/*REVIEW_CSS_ASSET*/" />', () => `<style>${reviewCss.toString('utf8')}</style>`)
  fs.mkdirSync(path.join(destination, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(destination, 'index.html'), html)
  fs.writeFileSync(path.join(destination, reviewJsAsset), reviewJs)
  fs.writeFileSync(path.join(destination, reviewCssAsset), reviewCss)
  for (const file of [reviewJsAsset, reviewCssAsset]) {
    if (!fs.existsSync(path.join(destination, file))) {
      throw new Error(`验收页资源引用缺失: ${file}`)
    }
  }
  for (const [file, bytes] of assets) {
    fs.writeFileSync(path.join(destination, file), bytes)
  }
  const summary = { pages: steps.length, publishedImages: assets.size, publishedPrototypes: publishedPrototypePath ? 1 : 0, missingScreenshots: steps.filter(step => !step.captures.some(capture => capture.image)).length, missingPrototypePages: steps.filter(step => !step.prototype).length, output: destination }
  fs.writeFileSync(path.join(destination, 'build-summary.json'), `${JSON.stringify({ ...summary, output: 'admin/' }, null, 2)}\n`)
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, values) => index % 2 ? entries : [...entries, [value.replace(/^--/, ''), values[index + 1]]], []))
  if (!args.checklist || !args.captures || !args.out) {
    throw new Error('用法: build.mjs --checklist checklist.json --captures captures.public.json --out output-directory')
  }
  console.log(JSON.stringify(buildAdminReview({ checklistPath: args.checklist, capturesPath: args.captures, outputPath: args.out, prototypeHtmlPath: args['prototype-html'], prototypeMapPath: args['prototype-map'] || undefined }), null, 2))
}
