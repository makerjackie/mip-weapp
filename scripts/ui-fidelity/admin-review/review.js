const report = JSON.parse(document.getElementById('report-data').textContent)
const byId = id => document.getElementById(id)
const storageKey = 'mip-admin-review-feedback-v1'
const modes = { 'demo-visual': '演示画面', 'real-read': '真实读取', 'real-write': '真实写入', 'unverified': '证据类型待确认' }
const states = { 'pass': '该项操作通过', 'fail': '发现问题', 'pending': '待补测', 'demo-reviewed': '演示画面已检查' }
let feedback = {}
let storageAvailable = true
try {
  feedback = JSON.parse(localStorage.getItem(storageKey) || '{}')
}
catch {
  storageAvailable = false
}
if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) {
  feedback = {}
}
let index = 0
const viewportSelection = {}
function evidenceChanged(step, saved) {
  const current = step.captures.map(capture => capture.sha256).filter(Boolean)
  return Boolean(saved?.updatedAt) && JSON.stringify(saved.reviewedImageSha256 || []) !== JSON.stringify(current)
}
function node(tag, value, className) {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) {
    element.className = className
  }
  return element
}
byId('report-title').textContent = report.title
for (const [i, step] of report.steps.entries()) {
  const option = node('option', `${i + 1}. ${step.title}`)
  option.value = String(i)
  byId('step-select').append(option)
}
function render() {
  const step = report.steps[index]
  byId('step-title').textContent = step.title
  byId('route').textContent = step.route
  byId('progress').textContent = `${index + 1} / ${report.steps.length}`
  byId('requirements').replaceChildren(...step.requirements.map(value => node('li', value)))
  byId('step-notes').textContent = step.notes
  renderPrototype(step)
  renderActual(step)
  const saved = feedback[step.id] || {}
  byId('decision').value = !evidenceChanged(step, saved) && ['pending', 'pass', 'needs-fix', 'question'].includes(saved.status) ? saved.status : 'pending'
  byId('comment').value = typeof saved.note === 'string' ? saved.note : ''
  byId('save-state').textContent = storageAvailable ? '意见仅保存在此浏览器；导出后再交给团队。' : '浏览器不支持保存，请及时导出意见。'
  if (evidenceChanged(step, saved)) {
    byId('save-state').textContent = '截图已更新，旧意见保留供参考，请重新选择结论。'
  }
  byId('previous').disabled = index === 0
  byId('next').disabled = index === report.steps.length - 1
  byId('step-select').value = String(index)
}
function renderPrototype(step) {
  byId('prototype-content').replaceChildren()
  byId('prototype-source').textContent = step.prototype?.sourceTitle || ''
  if (!step.prototype) {
    byId('prototype-content').append(node('div', step.prototypeUnavailableReason || '没有找到与本页对应的原型画面。', 'compare-missing'))
    return
  }
  const frame = document.createElement('iframe')
  frame.id = 'prototype-frame'
  frame.title = `${step.title} 原型画面：${step.prototype.title}`
  frame.src = step.prototype.src
  frame.loading = 'lazy'
  frame.setAttribute('sandbox', 'allow-scripts')
  byId('prototype-content').append(frame)
}
function renderActual(step) {
  const selector = byId('viewport-select')
  const captures = step.captures || []
  const selection = Number.isInteger(viewportSelection[step.id]) ? viewportSelection[step.id] : 0
  selector.replaceChildren(...captures.map((capture, captureIndex) => {
    const option = node('option', `${capture.viewport} · ${capture.title || modes[capture.mode]}`)
    option.value = String(captureIndex)
    return option
  }))
  byId('viewport-control').hidden = captures.length < 2
  byId('actual-content').replaceChildren()
  if (!captures.length) {
    byId('actual-content').append(node('div', '本页还没有经过审核的实际截图。', 'compare-missing'))
    return
  }
  const captureIndex = Math.min(selection, captures.length - 1)
  viewportSelection[step.id] = captureIndex
  selector.value = String(captureIndex)
  const capture = captures[captureIndex]
  const section = node('section', '', 'actual-capture')
  const heading = node('div', '', 'capture-head')
  heading.append(node('strong', capture.title || capture.viewport), node('span', modes[capture.mode], 'tag'), node('span', states[capture.status], `tag ${capture.status}`))
  section.append(heading, node('p', `${capture.viewport} · ${capture.capturedAt || '采集时间未记录'}`))
  if (capture.notes) {
    section.append(node('p', capture.notes, 'capture-notes'))
  }
  if (capture.operations.length) {
    const operations = node('ul', '')
    operations.append(...capture.operations.map(value => node('li', value)))
    section.append(operations)
  }
  if (capture.image) {
    const image = document.createElement('img')
    image.src = capture.image
    image.alt = `${step.title} 实际截图 — ${capture.title || capture.viewport}`
    image.loading = 'lazy'
    section.append(image)
  }
  else {
    section.append(node('div', capture.publicationNote || '尚无公开审核通过的实际截图。', 'compare-missing'))
  }
  if (capture.mode !== 'real-write') {
    section.append(node('p', '此项没有验证真实写入。'))
  }
  byId('actual-content').append(section)
}
function go(next) {
  index = Math.max(0, Math.min(report.steps.length - 1, next))
  location.hash = encodeURIComponent(report.steps[index].id)
  render()
}
function hashChange() {
  let id
  try {
    id = decodeURIComponent(location.hash.slice(1))
  }
  catch {
    id = ''
  }
  ;
  const selected = report.steps.findIndex(step => step.id === id)
  index = selected >= 0 ? selected : 0
  render()
}
function save() {
  const step = report.steps[index]
  feedback[step.id] = { status: byId('decision').value, note: byId('comment').value, updatedAt: new Date().toISOString(), reviewedImageSha256: step.captures.map(capture => capture.sha256).filter(Boolean) }
  try {
    localStorage.setItem(storageKey, JSON.stringify(feedback))
    byId('save-state').textContent = '已保存到当前浏览器。'
  }
  catch {
    storageAvailable = false
    byId('save-state').textContent = '保存失败，请及时导出意见。'
  }
}
byId('previous').onclick = () => go(index - 1)
byId('next').onclick = () => go(index + 1)
byId('step-select').onchange = event => go(Number(event.target.value))
byId('viewport-select').onchange = (event) => {
  viewportSelection[report.steps[index].id] = Number(event.target.value)
  renderActual(report.steps[index])
}
byId('decision').onchange = save
byId('comment').oninput = save
byId('export').onclick = () => {
  const result = { report: report.title, generatedAt: report.generatedAt, exportedAt: new Date().toISOString(), feedback: Object.fromEntries(report.steps.map(step => [step.id, { title: step.title, route: step.route, ...feedback[step.id], status: evidenceChanged(step, feedback[step.id]) ? 'pending' : feedback[step.id]?.status || 'pending', evidenceChanged: evidenceChanged(step, feedback[step.id]) }])) }
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `mip-admin-feedback-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
window.addEventListener('hashchange', hashChange)
hashChange()
