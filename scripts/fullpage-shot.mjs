#!/usr/bin/env node
// 整页长截图 CLI：node scripts/fullpage-shot.mjs /packages/member/mip-cooperation/detail/index?id=fix1 \
//   --fixture .tmp/fullpage-shots/coop-detail.json --wait-error --call drawRadar
// 用法与原理见 scripts/fullpage-shot.README.md
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { captureFullPageFrames, fail, openFullPageSession, stitchFullPage } from './lib/fullpage-shot.mjs'

const USAGE = `整页长截图：滚动截帧 + 帧间互相关拼接，输出 <out>/<name>-fullpage.png

用法
  node scripts/fullpage-shot.mjs <页面路径> [选项]
  node scripts/fullpage-shot.mjs --route <页面路径> [选项]

选项
  --route <path>       页面路径（也可作为第一个位置参数），可带 query
  --fixture <file>     注入的 page data JSON（无后端造数用；不传则用页面自身数据）
  --out <dir>          输出目录（默认 .tmp/fullpage-shots）
  --name <name>        输出文件名前缀（默认取路由末两段，如 mip-cooperation-detail）
  --title <text>       覆盖导航栏标题
  --call <method>      setData 后依次调用的页面方法，可重复（如 --call drawRadar）
  --probe <field>      data 字段新鲜度探针，可重复；缺字段 = 连到了旧 bundle，直接报错
  --wait-error         先等 onLoad 云调用失败落地（state==='error'）再注入 fixture
  --expect-state <v>   fixture 注入后断言 data.state
  --root <selector>    可选的页面根节点存在性检查（如 #mip-cooperation-detail-page）
  --settle <ms>        reLaunch 后的初始等待（默认 1400）
  --connect            只连已打开的 automator 会话，不拉起开发者工具
  --port <n>           automator 端口（默认按宿主项目推导，weapp-ide-cli 同款）
  --keep-frames        保留中间滚动帧与 manifest（默认拼接成功后清理）
  -h, --help           显示本帮助`

function parseArgs(argv) {
  const options = { calls: [], probes: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      i += 1
      if (i >= argv.length) {
        throw new Error(`${arg} 缺少参数值`)
      }
      return argv[i]
    }
    switch (arg) {
      case '-h':
      case '--help':
        console.log(USAGE)
        process.exit(0)
        break
      case '--route':
        options.route = value()
        break
      case '--fixture':
        options.fixturePath = value()
        break
      case '--out':
        options.out = value()
        break
      case '--name':
        options.name = value()
        break
      case '--title':
        options.title = value()
        break
      case '--call':
        options.calls.push(value())
        break
      case '--probe':
        options.probes.push(value())
        break
      case '--wait-error':
        options.waitForError = true
        break
      case '--expect-state':
        options.expectState = value()
        break
      case '--root':
        options.rootSelector = value()
        break
      case '--settle':
        options.settleMs = Number(value())
        break
      case '--connect':
        options.connect = true
        break
      case '--port':
        options.port = Number(value())
        break
      case '--keep-frames':
        options.keepFrames = true
        break
      default:
        if (arg.startsWith('-')) {
          throw new Error(`未知参数 ${arg}`)
        }
        if (options.route) {
          throw new Error(`多余的位置参数 ${arg}（页面路径只传一次）`)
        }
        options.route = arg
    }
  }
  return options
}

function defaultName(route) {
  const clean = route.split('?')[0]
  const parts = clean.split('/').filter(Boolean)
  return parts.slice(-2).join('-') || 'page'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.route) {
    console.log(USAGE)
    process.exit(1)
  }

  const root = process.cwd()
  const outDir = path.resolve(root, options.out ?? '.tmp/fullpage-shots')
  const name = options.name ?? defaultName(options.route)
  const fixture = options.fixturePath
    ? JSON.parse(readFileSync(path.resolve(root, options.fixturePath), 'utf8'))
    : null
  mkdirSync(outDir, { recursive: true })

  console.log(`session: ${options.connect ? 'connect' : 'auto'}${options.port ? ` port ${options.port}` : ''}`)
  const { mini } = await openFullPageSession({ root, connect: options.connect, port: options.port })
  console.log('automator ready')
  try {
    const entry = await captureFullPageFrames(mini, {
      name,
      route: options.route,
      fixture,
      probes: options.probes,
      waitForError: options.waitForError,
      expectState: options.expectState,
      calls: options.calls,
      title: options.title,
      rootSelector: options.rootSelector,
      settleMs: options.settleMs,
      shotsDir: outDir,
    })
    const result = stitchFullPage(entry, outDir)

    if (options.keepFrames) {
      writeFileSync(path.join(outDir, `${name}.manifest.json`), JSON.stringify(entry, null, 2))
      console.log(`frames kept in ${outDir} (manifest: ${name}.manifest.json)`)
    }
    else {
      for (const file of entry.frames) {
        rmSync(path.join(outDir, file))
      }
      // 标定帧已由采集阶段清理；目录里只剩整页长图
    }
    console.log(`done: ${path.relative(root, result.file)}`)
  }
  finally {
    mini.disconnect()
  }
}

main().catch(error => fail(error?.message || error))
