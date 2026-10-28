import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { optimizeAcceptanceImages } from './lib/acceptance-images.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'docs/mip/acceptance-site')
const registryPath = path.join(source, 'reports.json')
const lockPath = path.join(source, 'frozen.json')
const out = path.join(root, '.tmp/mip-acceptance-site')
const reports = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
const locks = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : {}
const sha = value => createHash('sha256').update(value).digest('hex')
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c])
const dailySummaryPath = path.join(source, 'daily-summaries.json')
const dailySummaries = fs.existsSync(dailySummaryPath) ? JSON.parse(fs.readFileSync(dailySummaryPath, 'utf8')) : {}
function input(relative) {
  const full = path.resolve(root, relative)
  if (!full.startsWith(path.join(root, 'docs/mip/')) || !fs.statSync(full).isFile()) {
    throw new Error(`Invalid public evidence path: ${relative}`)
  }
  return full
}
function referenced(report) {
  return [...new Set([...(report.files || []), ...(report.originalFeedback?.images || []).map(item => item.file), ...(report.roleIcons || []).flatMap(icon => [icon.file, icon.tagFile].filter(Boolean)), ...(report.downloads || []).map(item => item.file), ...[report.prototypePreview?.file].filter(Boolean), ...(report.comparisons || []).flatMap(item => [item.before?.file, item.after?.file, item.prototype?.file, ...(item.references || []).map(ref => ref.file)].filter(Boolean)), ...(report.evidenceImages || []).map(item => item.file), ...(report.sections || []).flatMap(referenced)])].sort()
}
function fingerprint(report) {
  return sha(JSON.stringify({ report, files: referenced(report).map(file => [file, sha(fs.readFileSync(input(file)))]) }))
}
// Published snapshots retain their original bytes, including older prototype labels.
const legacySource = path.join(source, 'legacy')
if (fs.existsSync(legacySource)) {
  for (const entry of fs.readdirSync(legacySource, { withFileTypes: true })) {
    const folder = path.join(legacySource, entry.name)
    const manifest = path.join(folder, 'archive.json')
    if (!entry.isDirectory() || !fs.existsSync(manifest)) {
      continue
    }
    const archive = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    for (const [file, expected] of Object.entries({ 'index.html': archive.htmlSha256, ...archive.assets })) {
      const full = path.resolve(folder, file)
      if (!full.startsWith(`${folder}/`) || fs.lstatSync(full).isSymbolicLink() || sha(fs.readFileSync(full)) !== expected) {
        throw new Error(`Archived review changed: ${entry.name}/${file}`)
      }
    }
  }
}
const ids = new Set()
for (const report of reports) {
  if (!/^[a-z0-9-]+$/.test(report.id) || ids.has(report.id)) {
    throw new Error('Invalid or duplicate report id')
  }
  ids.add(report.id)
  for (const field of ['createdAt', 'updatedAt', 'verifiedAt', 'submittedAt', 'commitAt']) {
    if (!Number.isFinite(Date.parse(report[field]))) {
      throw new TypeError(`Missing timestamp: ${field}`)
    }
  }
  if (!['draft', 'final'].includes(report.status) || !report.title || !report.version || !report.commit || (!report.comparisons.length && report.uiChange !== false)) {
    throw new Error('Incomplete report')
  }
  if (report.reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate)) {
    throw new Error('Invalid original report date')
  }
  if (report.previousVersion && !reports.some(r => r.id === report.previousVersion && r.requirement === report.requirement)) {
    throw new Error('Missing preceding version')
  }
  for (const c of [report, ...(report.sections || [])].flatMap(item => item.comparisons || [])) {
    for (const key of ['before', 'after', ...(c.prototype ? ['prototype'] : [])]) {
      if (!c[key]?.caption || (!c[key].file && !c[key].reason)) {
        throw new Error('Missing comparison evidence or honest limitation')
      }
    }
  }
  if (report.status === 'final' && locks[report.id] !== fingerprint(report)) {
    throw new Error(`Frozen report changed or missing lock: ${report.id}`)
  }
  if (report.status !== 'final' && locks[report.id]) {
    throw new Error('A frozen report cannot become draft')
  }
}
if (process.argv[2] === 'freeze') {
  const report = reports.find(r => r.id === process.argv[3])
  if (!report || report.status !== 'draft') {
    throw new Error('Select an existing draft report')
  }
  report.status = 'final'
  report.frozenAt = new Date().toISOString()
  locks[report.id] = fingerprint(report)
  fs.writeFileSync(registryPath, `${JSON.stringify(reports, null, 2)}\n`)
  fs.writeFileSync(lockPath, `${JSON.stringify(locks, null, 2)}\n`)
  console.log('Frozen:', report.id)
  process.exit(0)
}
if (!['build', 'publish'].includes(process.argv[2])) {
  throw new Error('Use build, publish or freeze <id>')
}
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.cpSync(path.join(root, 'scripts/acceptance-reader'), path.join(out, 'assets/acceptance-reader'), { recursive: true })
const css = `*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#20242a;font:16px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:1400px;margin:auto;padding:32px}h1{font-size:clamp(25px,4vw,40px);line-height:1.3}h2{margin:40px 0 16px}a{color:#175cd3}p{margin:10px 0}.muted,dt{color:#657080;font-size:14px}.card,.panel{background:white;border:1px solid #dce1e8;border-radius:14px;padding:22px;margin:16px 0}.tag{display:inline-block;padding:3px 10px;border-radius:6px;background:#e9eef5;font-size:13px}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.columns .panel{margin:0;padding:16px;min-width:0}.columns img{display:block;width:100%;max-width:420px;height:auto;margin:16px auto;border:1px solid #e1e5eb}.columns img.wide{max-width:none}.placeholder{padding:32px 12px;border:1px dashed #b4bbc7;color:#657080}dl{display:grid;grid-template-columns:100px 1fr;gap:4px 16px}dd{margin:0;min-width:0}nav{display:flex;gap:18px;flex-wrap:wrap}.note{border-left:4px solid #b58212;background:#fff7e5;padding:16px}li{margin:5px 0}@media(max-width:700px){main{padding:18px}.columns{grid-template-columns:1fr}.card{padding:18px}dl{grid-template-columns:1fr;gap:0}dd{margin-bottom:10px}}`
const timelineCss = `a{text-underline-offset:4px}a:focus-visible{outline:3px solid #175cd3;outline-offset:5px}body{background:#f7f9fb;color:#223044}main{max-width:1180px;padding:48px 40px 64px}.home-intro{padding:12px 0 42px;border-bottom:1px solid #dce1e8}.site-name{color:#245eb5;font-size:15px;font-weight:650}.home-intro h1{margin:20px 0 12px;font-size:clamp(32px,5vw,48px);letter-spacing:-1px}.lead{font-size:20px;color:#47566b}.timeline{margin-top:40px}.timeline-day{display:grid;grid-template-columns:150px minmax(0,1fr);gap:32px;margin-bottom:36px}.timeline-date{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding-top:20px}.timeline-date time{font-size:25px;font-weight:700;line-height:1.3}.timeline-date span{color:#6b7789;font-size:14px}.timeline-date b{margin-top:10px;color:#245eb5;background:#e8effb;border-radius:4px;padding:2px 8px;font-size:12px}.day-content{position:relative;border-left:2px solid #c6d6ec;padding:16px 0 24px 32px}.day-content:before{content:"";position:absolute;width:12px;height:12px;left:-7px;top:28px;background:#245eb5;border:3px solid #f7f9fb;border-radius:50%}.day-heading{display:flex;align-items:center;gap:14px}.day-heading h2{font-size:20px;margin:0}.update-list{list-style:none;margin:8px 0 24px;padding:0}.update-list li{padding:19px 0;margin:0;border-bottom:1px solid #e1e7ef}.update-list a{font-size:18px;color:#223044;font-weight:650;text-decoration:none}.update-list a:hover{color:#175cd3;text-decoration:underline}.update-list p{font-size:15px;color:#5a697c;margin:7px 0 0;max-width:68ch;line-height:1.8}.day-link{display:inline-block;background:#245eb5;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none}.timeline-note{margin:32px 0}.history{border-top:1px solid #dce1e8;padding-top:24px}.history h2{font-size:18px;margin:0 0 12px}.history a{display:block;margin:8px 0;font-size:14px}.day-intro{margin:32px 0}.day-intro h1{margin:12px 0}.day-nav{margin:24px 0 32px;gap:10px 24px}.daily-item{scroll-margin-top:24px}.daily-item h2{margin:6px 0 18px;font-size:24px}.pending{padding:14px 16px;background:#f5f7fa;color:#566376;font-size:14px;border-radius:6px}.pending b{display:block;color:#37465b}.detail-link{display:inline-block;margin-top:12px;font-weight:600}@media(max-width:700px){main{padding:28px 20px 40px}.home-intro{padding:0 0 28px}.lead{font-size:18px}.timeline{margin-top:28px}.timeline-day{grid-template-columns:1fr;gap:12px}.timeline-date{flex-direction:row;align-items:center;padding:0;gap:12px}.timeline-date time{font-size:23px}.timeline-date b{margin:0 0 0 auto}.day-content{padding:8px 0 20px 20px}.day-content:before{top:19px}.update-list a{font-size:17px}.update-list p{font-size:14px}.day-link{display:block;text-align:center}.daily-item h2{font-size:22px}}`

