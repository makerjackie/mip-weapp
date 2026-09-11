---
name: figma-bridge
description: Read live Figma data without a Personal Access Token through the local plugin bridge (loopback HTTP + Figma dev plugin command channel). Use proactively whenever the user wants to list Figma page frames, fetch a specific node's document JSON, export SVG icons or PNG images from Figma, restore/convert Figma designs to HTML or code, or extract design systems from an open Figma file. Triggers on "figma", "frame", "节点", "还原设计稿", "导出图标", "设计系统" when the figma-mcp-free local bridge is the data source.
---

# Figma 本地桥交互（免 PAT 读 Figma 数据）

通过本地桥 + Figma 开发插件 v5 直接读 Figma 数据，**不消耗 Figma REST API 额度，通常不需要用户点任何按钮**。

## 架构（数据怎么流）

```
你 (Agent) ── MCP 工具 / HTTP ──▶ 桥 bridge (127.0.0.1:3845, Bearer token)
                                      │  命令队列 POST /v1/commands
                                      ▼
      结果 ◀── 回传 result ── 插件 UI 每 0.9s 轮询 GET /v1/commands/next
        │                              │ postMessage
        └── 大文件落盘 outFile         Figma 插件主线程 v5 执行
                                       (list-frames / get-node / export-svg / export-png)
```

插件 iframe 只能当 HTTP 客户端，所以用「命令队列 + 轮询」实现双向通道，体感延迟约 1 秒。

## 前置检查（每次开始先做）

1. 桥活着：`get_plugin_bridge_status` MCP 工具，或
   `curl -s -H "Authorization: Bearer $FIGMA_PLUGIN_BRIDGE_TOKEN" http://localhost:3845/health`
2. 插件开着：命令通道只有在 Figma 里运行了开发插件（v5）才轮询。健康检查**无法**区分"插件没开"和"插件忙"——下发命令后超时（默认 60s）报错时，提示用户打开插件：**Plugins → Development → figma-mcp-free Local Bridge**，UI 状态行应显示「命令通道待命」和版本 v5。
3. 命令可以**先入队后执行**：插件晚开也没关系，命令在队列里等着，插件一上线就取走执行。等待用 `scripts/bridge-client.mjs wait-online` 或直接调工具设长超时。

## 两条数据路径

### 路径 A：命令通道（推荐，免点击）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `list_current_page_frames` | 当前页面全部顶层图层的轻量清单（id/名称/类型/宽高/子节点数） | 无 |
| `get_plugin_node` | 取一个节点的完整 REST JSON 子树 | `nodeId`、`depth`(0–48)、**`outFile`** |
| `export_plugin_node_svg` | 导出单节点为 SVG（矢量、图标用这个） | `nodeId`、**`outFile`** |
| `export_plugin_node_png` | 导出单节点为 PNG（位图、插画用这个） | `nodeId`、`scale`(0.1–4 默认2)、**`outFile`** |

### 路径 B：手动快照（用户按过 Capture & Send 之后才可用）

| 工具 | 用途 |
| --- | --- |
| `list_current_selections` | 最近一次捕获的选中节点清单 |
| `get_current_selection` | 读某个选中节点的完整 JSON |
| `inspect_current_selection` | 有界的紧凑实现上下文 |
| `generate_current_selection` | 直接生成 React/Vue/Svelte/HTML 起步代码 |

注意：快照是**单槽位**——每次捕获**替换**旧快照，不累积；`hasSnapshot:false` 只说明没捕获过或被清了。优先走路径 A。

## 上下文安全规则（必须遵守）

- **先轻量后定点**：永远先 `list_current_page_frames` 拿清单，再对选中的少数节点 `get_plugin_node`。不要试图一次拿整页——顶层图层可能 100+，整页 JSON 动辄几十 MB。
- **大结果必须落盘**：`get_plugin_node` 的完整子树、所有 PNG、大的 SVG，一律传 `outFile` 写到磁盘；后续生成脚本（HTML/组件库/代码）**从文件读**，不要把节点 JSON 读进对话上下文。
- **用 depth 剪枝**：只关心结构时 `depth 2–3` 就够；要像素级还原再取全量。
- 页面顶层图层 >50 时单次快照捕获装不下（上限 50），命令通道按 nodeId 逐个取没有此限制。

## 标准工作流

```
1. health 检查（桥+插件在线？）
2. list_current_page_frames → 记下目标 frame 的 id
3. get_plugin_node <frameId> --out snapshot/<名字>.json   # 落盘
4. 读磁盘文件 → 生成 HTML/组件/代码（生成脚本自己 readFileSync）
5. 需要图标/图片时逐个 export_plugin_node_svg / _png --out icons/xx.svg
6. 交付产物写到用户指定的目录
```

MCP 工具不可用时的兜底（脚本零依赖，repo 外也能跑）：

