#!/usr/bin/env node
/**
 * bridge-client.mjs — 零依赖的 figma-mcp-free 本地桥命令行客户端。
 *
 * 不需要构建本仓库：raw fetch，直接和桥的 HTTP 协议对话。
 * 用途：MCP 工具不可用时兜底，或其他脚本里复用。
 *
 * 环境变量：
 *   FIGMA_PLUGIN_BRIDGE_URL    默认 http://localhost:3845
 *   FIGMA_PLUGIN_BRIDGE_TOKEN  必填（桥启动时打印；本机存于 /tmp/figma-bridge-token.txt）
 *
 * 用法：
 *   node bridge-client.mjs wait-online [--timeout 180] [--interval 1000]
 *   node bridge-client.mjs list-frames
 *   node bridge-client.mjs get-node <nodeId> [--depth 0-48] [--out <file>]
 *   node bridge-client.mjs export-svg <nodeId> [--out <file>]
 *   node bridge-client.mjs export-png <nodeId> [--scale 0.1-4] [--out <file>]
 *
 * --out 缺省时结果打印到 stdout（大节点会刷屏，建议总是 --out）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function config() {
  const baseUrl = (process.env.FIGMA_PLUGIN_BRIDGE_URL || "http://localhost:3845").replace(/\/+$/, "");
  const token = (process.env.FIGMA_PLUGIN_BRIDGE_TOKEN || "").trim();
  if (!token) {
    console.error("缺少 FIGMA_PLUGIN_BRIDGE_TOKEN 环境变量（桥启动时打印的 pairing token）。");
    process.exit(2);
  }
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
    console.error(`桥 URL 必须是 loopback HTTP origin，收到: ${baseUrl}`);
    process.exit(2);
  }
  return { baseUrl, token };
}

async function request({ baseUrl, token }, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {})
      }
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = body && body.error ? body.error : `HTTP ${response.status}`;
      throw new Error(`${path} 失败: ${message}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${path} 超时（15s）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 入队一条命令并轮询结果，返回 result 字段。 */
async function runCommand(bridge, type, params, timeoutMs) {
  const { id } = await request(bridge, "/v1/commands", {
    method: "POST",
    body: JSON.stringify({ type, params })
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const entry = await request(bridge, `/v1/commands/${encodeURIComponent(id)}`);
    if (entry.status === "pending") {
      if (Date.now() > deadline) {
        throw new Error(
          `命令 ${type} 在 ${Math.round(timeoutMs / 1000)}s 内没有结果。` +
            "Figma 里的开发插件可能没开——请在 Figma 运行 Plugins → Development → figma-mcp-free Local Bridge（UI 应显示「命令通道待命」）。" +
            "命令仍在队列中，插件一上线就会被执行。"
        );
      }
      continue;
    }
    if (entry.status === "error") throw new Error(`命令 ${type} 执行失败: ${entry.error || "未知错误"}`);
    return entry.result;
  }
}

async function writeOut(outFile, data) {
  if (!outFile) return undefined;
  const target = outFile;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return target;
}

function usage() {
  console.error("用法: node bridge-client.mjs <wait-online|list-frames|get-node|export-svg|export-png> ...");
  process.exit(2);
}

const [command, firstArg] = process.argv.slice(2);
if (!command) usage();
const { positional, options } = parseArgs(process.argv.slice(3));
const bridge = config();
const timeoutMs = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) * 1000 : 180000;

switch (command) {
  case "wait-online": {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const health = await request(bridge, "/health");
        console.log(`桥在线: session ${health.sessionId.slice(0, 8)}, 快照 ${health.hasSnapshot ? health.selectionCount + " 条" : "空"}, 命令队列 ${health.commandQueueDepth}`);
        // health 不反映插件是否轮询；真正可靠的探测是下发一条轻量命令。
        try {
          const result = await runCommand(bridge, "list-frames", {}, Math.min(15000, Math.max(5000, deadline - Date.now())));
          console.log(`插件在线: 页面「${result.page.name}」共 ${result.frameCount} 个顶层图层`);
          process.exit(0);
        } catch {
          // 插件还没上线，继续等
        }
      } catch (error) {
        console.error(error.message);
      }
      if (Date.now() > deadline) {
        console.error(`等待超时（${Math.round(timeoutMs / 1000)}s）: 桥或插件仍不可用。`);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, Number(options.interval) || 1000));
    }
  }
  case "list-frames": {
    const result = await runCommand(bridge, "list-frames", {}, timeoutMs);
    const out = await writeOut(options.out, JSON.stringify(result, null, 2));
    console.log(`页面「${result.page.name}」(${result.page.id}) 共 ${result.frameCount} 个顶层图层:`);
    for (const frame of result.frames) {
      console.log(`  ${frame.id.padEnd(12)} ${String(frame.type).padEnd(10)} ${Math.round(frame.width)}×${Math.round(frame.height)}  ${frame.name}`);
    }
    if (out) console.log(`\n完整 JSON 已写入 ${out}`);
    break;
  }
  case "get-node": {
    if (!firstArg) usage();
    const params = { nodeId: firstArg };
    if (options.depth !== undefined) params.depth = Number(options.depth);
    const result = await runCommand(bridge, "get-node", params, timeoutMs);
    const out = await writeOut(options.out, JSON.stringify(result, null, 2));
    if (out) {
      console.log(`节点 ${result.node.id}「${result.node.name}」(${result.node.type}) → ${out} (${(await import("node:fs")).statSync(out).size} 字节)`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    break;
  }
  case "export-svg": {
    if (!firstArg) usage();
    const result = await runCommand(bridge, "export-svg", { nodeId: firstArg }, timeoutMs);
    const out = await writeOut(options.out || `${result.name.replace(/[^\w.-]+/g, "_")}.svg`, result.svg);
    console.log(out ? `SVG「${result.name}」(${result.width}×${result.height}) → ${out}` : result.svg);
    break;
  }
  case "export-png": {
    if (!firstArg) usage();
    const params = { nodeId: firstArg };
    if (options.scale !== undefined) params.scale = Number(options.scale);
    const result = await runCommand(bridge, "export-png", params, timeoutMs);
    const base64 = result.dataUrl.split(",", 2)[1] || "";
    const out = await writeOut(options.out || `${result.name.replace(/[^\w.-]+/g, "_")}.png`, Buffer.from(base64, "base64"));
    console.log(out ? `PNG「${result.name}」(${result.width}×${result.height}, scale ${result.scale}) → ${out}` : result.dataUrl);
    break;
  }
  default:
    usage();
}
