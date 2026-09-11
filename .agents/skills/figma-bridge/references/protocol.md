# 桥 HTTP 协议参考

所有请求都需要 `Authorization: Bearer <token>`；只接受 loopback 直连（校验 remote address 与 Host 头）；响应 `Cache-Control: no-store`。实现见 `packages/figma-client/src/plugin-bridge.ts`。

## 快照端点（路径 B，手动捕获）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ok, sessionId, hasSnapshot, selectionCount, assetCount, commandQueueDepth, capturedAt}` |
| GET | `/v1/snapshot` | 读当前快照（无则 404） |
| POST | `/v1/snapshot` | 插件上传快照（body ≤ maxBodyBytes，默认/本机 64MiB） |
| DELETE | `/v1/snapshot` | 清空快照槽 |

快照体：`{fileName, pageName, captureMode, requestedCount, selections[{id,name,type,document}], assets[{kind:"svg"|"image", role, id, name, type, frameId?, width?, height?, svg?|dataUrl?}], skipped[]}`。资产上限：svg 500K 字符/个、image dataURL 2M 字符/个、共 500 个。

## 命令通道端点（路径 A，免点击）

| 方法 | 路径 | 调用方 | 说明 |
| --- | --- | --- | --- |
| POST | `/v1/commands` | Agent/MCP | 入队 `{type, params}` → `201 {id, queued, queueDepth}`；队列满 429 |
| GET | `/v1/commands/next` | 插件 | 取走最旧命令 → `{command: {id, type, params, createdAt} | null}`；取走即进入 running |
| POST | `/v1/commands/{id}/result` | 插件 | 回传 `{ok:true, result}` 或 `{ok:false, error}` → `{accepted, status}`；重复回传 409 |
| GET | `/v1/commands/{id}` | Agent/MCP | 查结果：`{id, status:"pending"}` 或 `{id, type, status:"done"|"error", result?, error?, completedAt}`；未知/过期 404 |

状态机：`queued → running → done | error`。结果内存保留 TTL 15 分钟、最多 64 条（先到先删）。

## 命令类型与参数

| type | params | 插件内执行 | result |
| --- | --- | --- | --- |
| `list-frames` | 无 | `currentPage().children`（截前 200 个） | `{page:{id,name}, frameCount, frames:[{id,name,type,width,height,childCount}]}` |
| `get-node` | `nodeId`（必填）、`depth`（0–48，默认 48） | `getNodeByIdAsync` + `exportAsync({format:"JSON_REST_V1"})`，按 depth 剪枝（截断处写 `childrenTruncated:true, childCount:N`） | `{node:<REST JSON>}` |
| `export-svg` | `nodeId` | `exportAsync({format:"SVG_STRING"})` | `{id, name, type, width, height, svg}` |
| `export-png` | `nodeId`、`scale`（0.1–4，默认 2） | `exportAsync({format:"PNG", constraint:{type:"SCALE", value:scale}})` + base64 | `{id, name, type, width, height, scale, dataUrl:"data:image/png;base64,…"}` |

参数校验失败 400；`nodeId` 为空、类型不在白名单、depth/scale 越界都会被拒。

## 轮询与超时建议

- 插件 UI 每 900ms 轮询一次 `next`，忙时（上一条未回传）跳过——一条命令的端到端延迟 ≈ 1s + Figma 导出耗时。
- MCP 侧 `runCommand`：入队后每 400ms 轮询 `GET /v1/commands/{id}`，默认总超时 60s（env `FIGMA_PLUGIN_COMMAND_TIMEOUT_MS` 可调）。大 frame 的 PNG 导出可能 >10s，超时就调大。
- 插件没开时命令安静地待在队列里；`wait-online` 轮询 `/health` 没用（health 不反映插件存活），正确姿势是直接下发命令并给足超时。

## 插件 → 桥的消息流（维护者参考）

1. 插件 UI 启动 → 发 `ui-ready` 给主线程 → 主线程回 `plugin-ready {version:"v5-cmd"}` + selection summary。
2. UI `startCommandPolling()`（token/URL 可用才启动）：`GET /v1/commands/next` → 有命令则 `postMessage {type:"run-command", command}` 给主线程。
3. 主线程执行 → `postMessage {type:"command-result", id, ok, result|error}` → UI `POST /v1/commands/{id}/result`。
4. 手动捕获：按钮 → `capture-selection`/`capture-page` → 主线程 `captureNodes()`（JSON_REST_V1 + SVG/PNG 资产收集）→ UI 校验体积（64MiB）→ `POST /v1/snapshot`。

## 本机部署事实（2026-09-07）

- 插件部署目录：`~/project/get-node`（manifest id `1678440917256559204`，`devAllowedDomains: ["http://localhost:3845"]`——本 Figma 构建拒绝 `127.0.0.1`）。
- token：`/tmp/figma-bridge-token.txt`（32 字节 hex；重启桥必须复用，否则 MCP env 失效）。
- 桥进程：`FIGMA_PLUGIN_BRIDGE_TOKEN=$(cat /tmp/figma-bridge-token.txt) nohup node packages/cli/dist/bridge-cli.js serve --port 3845 --max-body-mb 64 --log-requests > /tmp/figma-bridge.log 2>&1 &`
- MCP 注册：Claude Code local scope，env 带 URL + token；**新增 MCP 工具后需重连 MCP 才会出现**。
- 千万不要在 `~/project/get-node` 里跑 `npm run build`/`watch`——脚手架的 tsc 会用 stub 覆盖 `code.js`。
