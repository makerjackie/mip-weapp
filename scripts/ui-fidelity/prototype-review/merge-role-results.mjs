#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { buildPublicSite } from './build-public-site.mjs'

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const status = value => value === 'PASS' ? 'pass' : value === 'FAIL' ? 'fail' : 'pending'
const deviceSteps = new Set(['J0-01', 'J0-02', 'J0-03', 'J1-02', 'J1-03', 'J1-07', 'J2-08', 'J3-07', 'J4-03', 'J5-02'])
const limitations = ['身份仅在本机注入，未使用该测试账号真实登录微信。', '只读检查，不代表生产写入、真实支付、手机号或扫码完成。']

function roleMatches(expectedRole, capture) {
  if (capture.role === expectedRole) {
    return true
  }
  if (expectedRole === 'authenticated') {
    return ['ordinary', 'guest', 'player', 'renewal'].includes(capture.role)
  }
  if (expectedRole === 'owner') {
    return capture.role === 'player'
  }
  if (expectedRole === 'attendee') {
    return capture.role === 'player'
  }
  return expectedRole === 'player-renewal' && capture.role === 'renewal'
}

function checkLabel(name) {
  return name.replace(/demo-(\d+)/, '演示账号 $1')
    .replace('authenticated active profile', '账户与资料状态')
    .replace('membership projection', '会员权益映射')
    .replace('no administrative grants', '无管理员权限')
    .replace('pending task response', '待处理任务返回')
    .replace('ended task response', '已结束任务返回')
    .replace('administrator access denied', '管理接口拒绝普通账号')
    .replace('renewal: entitlement boundary', '临期会员：权益边界')
    .replace('expired: entitlement boundary', '过期会员：权益边界')
    .replace('visitor: unauthenticated and no grants', '游客：未登录且无授权')
}

