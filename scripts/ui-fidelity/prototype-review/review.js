/* global report */
const $ = id => document.getElementById(id)
const steps = report.steps
const statusLabels = { 'pending': '待复核', 'pass': 'AI 已核对', 'needs-fix': '需要调整', 'blocked': '场景待补', 'data-mismatch': '场景不符', 'accepted-difference': '差异已说明' }
const feedbackLabels = { 'pass': '通过', 'needs-fix': '需调整', 'pending': '待确认' }
const storageKey = `mip-review-v2-${report.source.commit}-${report.implementation.commit}-${report.captureSet}`
let feedback = {}
let storageWarning = ''
let selected = steps.findIndex(step => step.id === location.hash.slice(1))
if (selected < 0) {
  selected = 0
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('Invalid feedback')
  }
  feedback = Object.fromEntries(Object.entries(saved).filter(([id, value]) => steps.some(step => step.id === id) && value && typeof value === 'object' && !Array.isArray(value)))
}
catch {
  storageWarning = '浏览器存储不可用，请在离开前导出意见。'
}

function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) {
    node.textContent = text
  }
  if (className) {
    node.className = className
  }
  return node
}

function roleName(value) {
  return report.roleProfiles[value]?.label || value || '未登记'
}
function timestamp(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未登记'
}

function openImage(image, label) {
  $('zoom-image').src = image.src
  $('zoom-image').alt = label
  $('zoom-label').textContent = label
  $('zoom').showModal()
}

function screenshot(image, label, chromeInset = 0) {
  const box = element('div', undefined, 'shot')
  if (!image.available) {
    box.append(element('div', '截图尚未补齐\n本页不能判断通过', 'missing'))
    return box
  }
  if (chromeInset) {
    const space = element('div', '原生导航未入图 · 仅作内容对齐留白', 'chrome-space')
    space.style.aspectRatio = `375 / ${chromeInset}`
    box.append(space)
  }
  const img = element('img')
  img.src = image.src
  img.alt = label
  img.onclick = () => openImage(image, label)
  box.append(img)
  return box
}

function pane(step, side) {
  const record = step[side]
  const title = side === 'prototype' ? '原型' : '实际效果'
  const box = element('section', undefined, 'pane')
  const heading = element('div', undefined, 'pane-heading')
  heading.append(element('strong', title), element('small', '点击查看大图'))
  box.append(heading, screenshot(record.image, `${step.id} ${title}`, side === 'actual' && record.chromeOmitted ? record.referenceChromeInsetCssPx || 88 : 0))
  for (const extra of step.additionalImages.filter(image => image.side === side || (side === 'actual' && !image.side))) {
    const continuation = element('div', undefined, 'continuation')
    continuation.append(element('p', extra.label || '下方补图（与首屏可能重叠）'), screenshot(extra.image, `${step.id} ${extra.label || '补图'}`))
    box.append(continuation)
  }
  return box
}

function updateProgress() {
  const count = Object.values(feedback).filter(value => value.status || value.note?.trim()).length
  $('progress').textContent = `已写意见 ${count} / ${steps.length}`
  $('save-state').textContent = storageWarning || '意见自动保存在当前浏览器'
  $('save-state').classList.toggle('failed', Boolean(storageWarning))
}

function saveFeedback() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(feedback))
    storageWarning = ''
  }
  catch {
    storageWarning = '意见尚未保存到浏览器。输入仍在，请先导出再离开。'
  }
  updateProgress()
}

function showVerdicts() {
  const id = steps[selected].id
  $('verdicts').replaceChildren()
  for (const [value, label] of Object.entries(feedbackLabels)) {
    const button = element('button', label)
    button.type = 'button'
    button.setAttribute('aria-pressed', String(feedback[id]?.status === value))
    button.onclick = () => {
      feedback[id] = { ...feedback[id], status: value, at: new Date().toISOString() }
      saveFeedback()
      showVerdicts()
    }
    $('verdicts').append(button)
  }
}

