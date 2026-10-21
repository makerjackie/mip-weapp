import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
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
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true })
  fs.copyFileSync('scripts/lib/acceptance-images.mjs', path.join(root, 'scripts/lib/acceptance-images.mjs'))
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir')
  fs.cpSync('scripts/acceptance-reader', path.join(root, 'scripts/acceptance-reader'), { recursive: true })
  const image = 'docs/mip/evidence/example/image.png'
  fs.writeFileSync(path.join(root, image), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64'))
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
  it('publishes smaller previews while preserving original evidence and frozen hashes', async () => {
    const f = fixture()
    const original = await sharp({ create: { width: 1600, height: 10, channels: 3, background: '#202020' } }).png({ compressionLevel: 0 }).toBuffer()
    fs.writeFileSync(path.join(f.root, f.image), original)
    f.run('freeze', 'first-v1')
    f.run('build')
    const output = path.join(f.root, '.tmp/mip-acceptance-site')
    expect(fs.readFileSync(path.join(output, 'evidence/example/image.png'))).toEqual(original)
    const html = fs.readFileSync(path.join(output, 'updates/2026-10-20/index.html'), 'utf8')
    expect(html).toContain('href="/evidence/example/image.png"')
    expect(html).toMatch(/<img[^>]+src="\/assets\/optimized-images\/[a-f0-9]+\.webp"/)
    expect(html).toContain('width="1280" height="8"')
    const stats = JSON.parse(fs.readFileSync(path.join(output, 'image-optimization.json'), 'utf8'))
    expect(stats.optimized).toBe(1)
    expect(stats.previewBytes).toBeLessThan(stats.originalBytes / 2)
    f.run('build')
  }, 15_000)

  it('presents goals before implementation and acceptance standards with their real outcomes', () => {
    const f = fixture()
    fs.writeFileSync(path.join(f.root, 'docs/mip/acceptance-site/daily-summaries.json'), JSON.stringify({
      '2026-10-20': { request: '用户原话 <目标>', goals: ['小屏不溢出'], acceptance: [{ criterion: '320px 可操作', result: '待真机复测' }] },
    }))
    f.run('build')
    const html = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-20/index.html'), 'utf8')
    expect(html).toContain('用户原话 &lt;目标&gt;')
    expect(html.indexOf('今天要实现的目标')).toBeLessThan(html.indexOf('实现结果与证据'))
    expect(html.indexOf('实现结果与证据')).toBeLessThan(html.indexOf('验收标准与结果'))
    expect(html).toContain('<td>320px 可操作</td><td>待真机复测</td>')
  })

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
  it('画面对照直接可见，目录和复制链接指向唯一且稳定的锚点', () => {
    const f = fixture()
    f.run('build')
    const dailyPath = path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-20/index.html')
    const daily = fs.readFileSync(dailyPath, 'utf8')
    expect(daily).toContain('aria-label="本页目录"')
    expect(daily).toContain('aria-label="跳转到验收项"')
    expect(daily).toContain('data-copy-link')
    expect(daily).toContain('/assets/acceptance-reader/reader.js')
    expect(daily).toContain('/assets/acceptance-reader/reader.css')
    expect(daily).toContain('class="comparison"')
    expect(daily).not.toContain('<details')
    expect(daily).not.toContain('查看画面对照')
    const ids = [...daily.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    for (const match of daily.matchAll(/href="#([^"]+)"/g)) {
      expect(ids).toContain(match[1])
    }
    const anchor = daily.match(/class="comparison" id="([^"]+)"/)![1]
    f.write([{ ...f.report, comparisons: [{ ...f.report.comparisons[0], title: '新增加在前面的对照' }, ...f.report.comparisons] }])
    f.run('build')
    expect(fs.readFileSync(dailyPath, 'utf8')).toContain(`class="comparison" id="${anchor}"`)
    expect(fs.existsSync(path.join(f.root, '.tmp/mip-acceptance-site/assets/acceptance-reader/reader.js'))).toBe(true)
  })
  it('冲突的目录锚点拒绝构建，避免分享链接定位到错误内容', () => {
    const f = fixture()
    f.write([{ ...f.report, sections: [{ id: 'same', title: '行业' }, { id: 'same', title: '日期' }] }])
    expect(() => f.run('build')).toThrow()
    f.write([{ ...f.report, sections: [{ id: 'profile', title: '行业', comparisons: [f.report.comparisons[0], f.report.comparisons[0]] }] }])
    expect(() => f.run('build')).toThrow()
    f.write([{ ...f.report, sections: [{ title: '缺少定位标识' }] }])
    expect(() => f.run('build')).toThrow()
  })
  it('历史功能和图片合入日期页，旧入口仅跳转，原始归档仍不可改写', () => {
    const f = fixture()
    const folder = path.join(f.root, 'docs/mip/acceptance-site/legacy/20261019')
    fs.mkdirSync(path.join(folder, 'role-icons'), { recursive: true })
    const original = '<html>原报告</html>'
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>'
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    fs.writeFileSync(path.join(folder, 'index.html'), original)
    fs.writeFileSync(path.join(folder, 'role-icons/dog.svg'), svg)
    fs.writeFileSync(path.join(folder, 'archive.json'), JSON.stringify({ htmlSha256: hash(original), assets: { 'role-icons/dog.svg': hash(svg) } }))
    const section = { id: 'profile', title: '行业选择', highlights: ['确认后更新，取消保留原值'], comparisons: [{ ...f.report.comparisons[0], prototype: undefined, references: [{ label: '历史参考 · Figma', file: f.image, caption: '当时的参考稿' }] }], evidenceImages: [{ file: f.image, caption: '完整目录实拍' }] }
    f.write([f.report, { ...f.report, id: 'legacy-review', reportDate: '2026-10-19', updatedAt: '2026-10-21T00:00:00Z', title: '六角色历史原型', comparisons: [], uiChange: false, sections: [section], roleIcons: [{ label: '狗策划', file: 'docs/mip/acceptance-site/legacy/20261019/role-icons/dog.svg' }] }])
    f.run('build')
    const home = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/index.html'), 'utf8')
    expect(home.indexOf('/updates/2026-10-20/')).toBeLessThan(home.indexOf('/updates/2026-10-19/'))
    const daily = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-19/index.html'), 'utf8')
    expect(daily).toContain('/updates/2026-10-19/assets/role-icons/dog.svg')
    expect(daily).toContain('id="profile"')
    expect(daily).toContain('确认后更新，取消保留原值')
    expect(daily).toContain('完整目录实拍')
    expect(daily).toContain('历史参考 · Figma')
    expect(daily).not.toContain('权威原型')
    expect(daily).not.toContain('完整原报告')
    expect(daily).not.toContain('/legacy/20261019/')
    expect(fs.existsSync(path.join(f.root, '.tmp/mip-acceptance-site/legacy/20261019/index.html'))).toBe(false)
    expect(fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/updates/2026-10-19/assets/role-icons/dog.svg'), 'utf8')).toBe(svg)
    const redirects = fs.readFileSync(path.join(f.root, '.tmp/mip-acceptance-site/_redirects'), 'utf8')
    expect(redirects).toContain('/legacy/20261019/* /updates/2026-10-19/ 301')
    expect(redirects).toContain('/legacy/20261019/role-icons/* /updates/2026-10-19/assets/role-icons/:splat 301')
    expect(fs.readFileSync(path.join(folder, 'index.html'), 'utf8')).toBe(original)
    fs.writeFileSync(path.join(folder, 'role-icons/dog.svg'), 'changed')
    expect(() => f.run('build')).toThrow()
  })
  it('分项截图纳入冻结摘要，不能在冻结后替换', () => {
    const f = fixture()
    f.write([{ ...f.report, files: [], comparisons: [], uiChange: false, sections: [{ id: 'events', title: '日期筛选', evidenceImages: [{ file: f.image, caption: '真实测试结果' }] }] }])
    f.run('freeze', 'first-v1')
    f.run('build')
    fs.writeFileSync(path.join(f.root, f.image), 'changed nested evidence')
    expect(() => f.run('build')).toThrow()
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
    fs.writeFileSync(path.join(f.root, f.image), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64'))
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
