import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const sandboxes: string[] = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-acceptance-'))
  sandboxes.push(root)
  for (const dir of ['scripts', 'docs/mip/acceptance-site', 'docs/mip/evidence/example']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  fs.copyFileSync('scripts/acceptance-site.mjs', path.join(root, 'scripts/acceptance-site.mjs'))
  const image = 'docs/mip/evidence/example/image.png'
  fs.writeFileSync(path.join(root, image), 'reviewed-public-image')
  const report = {
    id: 'first-v1',
    requirement: 'first',
    title: '已验证修复',
    version: 'v1',
    status: 'draft',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    verifiedAt: '2026-10-20T00:00:00Z',
    submittedAt: '2026-10-20T00:00:00Z',
    commitAt: '2026-10-19T00:00:00Z',
    commit: 'abc1234',
    environment: '测试',
    summary: '修复说明',
    files: [image],
    comparisons: [{ title: '同一订单', context: '测试样本', before: { file: image, caption: '前' }, after: { file: image, caption: '后' }, prototype: { caption: '无原图', reason: '用户新增规则，无对应原型' } }],
    checks: ['实际读回通过'],
    limitations: '真机待测',
  }
  const registry = path.join(root, 'docs/mip/acceptance-site/reports.json')
  const write = (reports: unknown[] = [report]) => fs.writeFileSync(registry, JSON.stringify(reports))
  write()
  const run = (...args: string[]) => execFileSync(process.execPath, ['scripts/acceptance-site.mjs', ...args], { cwd: root, encoding: 'utf8' })
  return { root, report, registry, write, run, image }
}
describe('公开验收报告的版本与时间规则', () => {
  it('日期倒序，追踪时间保留在源数据而不堆入页面', () => {
    const f = fixture()
    f.write([f.report, { ...f.report, id: 'second-v1', title: '后来的修复', updatedAt: '2026-10-21T00:00:00Z' }])
    f.run('build')
    const html = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/index.html'), 'utf8')
    expect(html.indexOf('后来的修复')).toBeLessThan(html.indexOf('已验证修复'))
    expect(html).not.toContain('首次提交')
    expect(html).not.toContain('北京时间<br>')
    expect(html).toContain('10月20日')
    const details = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/reports/first-v1/index.html'), 'utf8')
    expect(details).not.toContain('首次提交')
    expect(details).not.toContain('代码版本')
    expect(details).not.toContain(f.report.commit)
    expect(JSON.parse(fs.readFileSync(f.registry, 'utf8'))[0].submittedAt).toBe(f.report.submittedAt)
  })
  it('同一天只有一个阅读入口，进入即可读到所有改动', () => {
    const f = fixture()
    f.write([f.report, { ...f.report, id: 'second-v1', title: '另一项修复', updatedAt: '2026-10-20T02:00:00Z' }])
    f.run('build')
    const homepage = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/index.html'), 'utf8')
    expect(homepage.match(/class="timeline-day"/g)).toHaveLength(1)
    expect(homepage.match(/href="\/updates\/2026-10-20\/"/g)).toHaveLength(1)
    expect(homepage).not.toContain('/reports/second-v1/')
    const daily = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-20/index.html'), 'utf8')
    expect(daily).toContain('已验证修复')
    expect(daily).toContain('另一项修复')
    expect(daily).toContain('真机待测')
    expect(daily).toContain('id="first-v1"')
    expect(daily).toContain('id="second-v1"')
    expect(daily).not.toContain('首次提交')
    expect(daily).not.toContain('代码提交')
    expect(daily).not.toContain('无原图')
  })
  it('按北京时间归档跨UTC日期的报告，防止同一天拆成两组', () => {
    const f = fixture()
    f.write([f.report, { ...f.report, id: 'second-v1', updatedAt: '2026-10-19T17:00:00Z' }])
    f.run('build')
    const homepage = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/index.html'), 'utf8')
    expect(homepage.match(/class="timeline-day"/g)).toHaveLength(1)
    expect(homepage.match(/href="\/updates\/2026-10-20\/"/g)).toHaveLength(1)
  })
  it('无原型只展示前后两列，纯功能优化不强制图片或比较', () => {
    const f = fixture()
    const { prototype: _prototype, ...pair } = f.report.comparisons[0]
    f.write([{ ...f.report, comparisons: [pair] }])
    f.run('build')
    const details = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/reports/first-v1/index.html'), 'utf8')
    expect(details).toContain('two-columns')
    expect(details).not.toContain('权威原型')
    f.write([{ ...f.report, uiChange: false, comparisons: [] }])
    f.run('build')
    const functional = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/reports/first-v1/index.html'), 'utf8')
    expect(functional).not.toContain('查看画面对照')
    expect(functional).not.toContain('<img')
  })
  it('存在真实原型时保留原型列和已审核图片', () => {
    const f = fixture()
    f.write([{ ...f.report, comparisons: [{ ...f.report.comparisons[0], prototype: { file: f.image, caption: '当前设计原图' } }] }])
    f.run('build')
    const daily = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-20/index.html'), 'utf8')
    expect(daily).toContain('权威原型')
    expect(daily).toContain('当前设计原图')
  })
  it('冻结后拒绝修改结论或证据图片，新版本能保留旧版本', () => {
    const f = fixture()
    f.run('freeze', 'first-v1')
    const frozen = JSON.parse(fs.readFileSync(f.registry, 'utf8'))
    f.run('build')
    f.write([{ ...frozen[0], title: '偷偷改标题' }])
    expect(() => f.run('build')).toThrow()
    f.write(frozen)
    fs.writeFileSync(path.join(f.root, f.image), 'changed')
    expect(() => f.run('build')).toThrow()
    fs.writeFileSync(path.join(f.root, f.image), 'reviewed-public-image')
    f.write([...frozen, { ...f.report, id: 'first-v2', version: 'v2', previousVersion: 'first-v1' }])
    f.run('build')
    expect(fs.existsSync(path.join(f.root, '.tmp/mip-acceptance-site/reports/first-v1/index.html'))).toBe(true)
    expect(fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/reports/first-v2/index.html'), 'utf8')).toContain('查看上一版本')
  })
  it('缺少原型说明或引用私有文件时拒绝公开构建', () => {
    const f = fixture()
    f.report.comparisons[0].prototype.reason = ''
    f.write()
    const failed = spawnSync(process.execPath, ['scripts/acceptance-site.mjs', 'build'], { cwd: f.root, encoding: 'utf8' })
    expect(failed.status).not.toBe(0)
    f.report.comparisons[0].prototype.reason = '新增规则'
    f.report.files = ['.env.local']
    f.write()
    expect(() => f.run('build')).toThrow()
  })
})
