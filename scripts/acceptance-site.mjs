import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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
  return [...new Set([...report.files, ...(report.roleIcons || []).flatMap(icon => [icon.file, icon.tagFile].filter(Boolean)), ...(report.downloads || []).map(item => item.file), ...[report.prototypePreview?.file, report.archive?.file].filter(Boolean), ...report.comparisons.flatMap(item => [item.before?.file, item.after?.file, item.prototype?.file].filter(Boolean))])].sort()
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
  for (const c of report.comparisons) {
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
const css = `*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#20242a;font:16px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:1400px;margin:auto;padding:32px}h1{font-size:clamp(25px,4vw,40px);line-height:1.3}h2{margin:40px 0 16px}a{color:#175cd3}p{margin:10px 0}.muted,dt{color:#657080;font-size:14px}.card,.panel{background:white;border:1px solid #dce1e8;border-radius:14px;padding:22px;margin:16px 0}.tag{display:inline-block;padding:3px 10px;border-radius:6px;background:#e9eef5;font-size:13px}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.columns .panel{margin:0;padding:16px;min-width:0}.columns img{display:block;width:100%;max-width:420px;height:auto;margin:16px auto;border:1px solid #e1e5eb}.columns img.wide{max-width:none}.placeholder{padding:32px 12px;border:1px dashed #b4bbc7;color:#657080}dl{display:grid;grid-template-columns:100px 1fr;gap:4px 16px}dd{margin:0;min-width:0}nav{display:flex;gap:18px;flex-wrap:wrap}.note{border-left:4px solid #b58212;background:#fff7e5;padding:16px}li{margin:5px 0}@media(max-width:700px){main{padding:18px}.columns{grid-template-columns:1fr}.card{padding:18px}dl{grid-template-columns:1fr;gap:0}dd{margin-bottom:10px}}`
const timelineCss = `a{text-underline-offset:4px}a:focus-visible{outline:3px solid #175cd3;outline-offset:5px}body{background:#f7f9fb;color:#223044}main{max-width:1180px;padding:48px 40px 64px}.home-intro{padding:12px 0 42px;border-bottom:1px solid #dce1e8}.site-name{color:#245eb5;font-size:15px;font-weight:650}.home-intro h1{margin:20px 0 12px;font-size:clamp(32px,5vw,48px);letter-spacing:-1px}.lead{font-size:20px;color:#47566b}.timeline{margin-top:40px}.timeline-day{display:grid;grid-template-columns:150px minmax(0,1fr);gap:32px;margin-bottom:36px}.timeline-date{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding-top:20px}.timeline-date time{font-size:25px;font-weight:700;line-height:1.3}.timeline-date span{color:#6b7789;font-size:14px}.timeline-date b{margin-top:10px;color:#245eb5;background:#e8effb;border-radius:4px;padding:2px 8px;font-size:12px}.day-content{position:relative;border-left:2px solid #c6d6ec;padding:16px 0 24px 32px}.day-content:before{content:"";position:absolute;width:12px;height:12px;left:-7px;top:28px;background:#245eb5;border:3px solid #f7f9fb;border-radius:50%}.day-heading{display:flex;align-items:center;gap:14px}.day-heading h2{font-size:20px;margin:0}.update-list{list-style:none;margin:8px 0 24px;padding:0}.update-list li{padding:19px 0;margin:0;border-bottom:1px solid #e1e7ef}.update-list a{font-size:18px;color:#223044;font-weight:650;text-decoration:none}.update-list a:hover{color:#175cd3;text-decoration:underline}.update-list p{font-size:15px;color:#5a697c;margin:7px 0 0;max-width:68ch;line-height:1.8}.day-link{display:inline-block;background:#245eb5;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none}.timeline-note{margin:32px 0}.history{border-top:1px solid #dce1e8;padding-top:24px}.history h2{font-size:18px;margin:0 0 12px}.history a{display:block;margin:8px 0;font-size:14px}.day-intro{margin:32px 0}.day-intro h1{margin:12px 0}.day-nav{margin:24px 0 32px;gap:10px 24px}.daily-item{scroll-margin-top:24px}.daily-item h2{margin:6px 0 18px;font-size:24px}.pending{padding:14px 16px;background:#f5f7fa;color:#566376;font-size:14px;border-radius:6px}.pending b{display:block;color:#37465b}.detail-link{display:inline-block;margin-top:12px;font-weight:600}@media(max-width:700px){main{padding:28px 20px 40px}.home-intro{padding:0 0 28px}.lead{font-size:18px}.timeline{margin-top:28px}.timeline-day{grid-template-columns:1fr;gap:12px}.timeline-date{flex-direction:row;align-items:center;padding:0;gap:12px}.timeline-date time{font-size:23px}.timeline-date b{margin:0 0 0 auto}.day-content{padding:8px 0 20px 20px}.day-content:before{top:19px}.update-list a{font-size:17px}.update-list p{font-size:14px}.day-link{display:block;text-align:center}.daily-item h2{font-size:22px}}`

const compactCss = `.role-gallery{margin:28px 0}.role-gallery h3{font-size:19px}.role-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;list-style:none!important;padding:0!important}.role-grid li{display:grid;justify-items:start;gap:10px;background:white;border:1px solid #dce1e8;border-radius:8px;padding:16px;margin:0}.icon-mark{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:8px;background:#252525}.icon-mark img{width:40px;height:40px}.role-grid a{font-size:13px}.prototype-preview{margin:24px 0}.prototype-preview img{display:block;width:100%;max-width:800px;border-radius:8px}.prototype-preview figcaption{font-size:14px;color:#657080;margin-top:10px}.downloads{display:flex;gap:16px;flex-wrap:wrap}.archive-link{display:inline-block;margin-top:14px}@media(max-width:700px){.role-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.columns.two-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.entry-title{margin:0 0 12px;font-size:25px;line-height:1.5;text-wrap:balance}.entry-title a{color:#223044;text-decoration:none}.entry-title a:hover{text-decoration:underline;color:#175cd3}.entry-summary{color:#5a697c;max-width:64ch}.compact-section{padding:22px 0;border-top:1px solid #dce1e8;scroll-margin-top:20px}.compact-section h2{font-size:22px;margin:0 0 12px;text-wrap:balance}.compact-section ul{margin:0;padding-left:22px}.evidence{margin-top:16px}.evidence summary{cursor:pointer;color:#175cd3;width:fit-content}.evidence[open]{padding-bottom:12px}.evidence .columns{margin:16px 0}.evidence h3{font-size:18px}.pending h2{font-size:19px;margin:0 0 8px}.pending ul{margin:0;padding-left:20px}.day-intro{margin:32px 0}.day-content{padding-top:18px}@media(max-width:700px){.columns.two-columns{grid-template-columns:1fr}.entry-title{font-size:22px}.compact-section h2{font-size:20px}.day-content{padding-top:8px}}`

function shell(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · MIP 验收</title><style>${css}${timelineCss}${compactCss}</style></head><body><main>${body}</main></body></html>`
}
const asset = file => `/${file.replace(/^docs\/mip\/acceptance-site\/legacy\//, 'legacy/').replace(/^docs\/mip\//, '')}`
const panel = (cell, label) => `<section class="panel"><b>${label}</b><p>${escape(cell.caption)}</p>${cell.file ? `<a href="${escape(asset(cell.file))}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(asset(cell.file))}" alt="${escape(cell.caption)}"></a>` : `<p class="placeholder">${escape(cell.reason)}</p>`}${cell.source ? `<p class="muted">来源：${escape(cell.source)}</p>` : ''}</section>`
const highlights = report => (report.highlights?.length ? report.highlights : [report.summary])
function comparisons(report) {
  if (report.uiChange === false) {
    return ''
  }
  const visible = report.comparisons.filter(c => c.before.file || c.after.file)
  if (!visible.length) {
    return ''
  }
  return `<details class="evidence"><summary>查看画面对照</summary>${visible.map(c => `<h3>${escape(c.title)}</h3><p class="muted">${escape(c.context)}</p><div class="columns${c.prototype?.file ? '' : ' two-columns'}">${panel(c.before, '修改前')}${panel(c.after, '修改后')}${c.prototype?.file ? panel(c.prototype, '权威原型') : ''}</div>`).join('')}</details>`
}
function reportContent(report) {
  const icons = report.roleIcons?.length ? `<section class="role-gallery" id="role-icons"><h3>六枚角色图标</h3><ul class="role-grid">${report.roleIcons.map(icon => `<li><span class="icon-mark"><img src="${escape(asset(icon.file))}" alt="${escape(icon.label)}图标"></span><b>${escape(icon.label)}</b><div><a href="${escape(asset(icon.file))}">图标 SVG</a>${icon.tagFile ? ` <a href="${escape(asset(icon.tagFile))}">完整标签</a>` : ''}</div></li>`).join('')}</ul></section>` : ''
  const preview = report.prototypePreview ? `<figure class="prototype-preview"><img src="${escape(asset(report.prototypePreview.file))}" alt="${escape(report.prototypePreview.caption)}"><figcaption>${escape(report.prototypePreview.caption)}${report.prototypePreview.source ? ` · <a href="${escape(report.prototypePreview.source)}" target="_blank" rel="noopener">查看原型来源</a>` : ''}</figcaption></figure>` : ''
  const downloads = report.downloads?.length ? `<p class="downloads">${report.downloads.map(d => `<a href="${escape(asset(d.file))}">${escape(d.label)}</a>`).join(' ')}</p>` : ''
  const archive = report.archive ? `<p><a class="archive-link" href="${escape(asset(report.archive.file).replace(/\/index\.html$/, '/'))}">${escape(report.archive.label)}</a></p>` : ''
  return `<ul>${highlights(report).map(h => `<li>${escape(h)}</li>`).join('')}</ul>${icons}${preview}${downloads}${comparisons(report)}${archive}`
}
for (const report of reports) {
  for (const file of referenced(report)) {
    const dest = path.join(out, asset(file).slice(1))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(input(file), dest)
  }
  // Preserve existing report URLs. The daily page is the public reading entry.
  const details = `<nav><a href="/">返回验收记录</a></nav><h1>${escape(report.indexTitle || report.title)}</h1>${reportContent(report)}<p class="pending">${escape(report.pendingSummary || report.limitations)}</p>${report.previousVersion ? `<p><a href="../${escape(report.previousVersion)}/">查看上一版本</a></p>` : ''}`
  const dest = path.join(out, 'reports', report.id)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'index.html'), shell(report.title, details))
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
const history = `<aside class="history"><h2>历史资料</h2><a href="/legacy/20260927/">9月27日逐页验收快照</a></aside>`
for (const [day, items] of dayEntries) {
  const digest = dailySummaries[day] || {}
  const pending = digest.pending || items.map(r => r.pendingSummary || r.limitations)
  const body = `<nav><a href="/">返回验收记录</a></nav><header class="day-intro"><p class="muted">${escape(day)}</p><h1>${escape(digest.title || `${dayLabel(day)}更新与验收`)}</h1>${digest.summary ? `<p>${escape(digest.summary)}</p>` : ''}</header>${items.map(r => `<section class="compact-section" id="${escape(r.id)}"><h2>${escape(r.indexTitle || r.title)}</h2>${reportContent(r)}</section>`).join('')}<section class="pending"><h2>待确认与复测</h2><ul>${[...new Set(pending)].map(p => `<li>${escape(p)}</li>`).join('')}</ul></section>`
  const dest = path.join(out, 'updates', day)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'index.html'), shell(`${day} 验收`, body))
}
const timeline = dayEntries.map(([day, items], index) => {
  const digest = dailySummaries[day] || {}
  return `<article class="timeline-day"><div class="timeline-date"><time datetime="${day}">${escape(dayLabel(day))}</time><span>${escape(day.slice(0, 4))}</span>${index === 0 ? '<b>最近更新</b>' : ''}</div><div class="day-content"><h2 class="entry-title"><a href="/updates/${day}/">${escape(digest.title || `${dayLabel(day)}更新与验收`)}</a></h2><p class="entry-summary">${escape(digest.summary || items.map(r => r.indexTitle || r.title).join('；'))}</p></div></article>`
}).join('')
fs.writeFileSync(path.join(out, 'index.html'), shell('验收记录', `<header class="home-intro"><p class="site-name">MIP 测试与验收</p><h1>更新与验收记录</h1><p class="lead">每天一条，查看主要改动与验证结果。</p></header><div class="timeline">${timeline || '<p>暂时没有更新记录。</p>'}</div>${history}`))
const legacy = path.join(source, 'legacy')
if (fs.existsSync(legacy)) {
  fs.cpSync(legacy, path.join(out, 'legacy'), { recursive: true })
}
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-cache\n')
fs.writeFileSync(path.join(out, 'reports.json'), `${JSON.stringify(sorted, null, 2)}\n`)
console.log('Built acceptance site:', reports.length, 'reports')
if (process.argv[2] === 'publish') {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'pages', 'deploy', out, '--project-name=miptest', '--branch=main', '--commit-dirty=true'], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    throw new Error('Pages deployment failed; read back actual deployment before retry')
  }
}