const compactCss = `.role-gallery{margin:28px 0}.role-gallery h3{font-size:19px}.role-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;list-style:none!important;padding:0!important}.role-grid li{display:grid;justify-items:start;gap:10px;background:white;border:1px solid #dce1e8;border-radius:8px;padding:16px;margin:0}.icon-mark{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:8px;background:#252525}.icon-mark img{width:40px;height:40px}.role-grid a{font-size:13px}.prototype-preview{margin:24px 0}.prototype-preview img{display:block;width:100%;max-width:800px;border-radius:8px}.prototype-preview figcaption{font-size:14px;color:#657080;margin-top:10px}.downloads{display:flex;gap:16px;flex-wrap:wrap}@media(max-width:700px){.role-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.columns.two-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.entry-title{margin:0 0 12px;font-size:25px;line-height:1.5;text-wrap:balance}.entry-title a{color:#223044;text-decoration:none}.entry-title a:hover{text-decoration:underline;color:#175cd3}.entry-summary{color:#5a697c;max-width:64ch}.compact-section{padding:22px 0;border-top:1px solid #dce1e8;scroll-margin-top:20px}.compact-section h2{font-size:22px;margin:0 0 12px;text-wrap:balance}.compact-section ul{margin:0;padding-left:22px}.evidence{margin-top:16px}.evidence summary{cursor:pointer;color:#175cd3;width:fit-content}.evidence[open]{padding-bottom:12px}.evidence .columns{margin:16px 0}.evidence h3{font-size:18px}.pending h2{font-size:19px;margin:0 0 8px}.pending ul{margin:0;padding-left:20px}.day-intro{margin:32px 0}.day-content{padding-top:18px}@media(max-width:700px){.columns.two-columns{grid-template-columns:1fr}.entry-title{font-size:22px}.compact-section h2{font-size:20px}.day-content{padding-top:8px}}`

