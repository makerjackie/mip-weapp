// 小程序整页长截图：滚动截帧 + 帧间互相关拼接（参考 MIW-48，详见 scripts/fullpage-shot.README.md）
// DevTools 模拟器一次只能截一屏；整页 = pageScrollTo 逐步滚动截帧，再用 pngjs 拼成一张长图。
// 单位约定：截图像素（ss = 截图宽 / 375），逻辑 px 只在 scrollOffset / pageScrollTo 处出现。
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { PNG } from 'pngjs'
import {
  acquireSharedMiniProgram,
  resolveProjectAutomatorPort,
} from 'weapp-ide-cli'
import { clearStaleAutomatorPortLease, isLocalPortListening } from './devtools-automator-session.mjs'
import { resolveLocalDevtoolsHostRoot, syncLocalDevtoolsHost } from './devtools-host.mjs'
import { warmWechatDevtoolsProject } from './devtools-project-warmup.mjs'

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// —— 标定：scrollTop 0 / 400 两帧行差分求固定导航高（状态栏+标题栏），受时钟噪声时回退默认值 ——
function rowsDiffer(a, b, y, w) {
  const ia = a.data
  const ib = b.data
  for (let x = 0; x < w * 4; x += 4) {
    if (Math.abs(ia[y * w * 4 + x] - ib[y * w * 4 + x]) > 8) {
      return true
    }
  }
  return false
}

function fixedBands(fileA, fileB) {
  const a = PNG.sync.read(readFileSync(fileA))
  const b = PNG.sync.read(readFileSync(fileB))
  const { width: w, height: h } = a
  let navH = 0
  while (navH < h - 1 && !rowsDiffer(a, b, navH, w)) {
    navH += 1
  }
  // 状态栏+标题栏 ≈ 88 逻辑 px；差分受动画/时钟噪声时回退默认值
  return { navH: navH >= 120 && navH <= 220 ? navH : 148, height: h, width: w }
}

// —— 稳帧：DOM scrollOffset 就位不代表合成器就位（常见 14–29px 滞后），连拍直到画面静止 ——
function framesStatic(a, b, navH) {
  if (a.width !== b.width || a.height !== b.height) {
    return false
  }
  for (let y = navH + 4; y < a.height; y += 6) {
    const row = y * a.width * 4
    for (let x = 0; x < a.width * 4; x += 16) {
      if (Math.abs(a.data[row + x] - b.data[row + x]) > 2) {
        return false
      }
    }
  }
  return true
}

async function stableShot(mini, file, navH, scratchDir) {
  const a = path.join(scratchDir, '.fullpage-shot-a.png')
  const b = path.join(scratchDir, '.fullpage-shot-b.png')
  await mini.screenshot({ path: a })
  for (let i = 0; i < 8; i += 1) {
    await sleep(280)
    await mini.screenshot({ path: b })
    const settled = framesStatic(PNG.sync.read(readFileSync(a)), PNG.sync.read(readFileSync(b)), navH)
    if (settled) {
      break
    }
    await mini.screenshot({ path: a })
  }
  copyFileSync(b, file)
  unlinkSync(a)
  unlinkSync(b)
}

// 实测滚动几何：根元素高度 ≠ 可滚高度，scrollHeight 必须问 viewport.scrollOffset
function readScrollOffset(mini) {
  return mini.evaluate(() => new Promise((resolve) => {
    wx.createSelectorQuery().selectViewport().scrollOffset().exec((res) => {
      const off = res && res[0]
      resolve({ scrollTop: off ? off.scrollTop : 0, scrollHeight: off ? off.scrollHeight : 0 })
    })
  }))
}

/**
 * 打开（或复用）宿主项目的 automator 会话。
 * @param {{ root: string, connect?: boolean, port?: number, timeout?: number }} options
 *  - connect: 只连已打开的会话（开发者工具需先 --auto 装载同一宿主项目）
 *  - 默认：端口没人听时先 cli open 预热项目，再由 weapp-ide-cli 连接或拉起
 */
export async function openFullPageSession(options) {
  const { root, connect = false, port: portOverride, timeout = 180000 } = options
  const hostRoot = resolveLocalDevtoolsHostRoot(root)
  syncLocalDevtoolsHost({ sourceRoot: root, hostRoot })
  const port = portOverride ?? resolveProjectAutomatorPort(hostRoot)
  if (!connect && !(await isLocalPortListening(port))) {
    await warmWechatDevtoolsProject({ projectPath: hostRoot })
  }
  if (await clearStaleAutomatorPortLease(port)) {
    console.log(`cleared stale automator port lease on ${port}`)
  }
  const mini = await acquireSharedMiniProgram({
    projectPath: hostRoot,
    port,
    preserveProjectRoot: true,
    trustProject: true,
    timeout,
    preferOpenedSession: connect,
    sharedSession: true,
    openedOnly: connect,
  })
  return { mini, hostRoot, port }
}