export function mergeRoleResults({ qaDirectory, manifestPath, baselineEvidencePath, publicationPath, outputPath, implementationCommit }) {
  const captures = read(path.join(qaDirectory, 'captures.json'))
  const reviews = read(path.join(qaDirectory, 'visual-review.json'))
  const interactionPath = path.join(qaDirectory, 'interactions.json')
  const interactions = fs.existsSync(interactionPath) ? read(interactionPath) : {}
  const database = read(path.join(qaDirectory, 'summary.public.json'))
  const smoke = read(path.join(qaDirectory, 'invoke-smoke.public.json'))
  const manifest = read(manifestPath)
  const evidence = read(baselineEvidencePath)
  const incomplete = []
  evidence.implementation = { commit: implementationCommit, captureNotes: '本轮以测试数据库演示账号读取业务结果，并在开发者工具本机注入身份复现页面。模拟角色与历史真实会话分开标识；未完成的微信登录、手机号、支付、扫码和写入不认定通过。' }
  const cases = database.checks.map((check, i) => ({
    id: `database-${i + 1}`,
    stepIds: check.name.startsWith('renewal') ? ['J4-03'] : [],
    mode: check.evidence === 'live-test-db/local-domain' ? 'test-account-service' : 'automated-contract',
    status: status(check.status),
    summary: checkLabel(check.name),
    evidence: check.evidence === 'live-test-db/local-domain' ? '读取实际测试数据库，在本机运行领域服务并断言结果。' : '在内存派生身份或权益时间窗口，运行领域服务边界断言。',
    limitations,
  }))
  for (const [i, result] of smoke.results.entries()) {
    cases.push({ id: `service-smoke-${i + 1}`, stepIds: [], mode: 'test-account-service', status: result.ok ? 'pass' : 'fail', summary: `${result.name} · ${result.action}`, evidence: '本机调用服务，读取真实测试数据库，检查返回成功及结构。', limitations })
  }
  const supplementalPath = path.join(qaDirectory, 'supplemental-results.json')
  if (fs.existsSync(supplementalPath)) {
    const supplemental = read(supplementalPath)
    if (!Array.isArray(supplemental.cases)) {
      throw new TypeError('补充测试结果必须包含 cases 数组')
    }
    cases.push(...supplemental.cases)
  }
  for (const step of manifest.steps) {
    const capture = captures[step.id]
    const review = reviews[step.id]
    if (!capture) {
      incomplete.push({ id: step.id, reason: '本轮未重拍，保留上轮证据与范围' })
      cases.push({ id: `visual-${step.id}`, stepIds: [step.id], mode: 'simulated-role', status: 'pending', summary: `${step.id} · 本轮场景未采集`, limitations: ['本页主图保留上轮参考，不能据此认定本轮目标角色已完成验收。'] })
      continue
    }
    const imagePath = path.resolve(qaDirectory, 'actual', `${step.id}.png`)
    const reviewed = fs.existsSync(imagePath) && review?.reviewedImageSha256 === hash(imagePath)
    if (!reviewed || !['ready', 'empty'].includes(capture.state)) {
      const observed = fs.existsSync(imagePath) && review?.observedImageSha256 === hash(imagePath)
      const reason = capture.state === 'error' ? '本轮采集错误态，等待复测' : observed ? review.visualNotes : '新图尚未完成SHA绑定视觉复核'
      incomplete.push({ id: step.id, reason })
      cases.push({ id: `visual-${step.id}`, stepIds: [step.id], mode: 'simulated-role', status: 'pending', summary: `${step.id} · 本轮画面待复测`, limitations: [reason, '本页主图保留旧证据，不代表本轮角色已完成验收。'] })
      continue
    }
    const base = evidence.steps[step.id] || {}
    const interaction = interactions[step.id]
    const interactionBound = interaction?.reviewedImageSha256 === hash(imagePath)
      && Boolean(interaction.capturedAt && interaction.notes)
      && Array.isArray(interaction.operations) && interaction.operations.length > 0
      && Array.isArray(interaction.assertions) && interaction.assertions.length > 0
    const interactionPassed = interactionBound && interaction.status === 'pass'
      && interaction.assertions.every(assertion => assertion.passed === true)
    const interactionFailed = interactionBound && interaction.status === 'failed'
      && interaction.assertions.some(assertion => assertion.passed === false)
    const oldExtras = base.additionalImages || step.additionalImages || []
    const matches = !['data-mismatch', 'blocked', 'pending', 'needs-fix'].includes(review.status)
    evidence.steps[step.id] = {
      ...base,
      actual: {
        path: imagePath,
        source: 'simulated-role',
        role: capture.role,
        roleMatches: roleMatches(step.expectedRole, capture),
        stateMatches: matches,
        capturedAt: capture.capturedAt,
        interactionEvidence: interactionPassed || interactionFailed ? interaction.operations : [],
      },
      additionalImages: oldExtras.filter(image => image.side === 'prototype'),
      review: {
        ...review,
        interactionStatus: interactionPassed ? 'pass' : interactionFailed ? 'failed' : 'pending',
        interactionNotes: interactionPassed || interactionFailed ? interaction.notes : '本轮逐图检查与数据读取不代表已完成按钮写入或真实微信动作。',
        deviceStatus: 'pending',
        deviceRequired: deviceSteps.has(step.id),
        deviceNotes: deviceSteps.has(step.id) ? ['真实微信身份、手机号、支付或扫码相关步骤仍需真机验证；本图只验证模拟状态。'] : [],
      },
    }
    cases.push({
      id: `visual-${step.id}`,
      stepIds: [step.id],
      mode: 'simulated-role',
      status: review.status === 'needs-fix' ? 'fail' : matches ? 'pass' : 'pending',
      summary: `${step.id} · 模拟画面视觉核对`,
      evidence: review.visualNotes,
      limitations: ['结论仅限当前截图视觉，不是交互或真机通过。', ...review.differences],
    })
    if (interactionPassed || interactionFailed) {
      cases.push({
        id: `interaction-${step.id}`,
        stepIds: [step.id],
        mode: 'simulated-role',
        status: interactionPassed ? 'pass' : 'fail',
        summary: `${step.id} · 本地交互核对`,
        evidence: `${interaction.notes} ${interaction.operations.join('；')}`,
        limitations: ['仅覆盖明确列出的操作和断言，不代表真实微信登录、付款、扫码或未执行的其他操作。'],
      })
    }
  }
  const mergedEvidence = path.resolve(qaDirectory, 'public-evidence.json')
  const resultsPath = path.resolve(qaDirectory, 'public-test-results.json')
  fs.writeFileSync(mergedEvidence, JSON.stringify(evidence, null, 2))
  fs.writeFileSync(resultsPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2))
  fs.writeFileSync(path.join(qaDirectory, 'public-pending.json'), JSON.stringify(incomplete, null, 2))
  return { ...buildPublicSite({ manifestPath, evidencePath: mergedEvidence, resultsPath, publicationPath, outputPath }), incomplete }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]
    if (!['--qa', '--manifest', '--baseline-evidence', '--publication', '--out', '--implementation'].includes(key) || !process.argv[i + 1]) {
      throw new Error(`无效参数：${key}`)
    }
    args[key.slice(2)] = process.argv[i + 1]
  }
  for (const key of ['qa', 'manifest', 'baseline-evidence', 'publication', 'out', 'implementation']) {
    if (!args[key]) {
      throw new Error(`缺少 --${key}`)
    }
  }
  console.log(JSON.stringify(mergeRoleResults({ qaDirectory: path.resolve(args.qa), manifestPath: path.resolve(args.manifest), baselineEvidencePath: path.resolve(args['baseline-evidence']), publicationPath: path.resolve(args.publication), outputPath: path.resolve(args.out), implementationCommit: args.implementation })))
}