const featureCss = `.feature-section{padding:12px 0 22px;scroll-margin-top:24px}.feature-section h3{font-size:20px;margin:12px 0}.evidence h4{font-size:17px;margin:20px 0 8px}.columns.historical-columns{grid-template-columns:repeat(4,minmax(0,1fr))}.catalog{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}.catalog th,.catalog td{padding:12px;border-bottom:1px solid #dce1e8;text-align:left;vertical-align:top}.catalog th{width:25%}@media(max-width:900px){.columns.historical-columns{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.columns.historical-columns{grid-template-columns:1fr}.catalog th,.catalog td{padding:10px 6px}.catalog th{width:32%}}`
const readerVersion = sha(['reader.js', 'reader.css'].map(file => fs.readFileSync(path.join(root, 'scripts/acceptance-reader', file))).join('\n')).slice(0, 16)
function shell(title, body, reader = false) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · MIP 验收</title><style>${css}${timelineCss}${compactCss}${featureCss}</style>${reader ? `<link rel="stylesheet" href="/assets/acceptance-reader/reader.css?v=${readerVersion}"><script src="/assets/acceptance-reader/reader.js?v=${readerVersion}" defer></script>` : ''}</head><body><main${reader ? ' class="reader-page"' : ''}>${body}</main></body></html>`
}
const asset = file => `/${file.replace(/^docs\/mip\/acceptance-site\/legacy\/20261019\//, 'updates/2026-10-19/assets/').replace(/^docs\/mip\/acceptance-site\/legacy\//, 'legacy/').replace(/^docs\/mip\//, '')}`
const dimensions = new Map()
function imageDimensions(file) {
  if (!dimensions.has(file)) {
    const bytes = fs.readFileSync(input(file))
    dimensions.set(file, bytes.length >= 24 && bytes[0] === 137 && bytes.subarray(1, 4).toString() === 'PNG' ? ` width="${bytes.readUInt32BE(16)}" height="${bytes.readUInt32BE(20)}"` : '')
  }
  return dimensions.get(file)
}
function circleAttributes(cell) {
  if (!cell.circles?.length) {
    return ''
  }
  if (!Array.isArray(cell.circles) || cell.circles.length > 10 || cell.circles.some(c => ![c.x, c.y, c.width, c.height].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x + c.width > 100 || c.y + c.height > 100)) {
    throw new Error('Invalid screenshot circle coordinates')
  }
  return ` data-image-circles="${escape(JSON.stringify(cell.circles))}"`
}
const panel = (cell, label) => `<section class="panel"><b>${label}</b><p>${escape(cell.caption)}</p>${cell.file ? `<button type="button" class="image-preview-button" aria-haspopup="dialog"><img loading="lazy"${imageDimensions(cell.file)}${circleAttributes(cell)} data-full-src="${escape(asset(cell.file))}" src="${escape(asset(cell.file))}" alt="${escape(cell.caption)}"></button><noscript><a href="${escape(asset(cell.file))}">查看原图</a></noscript>` : `<p class="placeholder">${escape(cell.reason)}</p>`}${cell.source ? `<p class="muted">来源：${escape(cell.source)}</p>` : ''}</section>`
const highlights = report => (report.highlights?.length ? report.highlights : [report.summary]).filter(Boolean)
const comparisonId = (report, comparison) => `${report.id}-view-${sha(comparison.title).slice(0, 8)}`
const visibleComparisons = report => report.uiChange === false ? [] : (report.comparisons || []).filter(c => c.before.file || c.after.file)
const heading = (level, title, id) => `<div class="section-heading"><h${level}>${escape(title)}</h${level}><a class="permalink" href="#${escape(id)}" data-copy-link aria-label="复制${escape(title)}的链接">复制链接</a></div>`
function contents(report) {
  const entries = report.sections?.length
    ? report.sections.flatMap(section => [{ id: section.id, title: section.title }, ...contents(section)])
    : visibleComparisons(report).map(c => ({ id: comparisonId(report, c), title: c.title, nested: true }))
  if (report.roleIcons?.length) {
    entries.push({ id: 'role-icons', title: '六枚角色图标与原稿' })
  }
  if (report.catalog) {
    entries.push({ id: 'catalog', title: '完整行业目录' })
  }
  return entries
}
function readerLayout(items, body, label) {
  const entries = items.flatMap(report => [{ id: report.id, title: report.indexTitle || report.title }, ...contents(report).filter(entry => !report.sections?.length || !entry.nested)])
  entries.push({ id: 'pending', title: '待确认与复测' })
  const anchors = [...items.flatMap(report => [report.id, ...contents(report).map(entry => entry.id)]), 'pending']
  if (new Set(anchors).size !== anchors.length || anchors.some(id => typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id))) {
    throw new Error('Duplicate or invalid reader anchor')
  }
  const sidebar = `<aside class="reader-sidebar"><a class="reader-home" href="/">返回验收记录</a><p class="toc-label">${escape(label)} · 目录</p><label class="mobile-toc">跳转到<select aria-label="跳转到验收项">${entries.map(entry => `<option value="${escape(entry.id)}">${entry.nested ? '　' : ''}${escape(entry.title)}</option>`).join('')}</select></label><nav class="reader-toc" aria-label="本页目录">${entries.map(entry => `<a href="#${escape(entry.id)}" data-toc-link${entry.nested ? ' class="toc-child"' : ''}>${escape(entry.title)}</a>`).join('')}</nav></aside>`
  return `<a class="skip-reader" href="#reader-content">跳到验收正文</a><div class="reader-layout" data-reader>${sidebar}<div class="reader-content" id="reader-content" tabindex="-1">${body}</div></div><p class="reader-status" role="status" aria-live="polite" hidden></p>`
}
function comparisons(report) {
  if (report.uiChange === false) {
    return ''
  }
  const visible = visibleComparisons(report)
  if (!visible.length && !report.evidenceImages?.length) {
    return ''
  }
  return `<div class="evidence">${visible.map(c => `<section class="comparison" id="${escape(comparisonId(report, c))}">${heading(4, c.title.startsWith(`${report.title} ·`) ? '画面对照' : c.title, comparisonId(report, c))}<p class="muted">${escape(c.context)}</p><p class="comparison-tip">左右滑动查看对照，点击图片查看原图</p><div class="columns${c.references?.length ? ' historical-columns' : c.prototype?.file ? '' : ' two-columns'}" tabindex="0" role="group" aria-label="${escape(c.title)}画面对照">${panel(c.before, '修改前')}${panel(c.after, '修改后')}${c.prototype?.file ? panel(c.prototype, '权威原型') : ''}${(c.references || []).map(ref => panel(ref, escape(ref.label))).join('')}</div></section>`).join('')}${report.evidenceImages?.length ? `<div class="columns two-columns" tabindex="0" role="group" aria-label="${escape(report.evidenceTitle || '补充实拍')}">${report.evidenceImages.map(item => panel(item, escape(report.evidenceTitle || '补充实拍'))).join('')}</div>` : ''}</div>`
}
function reportContent(report) {
  const feedback = report.originalFeedback
  const feedbackImages = feedback?.images || []
  const original = feedback?.quotes?.length || feedbackImages.length ? `<details class="original-feedback"><summary>原始反馈${feedbackImages.length ? ` · ${feedbackImages.length}张截图` : ''}</summary><div class="original-feedback-content">${(feedback.quotes || []).map(quote => `<blockquote>${escape(quote)}</blockquote>`).join('')}${feedback.note ? `<p class="muted">${escape(feedback.note)}</p>` : ''}${feedbackImages.length ? `<div class="feedback-images">${feedbackImages.map(item => panel(item, '原始反馈截图')).join('')}</div>` : ''}</div></details>` : ''
  const icons = report.roleIcons?.length ? `<section class="role-gallery" id="role-icons">${heading(3, '六枚角色图标与原稿', 'role-icons')}<ul class="role-grid">${report.roleIcons.map(icon => `<li><span class="icon-mark"><img src="${escape(asset(icon.file))}" alt="${escape(icon.label)}图标"></span><b>${escape(icon.label)}</b><div><a href="${escape(asset(icon.file))}">图标 SVG</a>${icon.tagFile ? ` <a href="${escape(asset(icon.tagFile))}">完整标签</a>` : ''}</div></li>`).join('')}</ul></section>` : ''
  const preview = report.prototypePreview ? `<figure class="prototype-preview"><img${imageDimensions(report.prototypePreview.file)} data-full-src="${escape(asset(report.prototypePreview.file))}" src="${escape(asset(report.prototypePreview.file))}" alt="${escape(report.prototypePreview.caption)}"><figcaption>${escape(report.prototypePreview.caption)}${report.prototypePreview.source ? ` · <a href="${escape(report.prototypePreview.source)}" target="_blank" rel="noopener">查看原型来源</a>` : ''}</figcaption></figure>` : ''
  const downloads = report.downloads?.length ? `<p class="downloads">${report.downloads.map(d => `<a href="${escape(asset(d.file))}">${escape(d.label)}</a>`).join(' ')}</p>` : ''
  const related = report.relatedReports?.length
    ? `<p class="downloads">${report.relatedReports.map((id) => {
      const target = reports.find(item => item.id === id)
      if (!target) {
        throw new Error(`Unknown related report: ${id}`)
      }
      return `<a href="/reports/${escape(target.id)}/">${escape(target.indexTitle || target.title)}</a>`
    }).join(' ')}</p>`
    : ''
  const sections = (report.sections || []).map(section => `<section class="feature-section" id="${escape(section.id)}">${heading(3, section.title, section.id)}${reportContent(section)}</section>`).join('')
  const catalog = report.catalog ? `<section class="evidence" id="catalog">${heading(3, '完整行业目录（11类、121项）', 'catalog')}<p class="muted">${escape(report.catalog.caption)}</p><table class="catalog"><thead><tr><th>分类</th><th>可选行业</th></tr></thead><tbody>${report.catalog.rows.map(row => `<tr><th scope="row">${escape(row[0])}</th><td>${escape(row[1])}</td></tr>`).join('')}</tbody></table></section>` : ''
  const points = highlights(report)
  return `${points.length ? `<ul>${points.map(h => `<li>${escape(h)}</li>`).join('')}</ul>` : ''}${original}${sections}${icons}${preview}${downloads}${related}${comparisons(report)}${catalog}`
}
function feedbackSources(items) {
  const urls = [...new Set(items.map(item => item.feedbackSource?.url).filter(url => /^https:\/\/zhihui-ai\.feishu\.cn\//.test(url || '')))]
  return urls.length ? `<div class="feedback-sources"><span>甲方原始反馈</span>${urls.map(url => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">查看飞书文档</a>`).join('')}</div>` : ''
}
for (const report of reports) {
  for (const file of referenced(report)) {
    const dest = path.join(out, asset(file).slice(1))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(input(file), dest)
  }
  // Preserve existing report URLs. The daily page is the public reading entry.
  const details = `${feedbackSources([report])}<section id="${escape(report.id)}">${heading(1, report.indexTitle || report.title, report.id)}${reportContent(report)}</section><section class="pending" id="pending">${heading(2, '待确认与复测', 'pending')}<p>${escape(report.pendingSummary || report.limitations)}</p></section>${report.previousVersion ? `<p><a href="../${escape(report.previousVersion)}/">查看上一版本</a></p>` : ''}`
  const dest = path.join(out, 'reports', report.id)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'index.html'), shell(report.title, readerLayout([report], details, '验收详情'), true))
}
const sorted = [...reports].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id))
const dayKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const dayLabel = day => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`
const days = new Map()
for (const report of sorted) {
  const key = report.reportDate || dayKey(report.updatedAt)
  if (!days.has(key)) {
    days.set(key, [])
  }
  days.get(key).push(report)
}
const dayEntries = [...days].sort(([a], [b]) => b.localeCompare(a))
function dayBrief(day, digest) {
  if (!digest.goals?.length && !digest.acceptance?.length) {
    return ''
  }
  const goals = digest.goals?.length ? `<section id="goals-${day}"><h2>今天要实现的目标</h2>${digest.request ? `<blockquote>${escape(digest.request)}</blockquote>` : ''}<ul>${digest.goals.map(goal => `<li>${escape(goal)}</li>`).join('')}</ul></section>` : ''
  return `${goals}<h2>实现结果与证据</h2>`
}
function dayAcceptance(day, digest) {
  return digest.acceptance?.length ? `<section id="acceptance-${day}"><h2>验收标准与结果</h2><table><thead><tr><th>验收标准</th><th>验收结果</th></tr></thead><tbody>${digest.acceptance.map(item => `<tr><td>${escape(item.criterion)}</td><td>${escape(item.result)}</td></tr>`).join('')}</tbody></table></section>` : ''
}
const history = `<aside class="history"><h2>历史资料</h2><a href="/legacy/20260927/">9月27日逐页验收快照</a></aside>`
for (const [day, items] of dayEntries) {
  const digest = dailySummaries[day] || {}
  const selected = digest.reportIds
    ? digest.reportIds.map((id) => {
        const report = items.find(item => item.id === id)
        if (!report) {
          throw new Error(`Missing daily report: ${day}/${id}`)
        }
        return report
      })
    : items
  const pending = digest.pending || selected.map(r => r.pendingSummary || r.limitations)
  const otherUpdates = [digest.otherUpdates].flat().filter(Boolean)
  const body = `<header class="day-intro"><p class="muted">${escape(day)}</p><h1>${escape(digest.title || `${dayLabel(day)}更新与验收`)}</h1>${digest.summary ? `<p>${escape(digest.summary)}</p>` : ''}${feedbackSources(selected)}</header>${dayBrief(day, digest)}${selected.map(r => `<section class="compact-section" id="${escape(r.id)}">${heading(2, r.indexTitle || r.title, r.id)}${reportContent(r)}</section>`).join('')}${dayAcceptance(day, digest)}<section class="pending" id="pending">${heading(2, '待确认与复测', 'pending')}<ul>${[...new Set(pending)].map(p => `<li>${escape(p)}</li>`).join('')}</ul></section>${otherUpdates.length ? `<section class="other-updates"><h2>其他改进</h2><ul>${otherUpdates.map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>` : ''}`
  const dest = path.join(out, 'updates', day)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'index.html'), shell(`${day} 验收`, readerLayout(selected, body, dayLabel(day)), true))
}
const timeline = dayEntries.map(([day, items], index) => {
  const digest = dailySummaries[day] || {}
  return `<article class="timeline-day"><div class="timeline-date"><time datetime="${day}">${escape(dayLabel(day))}</time><span>${escape(day.slice(0, 4))}</span>${index === 0 ? '<b>最近更新</b>' : ''}</div><div class="day-content"><h2 class="entry-title"><a href="/updates/${day}/">${escape(digest.title || `${dayLabel(day)}更新与验收`)}</a></h2><p class="entry-summary">${escape(digest.summary || items.map(r => r.indexTitle || r.title).join('；'))}</p></div></article>`
}).join('')
fs.writeFileSync(path.join(out, 'index.html'), shell('验收记录', `<header class="home-intro"><p class="site-name">MIP 测试与验收</p><h1>更新与验收记录</h1><p class="lead">每天一条，查看主要改动与验证结果。</p></header><div class="timeline">${timeline || '<p>暂时没有更新记录。</p>'}</div>${history}`))
const legacy = path.join(source, 'legacy')
if (fs.existsSync(legacy)) {
  for (const entry of fs.readdirSync(legacy)) {
    if (entry === '20261019') {
      const folder = path.join(legacy, entry)
      const archive = JSON.parse(fs.readFileSync(path.join(folder, 'archive.json'), 'utf8'))
      for (const file of Object.keys(archive.assets)) {
        const dest = path.join(out, 'updates/2026-10-19/assets', file)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(path.join(folder, file), dest)
      }
    }
    else {
      fs.cpSync(path.join(legacy, entry), path.join(out, 'legacy', entry), { recursive: true })
    }
  }
}
const imageStats = await optimizeAcceptanceImages(out)
console.log('Image previews:', imageStats.optimized, '/', imageStats.images, imageStats.originalBytes, '→', imageStats.previewBytes, 'bytes')
fs.writeFileSync(path.join(out, '_redirects'), '/legacy/20261019/role-icons/* /updates/2026-10-19/assets/role-icons/:splat 301\n/legacy/20261019/shots/* /updates/2026-10-19/assets/shots/:splat 301\n/legacy/20261019/robots.txt /updates/2026-10-19/assets/robots.txt 301\n/legacy/20261019 /updates/2026-10-19/ 301\n/legacy/20261019/* /updates/2026-10-19/ 301\n')
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-cache\n')
fs.writeFileSync(path.join(out, 'reports.json'), `${JSON.stringify(sorted, null, 2)}\n`)
console.log('Built acceptance site:', reports.length, 'reports')
if (process.argv[2] === 'publish') {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'pages', 'deploy', out, '--project-name=miptest', '--branch=main', '--commit-dirty=true'], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    throw new Error('Pages deployment failed; read back actual deployment before retry')
  }
}