/**
 * 采集一个页面的滚动帧，返回 manifest 条目（帧文件写入 options.shotsDir）。
 * @param {object} mini automator 会话
 * @param {object} options
 *  - name: 输出文件名前缀
 *  - route: 页面路径（可带 query）
 *  - fixture: 注入的 page data（无后端造数用）；不传则用页面自身数据
 *  - probes: data 字段新鲜度探针（缺字段 = 连到了旧 bundle）
 *  - waitForError: 先等 onLoad 云调用失败落地（state==='error'）再注入 fixture
 *  - expectState: fixture 注入后断言的 data.state
 *  - calls: setData 后依次调用的页面方法（如 drawRadar）
 *  - title: 覆盖导航栏标题
 *  - rootSelector: 可选的页面根节点存在性检查
 *  - settleMs: reLaunch 后的初始等待（默认 1400）
 */
export async function captureFullPageFrames(mini, options) {
  const {
    name,
    route,
    fixture = null,
    probes = [],
    waitForError = false,
    expectState = null,
    calls = [],
    title = null,
    rootSelector = null,
    settleMs = 1400,
    shotsDir,
  } = options

  await mini.reLaunch(route)
  await sleep(settleMs)
  const page = await mini.currentPage()

  const probeData = await page.data()
  const missing = probes.filter(key => !(key in probeData))
  if (missing.length) {
    throw new Error(`stale bundle: ${name} data lacks probe fields [${missing.join(', ')}]`)
  }

  // fixture 竞态：onLoad 云调用的迟到 catch 会覆盖注入，先等失败落地再 setData
  if (waitForError) {
    const deadline = Date.now() + 20000
    for (;;) {
      const data = await page.data()
      if (data.state === 'error') {
        break
      }
      if (Date.now() > deadline) {
        throw new Error(`${name}: load() never settled`)
      }
      await sleep(400)
    }
  }
  else if (fixture) {
    // 云环境可用时页面会成功加载真数据，迟到的成功响应同样会覆盖注入——等 ready 落地再注入
    const deadline = Date.now() + 20000
    for (;;) {
      const data = await page.data()
      if (data.state && data.state !== 'loading') {
        break
      }
      if (Date.now() > deadline) {
        break
      }
      await sleep(400)
    }
  }
  if (fixture) {
    await page.setData(fixture)
    await sleep(700)
  }
  for (const method of calls) {
    await page.callMethod(method)
    await sleep(900)
  }
  if (title) {
    await mini.evaluate(value => wx.setNavigationBarTitle({ title: value }), title)
    await sleep(300)
  }
  if (expectState) {
    const data = await page.data()
    if (data.state !== expectState) {
      throw new Error(`${name}: state=${data.state} (expected ${expectState})`)
    }
  }
  if (rootSelector && !(await page.$(rootSelector))) {
    throw new Error(`${name}: root ${rootSelector} not found`)
  }

  // 标定：scrollTop 0 与 400 两帧行差分 → 固定导航高（图像像素）
  await mini.pageScrollTo(0)
  await sleep(500)
  const calA = path.join(shotsDir, `${name}-calA.png`)
  await mini.screenshot({ path: calA })
  await mini.pageScrollTo(400)
  await sleep(450)
  const calB = path.join(shotsDir, `${name}-calB.png`)
  await mini.screenshot({ path: calB })
  const bands = fixedBands(calA, calB)

  const ss = bands.width / 375
  const navH = bands.navH
  await mini.evaluate(() => wx.pageScrollTo({ scrollTop: 99999, duration: 0 }))
  await sleep(300)
  const maxInfo = await readScrollOffset(mini)
  const maxScrollLogical = maxInfo.scrollTop
  const scrollHeightLogical = maxInfo.scrollHeight
  const visibleLogical = Math.round((bands.height - navH) / ss)
  const maxScrollPx = Math.round(maxScrollLogical * ss)
  const barEstimatePx = Math.round(130 * ss) // 液态玻璃吸底栏（半透明，行差分探不到），按估值留边
  const stepPx = Math.max(200, Math.min(bands.height - navH - barEstimatePx - 40, Math.round(0.62 * (bands.height - navH))))
  const stepLogical = Math.floor(stepPx / ss)

  const positions = []
  for (let p = 0; positions.length === 0 || p < maxScrollLogical; p += stepLogical) {
    positions.push(Math.min(p, maxScrollLogical))
    if (p >= maxScrollLogical) {
      break
    }
  }
  if (positions[positions.length - 1] !== maxScrollLogical) {
    positions.push(maxScrollLogical)
  }

  const frames = []
  const actuals = []
  for (const [i, p] of positions.entries()) {
    await mini.evaluate(pos => wx.pageScrollTo({ scrollTop: pos, duration: 0 }), p)
    await sleep(220)
    const file = path.join(shotsDir, `${name}-f${String(i).padStart(2, '0')}.png`)
    await stableShot(mini, file, navH, shotsDir)
    const off = await readScrollOffset(mini)
    if (off.scrollTop !== p) {
      throw new Error(`${name} frame ${i}: settled offset ${off.scrollTop} ≠ requested ${p}`)
    }
    actuals.push(off.scrollTop)
    frames.push(path.basename(file))
    console.log(`  [${name}] frame ${i} scrollTop=${off.scrollTop}/${maxScrollLogical}`)
  }
  unlinkSync(calA)
  unlinkSync(calB)

  return {
    scenario: name,
    route,
    capturedAt: new Date().toISOString(),
    scrollHeightLogical,
    visibleLogical,
    maxScrollLogical,
    maxScrollPx,
    navH,
    frameH: bands.height,
    ss: Number(ss.toFixed(4)),
    stepLogical,
    stepPx,
    actuals,
    frames,
  }
}

