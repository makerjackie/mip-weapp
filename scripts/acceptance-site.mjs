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
const date = value => `${new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 北京时间`
function input(relative) {
  const full = path.resolve(root, relative)
  if (!full.startsWith(path.join(root, 'docs/mip/')) || !fs.statSync(full).isFile()) {
    throw new Error(`Invalid public evidence path: ${relative}`)
  }
  return full
}
function referenced(report) {
  return [...new Set([...report.files, ...report.comparisons.flatMap(item => [item.before?.file, item.after?.file, item.prototype?.file].filter(Boolean))])].sort()
}
function fingerprint(report) {
  return sha(JSON.stringify({ report, files: referenced(report).map(file => [file, sha(fs.readFileSync(input(file)))]) }))
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
  if (!['draft', 'final'].includes(report.status) || !report.title || !report.version || !report.commit || !report.comparisons.length) {
    throw new Error('Incomplete report')
  }
  if (report.previousVersion && !reports.some(r => r.id === report.previousVersion && r.requirement === report.requirement)) {
    throw new Error('Missing preceding version')
  }
  for (const c of report.comparisons) {
    for (const key of ['before', 'after', 'prototype']) {
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
function shell(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · MIP 验收</title><style>${css}</style></head><body><main>${body}</main></body></html>`
}
for (const report of reports) {
  for (const file of referenced(report)) {
    const dest = path.join(out, file.replace(/^docs\/mip\//, ''))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(input(file), dest)
  }
  const asset = file => `../../${file.replace(/^docs\/mip\//, '')}`
  const panel = (cell, label) => `<section class="panel"><b>${label}</b><p>${escape(cell.caption)}</p>${cell.file ? `<a href="${escape(asset(cell.file))}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(asset(cell.file))}" alt="${escape(cell.caption)}"></a>` : `<p class="placeholder">${escape(cell.reason)}</p>`}${cell.source ? `<p class="muted">来源：${escape(cell.source)}</p>` : ''}</section>`
  const details = `<nav><a href="/">← 全部验收报告</a><a href="#comparison">修改对照</a><a href="#checks">验证记录</a></nav><h1>${escape(report.title)}</h1><p><span class="tag">${report.status === 'final' ? '已定稿 · 保留版本' : '草稿 · 可继续反馈'}</span> <span class="tag">${escape(report.version)}</span> <span class="tag">${escape(report.environment)}</span></p><p>${escape(report.summary)}</p><dl>${[['首次提交', date(report.submittedAt)], ['最近更新', date(report.updatedAt)], ['实际验证', date(report.verifiedAt)], ['代码版本', report.commit], ['代码提交', date(report.commitAt)]].map(([a, b]) => `<dt>${a}</dt><dd>${escape(b)}</dd>`).join('')}</dl>${report.previousVersion ? `<p><a href="../${escape(report.previousVersion)}/">查看上一版本</a></p>` : ''}<h2 id="comparison">修改前 / 修改后 / 原型</h2>${report.comparisons.map(c => `<h3>${escape(c.title)}</h3><p class="muted">${escape(c.context)}</p><div class="columns">${panel(c.before, '修改前')}${panel(c.after, '修改后')}${panel(c.prototype, '权威原型')}</div>`).join('')}<h2 id="checks">验证记录</h2><ul>${report.checks.map(c => `<li>${escape(c)}</li>`).join('')}</ul><p class="note">${escape(report.limitations)}</p>${report.detail ? `<p><a href="${escape(asset(report.detail))}">查看完整原因、步骤和原始对照报告 →</a></p>` : ''}`
  const dest = path.join(out, 'reports', report.id)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'index.html'), shell(report.title, details))
}
const sorted = [...reports].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id))
fs.writeFileSync(path.join(out, 'index.html'), shell('验收报告', `<p class="muted">MIP · 测试与验收</p><h1>每次修改，都有据可查。</h1><p>按最近更新时间倒序。进入报告查看修改前后、原型对照、验证范围和待验收项。</p>${sorted.map(r => `<article class="card"><span class="tag">${r.status === 'final' ? '已定稿' : '反馈中 · 草稿'}</span> <span class="tag">${escape(r.version)}</span><h2 style="margin:12px 0"><a href="reports/${escape(r.id)}/">${escape(r.title)}</a></h2><p>${escape(r.summary)}</p><p class="muted">更新 ${escape(date(r.updatedAt))}<br>首次提交 ${escape(date(r.submittedAt))}<br>验证 ${escape(date(r.verifiedAt))} · ${escape(r.environment)}<br>代码 ${escape(r.commit.slice(0, 8))} · 提交于 ${escape(date(r.commitAt))}</p></article>`).join('')}<section class="card"><h2 style="margin:0">历史验收资料</h2><p><a href="/legacy/20260927/">2026-09-27 逐页验收原站（历史快照）</a></p><p><a href="https://mip-review.01mvp.com/">2026-10-19 原型与实际画面对照（既有外发站）</a></p><p class="muted">历史资料保留原日期、环境与未验收标记，不代表当前版本已通过。</p></section>`))
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
