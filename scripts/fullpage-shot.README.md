# fullpage-shot：小程序整页长截图

微信开发者工具的模拟器一次只能截一屏。这个工具把页面逐步滚动截帧，再用像素拼接成一张完整长图，用于视觉验收 / 设计稿比对。

```bash
# 页面自身有数据（已登录、云函数可用）时，一条命令即可
node scripts/fullpage-shot.mjs /packages/member/mip-cooperation/detail/index?id=xxx

# 无后端造数：等 onLoad 云调用失败落地后注入 fixture，再画雷达图
node scripts/fullpage-shot.mjs /packages/member/mip-cooperation/detail/index?id=fix1 \
  --fixture .tmp/fullpage-shots/coop-detail.json \
  --wait-error --call drawRadar --probe roleName --probe menuGridTemplate \
  --title 皮条客 --root '#mip-cooperation-detail-page'

# 复用已经打开的开发者工具（先跑过一次，或手动 cli open --auto 过同一宿主项目）
node scripts/fullpage-shot.mjs /packages/member/mip-cooperation/editor/index --connect
```

输出：`<out>/<name>-fullpage.png`（默认 `.tmp/fullpage-shots/`，`<name>` 默认取路由末两段）。
中间滚动帧默认拼完即删；`--keep-frames` 保留帧和 `<name>.manifest.json`（排查拼接缝问题时用）。

## 参数

| 参数 | 说明 |
| --- | --- |
| `<页面路径>` / `--route` | 页面路径，可带 query；位置参数与 `--route` 二选一 |
| `--fixture <file>` | 注入的 page data JSON；不传则用页面自身数据 |
| `--out <dir>` | 输出目录，默认 `.tmp/fullpage-shots` |
| `--name <name>` | 输出文件名前缀，默认取路由末两段（如 `mip-cooperation-detail`） |
| `--title <text>` | 覆盖导航栏标题（截图里看得见，标场景用） |
| `--call <method>` | `setData` 后依次调用的页面方法，可重复（如 canvas 重绘 `drawRadar`） |
| `--probe <field>` | data 字段新鲜度探针，可重复；缺字段 = 连到了旧 bundle，直接报错 |
| `--wait-error` | 先等 onLoad 云调用失败落地（`state==='error'`）再注入 fixture |
| `--expect-state <v>` | fixture 注入后断言 `data.state` |
| `--root <selector>` | 页面根节点存在性检查（如 `#mip-cooperation-detail-page`） |
| `--settle <ms>` | `reLaunch` 后的初始等待，默认 1400 |
| `--connect` / `--port <n>` | 只连已打开的 automator 会话；端口默认按宿主项目推导 |
| `--keep-frames` | 保留中间滚动帧与 manifest |

## 原理（6 步）

1. **宿主项目**：开发者工具必须打开 checkout 外的宿主目录（`scripts/lib/devtools-host.mjs` 同步 dist 与真实 appid 到 `~/Library/Caches/mip-weapp-devtools/<name>-<hash>`）。直接开仓库目录会让嵌套项目折叠进已开工作区，automator 连错小程序。
2. **造数**：无后端时先 `--wait-error` 轮询 `page.data()` 等 onLoad 的云调用失败落地，再 `setData(fixture)` —— 否则迟到的 catch 会覆盖注入。连接后用 `--probe` 检查新代码才有的 data 字段，防止截到旧 bundle。
3. **标定**：`scrollTop 0 / 400` 各截一帧做行差分 → 固定导航高（图像 px）；步长 ≈ 0.62×视口，再减吸底栏估值（半透明液态玻璃行差分探不到，按 130 逻辑 px 留边）。
4. **实测几何**：可滚距离必须问 `wx.createSelectorQuery().selectViewport().scrollOffset()`（根元素高度 ≠ 可滚高度）；`wx.pageScrollTo({ scrollTop, duration: 0 })` 落位精确。
5. **稳帧 + 截帧**：每次滚动后连拍两帧，导航以下像素完全静止才采用（`scripts/lib/fullpage-shot.mjs` 的 `stableShot`）。
6. **互相关拼接**：合成器会滞后 DOM scrollOffset 14–29px（画面静止但停在旧位置，等待无法消除），所以每帧的真实视觉偏移用图像互相关求 —— 帧 i 顶部 96px 条带对帧 i-1 搜索 ±40px 取最小行差；多解（平坦区）回退 DOM 记录值。帧 0 贴顶，帧 i 内容带贴 `y = navH + 偏移_i`，末帧贴底（吸底栏只出现一次）。

## 已知限制

- 只支持**页面级滚动**（`pageScrollTo` 生效的页面）；`scroll-view` 内滚动的页面不适用。
- 半透明吸底栏 / 胶囊遮住的内容，任何滚动位都截不到，长图上属可接受极限。
- 拼接依赖帧间内容有纹理；整屏纯色区块可能出现匹配歧义，此时自动回退 DOM 位移（日志会标注）。
- 首次运行会拉起开发者工具（约 1–2 分钟）；之后 `--connect` 复用秒级。

## 排错速查

| 症状 | 原因 / 处理 |
| --- | --- |
| `stale bundle: data lacks probe fields` | 连到了旧 bundle：重新构建（`pnpm build:mp`），或关掉旧窗口后重跑 |
| fixture 注入后被空态/报错态覆盖 | 没等 `load()` 失败落地，加 `--wait-error` |
| 长图有重影 / 断层 | 用 `--keep-frames` 留帧，看 manifest 里各帧 `diff/ties`；`ties>12` 说明该帧走了 DOM 回退 |
| automator 连到别的小程序 | 宿主项目被嵌套打开：关闭工具里所有该项目窗口，重跑（工具会自己拉起宿主） |
| 页面跳转超时 | 模拟器刚被重启还在恢复：等 10 秒重跑 |