```bash
export FIGMA_PLUGIN_BRIDGE_URL=http://localhost:3845
export FIGMA_PLUGIN_BRIDGE_TOKEN=$(cat /tmp/figma-bridge-token.txt)   # 本机约定；同事按实际存放
node <skill目录>/scripts/bridge-client.mjs wait-online
node <skill目录>/scripts/bridge-client.mjs list-frames
node <skill目录>/scripts/bridge-client.mjs get-node 1987:30162 --out /tmp/node.json
node <skill目录>/scripts/bridge-client.mjs export-svg 1901:13134 --out icon.svg
```

curl 直连协议见 [references/protocol.md](references/protocol.md)。

## 排障速查

| 症状 | 原因与处置 |
| --- | --- |
| 命令超时「plugin did not answer」 | 插件没开，或还在跑旧版 code.js（UI 不显示「命令通道待命」）→ 让用户重开插件；命令已入队，开插件后自动执行 |
| 插件 UI 显示 ⚠️ 旧版 code.js | Figma 缓存了旧主线程 → 移除开发插件后从 `plugins/local-bridge/manifest.json` 重新导入（部署副本在 `~/project/get-node`） |
| `hasSnapshot:false` 但用户说点过 | 快照单槽被清/被替换，或捕获失败（插件状态行有红色错误）；改走路径 A |
| 413 / 超出上限 | 手动快照超 64MiB（`--max-body-mb` 可调）；缩小捕获范围或改用命令通道按节点取 |
| 重启桥后 MCP 全挂 | 桥必须用**同一个 token** 重启：`FIGMA_PLUGIN_BRIDGE_TOKEN=$(cat /tmp/figma-bridge-token.txt) node packages/cli/dist/bridge-cli.js serve --port 3845 --max-body-mb 64 --log-requests` |
| 插件 fetch 失败 | manifest 的 `devAllowedDomains` 只认 `http://localhost:3845`（不接受 `127.0.0.1`，本 Figma 构建的怪癖）；桥必须 loopback |
| 桥日志 | 启动时的重定向文件（本机 `nohup … > /tmp/figma-bridge.log`），`--log-requests` 时每次快照/命令都有记录 |

## Figma 数据本身的坑（写生成器前必读）

- `JSON_REST_V1` 导出**不含矢量几何**（没有 vectorPaths/fillGeometry）——图标、插画必须用 `export_plugin_node_svg`（插件内走 `SVG_STRING`）单独导。
- TEXT 节点的 `fills` 是**文字颜色**，不是背景色；背景要看父节点。
- `absoluteBoundingBox` 是画布**绝对坐标**；还原成页面时要减去 frame 原点。
- 图标命名多为 RemixIcon 风格（`check-line`、`arrow-left-s-line`），可映射到开源图标库兜底。
- 顶层图层包含大量非屏幕元素（标注卡片、区块标题 TEXT、素材 GROUP/ELLIPSE），按 `type`/尺寸过滤：真屏幕一般是 `FRAME` 且宽 375。
- **mask 节点导出是空图**：`isMask` 节点无论 PNG 还是 SVG 导出都返回 1×1/空内容（Figma 不渲染遮罩本体）——蒙版只能用几何数据自己还原（矩形遮罩用 `clip-path: inset()` + 圆角即可，偏移量 = 遮罩 bbox − 被遮元素 bbox）。
- IMAGE 填充的 `scaleMode: STRETCH` 带 `imageTransform`，CSS 应映射为 `object-fit: fill`（不是 cover）；FIT→contain、FILL→cover。
- 混排文本 `characterStyleOverrides`（每字符一个样式索引，0=基础样式，查 `styleOverrideTable`）不展开会导致彩色/加粗片段变单色；flex 容器里的子项要做 `position:relative`，否则其内部 absolute 子节点会锚到更外层（截图上表现为图标/文字挤到容器一角）。

## 同事上手（5 步）

1. `pnpm install --frozen-lockfile && pnpm -r build`
2. `pnpm --filter figma-mcp-free bridge -- serve --port 3845 --max-body-mb 64 --log-requests`（记下 token）
3. `node plugins/local-bridge/create-manifest.mjs <Figma生成的插件ID> 3845`，在 Figma Desktop 导入该 manifest 作为开发插件
4. 插件 UI 里填 URL（`http://localhost:3845`）和 token，Test connection
5. MCP 注册（token 进 env，不进对话）：

```json
{
  "mcpServers": {
    "figma-mcp-free": {
      "transport": "stdio",
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/index.js"],
      "env": {
        "FIGMA_PLUGIN_BRIDGE_URL": "http://localhost:3845",
        "FIGMA_PLUGIN_BRIDGE_TOKEN": "<PAIRING_TOKEN>"
      }
    }
  }
}
```

安全模型：桥只绑 loopback、校验 Host、timing-safe 比对 Bearer token、单快照内存存储、插件只读（无任何 Figma 写 API）。token 不要进 shell 历史、截图或提交物。