function render() {
  const step = steps[selected]
  $('page-title').textContent = `${step.id} · ${step.name}`
  $('ai-state').textContent = statusLabels[step.review.status]
  $('ai-state').className = `badge ${step.review.status}`
  const mismatched = step.actual.roleMatches === false || step.actual.stateMatches === false || ['blocked', 'data-mismatch'].includes(step.review.status)
  $('scenario-warning').hidden = !mismatched
  $('scenario-warning').textContent = step.actual.roleMatches === false
    ? `场景不符：原型为${roleName(step.expectedRole)}，实际为${roleName(step.actual.role)}。本页不能判定场景通过。`
    : '场景待补：当前截图未复现原型所要求的状态，不能判定场景通过。'
  $('ai-note').textContent = step.review.visualNotes || '请先核对两侧截图，再留下你的意见。'
  $('comparison').replaceChildren(pane(step, 'prototype'), pane(step, 'actual'))
  $('jump').value = step.id
  $('counter').textContent = `${selected + 1} / ${steps.length}`
  $('previous').disabled = selected === 0
  $('next').disabled = selected === steps.length - 1
  $('note').value = feedback[step.id]?.note || ''
  const previous = report.previousFeedback?.feedback?.[step.id]
  $('previous-feedback').hidden = !previous
  $('previous-feedback').textContent = previous
    ? `上一轮意见（只读）：${feedbackLabels[previous.status] || '未标状态'}${previous.note ? ` · ${previous.note}` : ''}`
    : ''
  showVerdicts()
  const detail = $('evidence-content')
  detail.replaceChildren()
  const differences = [...step.evidenceWarnings, ...(step.review.differences || [])]
  if (differences.length) {
    detail.append(element('p', differences.join('\n')))
  }
  detail.append(element('p', `原型角色：${roleName(step.expectedRole)} · 实际角色：${roleName(step.actual.role)}\n实际采集：${timestamp(step.actual.capturedAt)}\n实现版本：${report.implementation.commit}\n截图 SHA：${step.actual.image.sha256 || '无截图'}`))
  detail.append(element('p', `交互：${step.review.interactionStatus === 'pass' ? '有通过记录' : '仍需操作验证'} · 真机：${step.review.deviceStatus === 'pass' ? '有通过记录' : '待验证'}\n视觉核对不替代手机号、支付、扫码等真机验收。`))
  if (/^https?:\/\//.test(step.prototype.sourceUrl || '')) {
    const link = element('a', '打开原型与标注')
    link.href = step.prototype.sourceUrl
    link.target = '_blank'
    link.rel = 'noreferrer'
    detail.append(link)
  }
  $('evidence').open = false
  updateProgress()
}

function select(index) {
  if (index < 0 || index >= steps.length) {
    return
  }
  selected = index
  history.replaceState(null, '', `#${steps[index].id}`)
  render()
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function exportFeedback() {
  const body = JSON.stringify({ report: 'MIP 43-step parity', sourceCommit: report.source.commit, implementationCommit: report.implementation.commit, exportedAt: new Date().toISOString(), feedback }, null, 2)
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  const link = element('a')
  link.href = url
  link.download = `mip-43-step-feedback-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

for (const step of steps) {
  const option = element('option', `${step.id} · ${step.name}`)
  option.value = step.id
  $('jump').append(option)
}
$('jump').onchange = () => select(steps.findIndex(step => step.id === $('jump').value))
$('previous').onclick = () => select(selected - 1)
$('next').onclick = () => select(selected + 1)
$('note').oninput = () => {
  const id = steps[selected].id
  feedback[id] = { ...feedback[id], note: $('note').value, at: new Date().toISOString() }
  saveFeedback()
}
$('export').onclick = exportFeedback
$('close-zoom').onclick = () => $('zoom').close()
$('zoom').onclick = (event) => {
  if (event.target === $('zoom')) {
    $('zoom').close()
  }
}
window.addEventListener('hashchange', () => {
  const index = steps.findIndex(step => step.id === location.hash.slice(1))
  if (index >= 0) {
    select(index)
  }
})
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable || $('zoom').open) {
    return
  }
  if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    select(selected + 1)
  }
  if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    select(selected - 1)
  }
})
render()