// —— 拼接：帧 i 的真实视觉偏移由图像互相关求出（合成器滞后 DOM 14–29px，DOM 记录值不可信）——
const STRIP = 96 // 顶部匹配条带高度（px）
const ROW_STEP = 6
const SEARCH = 40 // 相对 DOM 步长的搜索半径（px）

function rowPairDiff(a, b, ya, yb, w) {
  let d = 0
  const ra = ya * w * 4
  const rb = yb * w * 4
  for (let x = 0; x < w * 4; x += 8) {
    d += Math.abs(a.data[ra + x] - b.data[rb + x])
  }
  return d / (w * 4 / 8)
}

function estimateShift(prev, frame, navH, nominalPx) {
  let best = Number.POSITIVE_INFINITY
  let bestD = Number.NaN
  let ties = 0
  for (let d = -SEARCH; d <= SEARCH; d += 1) {
    const rel = navH + nominalPx + d // 名义步长附近搜索
    if (rel < navH || rel + STRIP > prev.height) {
      continue
    }
    let sum = 0
    for (let k = 0; k < STRIP; k += ROW_STEP) {
      sum += rowPairDiff(frame, prev, navH + 4 + k, rel + 4 + k, prev.width)
    }
    const avg = sum / (STRIP / ROW_STEP)
    if (avg < best - 1e-9) {
      best = avg
      bestD = d
      ties = 1
    }
    else if (Math.abs(avg - best) < 0.2) {
      ties += 1
    }
  }
  return { d: bestD, diff: best, ties }
}

/**
 * 把 manifest 条目的滚动帧拼成整页长图，返回 { file, width, height }。
 */
export function stitchFullPage(entry, shotsDir) {
  const frames = entry.frames.map(f => PNG.sync.read(readFileSync(path.join(shotsDir, f))))
  const H = frames[0].height
  const W = frames[0].width
  for (const f of frames) {
    if (f.width !== W || f.height !== H) {
      throw new Error(`frame size mismatch in ${entry.scenario}`)
    }
  }
  const { navH, ss, actuals } = entry
  const n = frames.length

  const offsetsPx = [0] // 帧 0 锚定页面顶部
  for (let i = 1; i < n; i += 1) {
    const domD = Math.round((actuals[i] - actuals[i - 1]) * ss)
    const { d, diff, ties } = estimateShift(frames[i - 1], frames[i], navH, domD)
    const ambiguous = ties > 12 || !Number.isFinite(d)
    if (ambiguous) {
      console.log(`  [${entry.scenario}] frame ${i}: 匹配歧义(ties=${ties}) → 回退 DOM 位移 ${domD}px`)
      offsetsPx.push(offsetsPx[i - 1] + domD)
    }
    else {
      console.log(`  [${entry.scenario}] frame ${i}: 视觉位移 ${domD + d}px (DOM ${domD}px, 差 ${-d}px, diff=${diff.toFixed(2)}, ties=${ties})`)
      offsetsPx.push(offsetsPx[i - 1] + domD + d)
    }
  }

  const lastPx = offsetsPx[n - 1]
  const out = new PNG({ width: W, height: lastPx + H })

  // 帧 0：固定导航 + 首屏内容
  PNG.bitblt(frames[0], out, 0, 0, W, H, 0, 0)
  // 帧 i：内容带 [o_i, o_{i+1}) 取自帧 i 顶部（帧 i 行 navH 对应页面 o_i）；末帧贴底（吸底栏只出现一次）
  for (let i = 1; i < n; i += 1) {
    const top = navH + offsetsPx[i]
    const isLast = i + 1 === n
    const bandH = isLast ? H - navH : navH + offsetsPx[i + 1] - top
    if (bandH <= 0) {
      continue
    }
    PNG.bitblt(frames[i], out, 0, navH, W, bandH, 0, top)
  }

  const file = path.join(shotsDir, `${entry.scenario}-fullpage.png`)
  writeFileSync(file, PNG.sync.write(out))
  console.log(`  [${entry.scenario}] → ${W}x${lastPx + H} ${path.basename(file)}`)
  return { file, width: W, height: lastPx + H }
}

/** 兜底：进程退出码必须非 0（house 约定，后台日志只看尾部）。 */
export function fail(message) {
  console.error(`FULLPAGE-SHOT FAILED: ${message}`)
  process.exit(1)
}
