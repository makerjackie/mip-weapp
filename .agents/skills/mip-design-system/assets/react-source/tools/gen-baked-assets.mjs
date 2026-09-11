#!/usr/bin/env node
/**
 * gen-baked-assets.mjs — 把 CooperationCard / LevelBanner 的固定装饰层烘焙成单张切图，
 * 交付 deliverables/miniprogram/（@3x 主图 + @2x 降采样），组件层只叠动态文字/进度条。
 *
 * 为什么浏览器烘焙而不是 Figma 直出：设计稿卡内含示例人名/strip 文字（组件里是动态 prop），
 * 桥只读无法隐藏图层后导出；本仓库装饰栈已与 Figma 原图逐像素校验（六变种总分 92.36，
 * 残差全在文字区），烘焙即得装饰区与 Figma 一致的图。
 *
 * 重生成：node tools/gen-baked-assets.mjs（纯本地，走 components/icons.js + pages/assets/）。
 * 改配色/插画后：先改本文件 VARIANTS 表，再重跑本工具，并同步 components/business.jsx 的
 * COOP_VARIANTS（name/light 文字用色）——两处靠本注释互为锚点。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT = join(root, "deliverables", "miniprogram");
const SCALE = 3; // @3x 主图；@2x 由 LANCZOS 降采样
const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";

/* ---------- 装饰栈源数据（与 components/business.jsx COOP_VARIANTS 同源，实测自合作卡页） ---------- */
const VARIANTS = {
  "dogplaner": {
    bg: "#7b00ff", tint: "#dab8ff", light: "#f2e5ff", shade: "#6500d1", deco: "#3b007a",
    ill: "3b5bb2a92668092ece4b8449e9f00149cac5c52c",
    extra: { src: "56815342bc4353b4204f45b3d29fc2b87f8eb2e7", left: 263, top: 22, width: 84, height: 84 },
  },
  "upstart": {
    bg: "#7a2900", tint: "#fadab3", light: "#fadab3", shade: "#4d1a00", deco: "#7a2900",
    ill: "fd8f426fc476f09ed6f338582118c822eb297d4c",
    extra: { src: "baf5dca5c3a95696831e520848c83b8b6919b105", left: 263, top: 22, width: 84, height: 84 },
  },
  "design-slave": {
    bg: "#04a44f", tint: "#affdd4", light: "#e5fff1", shade: "#028840", deco: "#04a44f",
    ill: "41ebbbd28de994cf4794edfe4ac8bd6e988ff27f",
    extra: { src: "6fb4a15ed73220a1f2dbe3332f0e0c94a29e0e97", left: 263, top: 22, width: 84, height: 84 },
  },
  "pimp": {
    bg: "#df07a9", tint: "#ffe5f9", light: "#ffe5f9", shade: "#af0484", deco: "#af0484",
    ill: "2e87c3a2d6aefd870d90bda5619a7c040b0dfe4e",
    extra: { src: "c2593e500f27558dbc9646fff95e2509227a4515", left: 282, top: 39, width: 46.5, height: 56.6 },
    extraUnder: true,
  },
  "business-man": {
    bg: "#ff5500", tint: "#ffeee5", light: "#ffeee5", shade: "#d14600", deco: "#ff5500",
    ill: "ecdff4e12ec1af7fd01122ee2ee5cb9a8ac39e32",
    extra: { src: "920c5a5f9643eb9c80b1f71dcbd008fd05238c4e", left: 284, top: 42, width: 39, height: 39 },
    extraOver: true,
  },
  "old-nanny": {
    bg: "#1a71ff", tint: "#e5efff", light: "#e5efff", shade: "#0445af", deco: "#1a71ff",
    ill: "b37b48188dfe39f0205e927d39da386bad5d92c3",
    extra: { src: "bab1ba43eb1e1f96361922242eef9a344c13a5af", left: 274, top: 34, width: 62, height: 62 },
    extraUnder: true,
  },
};
const ORDER = ["dogplaner", "upstart", "design-slave", "pimp", "business-man", "old-nanny"];

/* 合作卡右上角印章 MAKE / IMPOSSIBLE / POSSIBLE（我的-b Group 27170） */
const STAMP = [
  { n: "letter-m-3", x: 26, y: 0, w: 6.4, h: 5.8 }, { n: "letter-a-2", x: 33, y: 0, w: 5.8, h: 5.8 },
  { n: "letter-k-4", x: 39.5, y: 0, w: 4.9, h: 5.8 }, { n: "letter-e-4", x: 45.1, y: 0, w: 3.9, h: 5.8 },
  { n: "letter-i-6", x: 0, y: 7, w: 1.2, h: 5.8 }, { n: "letter-m-13", x: 2.4, y: 7, w: 6.4, h: 5.8 },
  { n: "letter-p-7", x: 10, y: 7, w: 4.5, h: 5.8 }, { n: "letter-o-13", x: 15, y: 6.9, w: 6, h: 6.1 },
  { n: "letter-s-6", x: 21.5, y: 7, w: 4.9, h: 6 }, { n: "letter-s-6", x: 26.9, y: 7, w: 4.9, h: 6 },
  { n: "letter-i-6", x: 32.7, y: 7, w: 1.2, h: 5.8 }, { n: "letter-b-5", x: 35.1, y: 7, w: 4.4, h: 5.8 },
  { n: "letter-l", x: 40.4, y: 7, w: 3.8, h: 5.8 }, { n: "letter-e-4", x: 45.1, y: 7, w: 3.9, h: 5.8 },
  { n: "letter-p-7", x: 10, y: 14.1, w: 4.5, h: 5.8 }, { n: "letter-o-13", x: 15, y: 13.9, w: 6, h: 6.1 },
  { n: "letter-s-6", x: 21.5, y: 14, w: 4.9, h: 6 }, { n: "letter-s-6", x: 26.9, y: 14, w: 4.9, h: 6 },
  { n: "letter-i-6", x: 32.7, y: 14.1, w: 1.2, h: 5.8 }, { n: "letter-b-5", x: 35.1, y: 14.1, w: 4.4, h: 5.8 },
  { n: "letter-l", x: 40.4, y: 14.1, w: 3.8, h: 5.8 }, { n: "letter-e-4", x: 45.1, y: 14.1, w: 3.9, h: 5.8 },
];
/* 合作卡右侧小标 P + 笑脸弧（我的-b Group 27171） */
const MARK = [
  { n: "deco-slash", x: 1.5, y: 3.1, w: 5.1, h: 8.1 },
  { n: "letter-p-display-7", x: 8.7, y: 0, w: 11.4, h: 13.3 },
  { n: "deco-arc-smile-9", x: 0, y: 11.5, w: 24, h: 10.1 },
];
/* LevelBanner 右侧 deco 簇——以 pages/1732_19949_我的-b.html 直译稿（GT 逐像素验证）为准：
 * 三层全部裁进 80px 带（top:0 height:80，object-fit:fill 压入可视条），sphere 带 color-burn 混合。
 * 注意：gen-demo 曾手抄 346×346@top-79 的出血位图（组件侧老差异），本次烘焙一并纠正。 */
const LEVEL_DECO = [
  { src: "296123febc89eeca1be6c1d8d6453b8a35d348c9", left: 75, top: 0, width: 276, height: 80, blend: "color-burn" },
  { src: "a5080b21359db877e4fc04bb0fde3b763006d636", left: 152, top: 0, width: 156.1, height: 80 },
  { src: "044971360ff476b12f6e93ff50e13e7a2a42a874", left: 179, top: 0, width: 154, height: 80 },
];

/* ---------- 烘焙页（纯内联样式，不依赖 Tailwind；文字层一律不烘。渲染树在 entryJsx 里） ---------- */

/* ---------- esbuild 打包（复用 gen-demo 的剥 import/export 手法） ---------- */
const work = join(tmpdir(), "mip-bake");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(work, "shim-react.js"), "const React = window.React;\nexport default React;\n");
writeFileSync(join(work, "shim-react-dom.js"), "export default window.ReactDOM;\n");

const comp = (f) => readFileSync(join(root, "components", f), "utf8")
  .replace(/^import[^\n]*;\s*$/gm, "")
  .replace(/^export default /gm, "")
  .replace(/^export (const|function) /gm, "$1 ");
const entry = `
${comp("icons.js")}
${comp("Icon.jsx")}
const SCALE = ${SCALE};
const ORDER = ${JSON.stringify(ORDER)};
const VARIANTS = ${JSON.stringify(VARIANTS)};
const STAMP = ${JSON.stringify(STAMP)};
const MARK = ${JSON.stringify(MARK)};
const LEVEL_DECO = ${JSON.stringify(LEVEL_DECO)};
const ASSETS = ${JSON.stringify(join(root, "pages", "assets"))} + "/";
function letters(nodes, color, style) {
  return React.createElement("span", { style: Object.assign({ color, display: "block" }, style) },
    nodes.map((t, i) => React.createElement(Icon, { key: i, name: t.n, size: { width: t.w, height: t.h }, style: { position: "absolute", left: t.x, top: t.y } }))
  );
}
`;
const entryJsx = entry + `
function CoopDeco(props) {
  const v = props.v;
  const extra = v.extra && React.createElement("img", { src: ASSETS + v.extra.src + ".png", alt: "",
    style: { position: "absolute", left: v.extra.left, top: v.extra.top, width: v.extra.width, height: v.extra.height } });
  return React.createElement("div", { style: { position: "absolute", left: 0, top: 0, width: 351, height: 200, backgroundColor: v.bg } },
    React.createElement(Icon, { name: "deco-sticker-bg-5", size: { width: 176, height: 141 }, style: { position: "absolute", left: 175, top: 0 }, color: v.tint }),
    React.createElement(Icon, { name: "deco-spintop-6", size: { width: 104, height: 55 }, style: { position: "absolute", left: 49, top: 36 }, color: v.shade }),
    letters(STAMP, v.deco, { position: "absolute", left: 290, top: 12, width: 49, height: 20 }),
    letters(MARK, v.deco, { position: "absolute", left: 315, top: 88, width: 24, height: 21.6 }),
    !v.extraOver && extra,
    React.createElement("img", { src: ASSETS + v.ill + ".png", alt: "", style: { position: "absolute", left: 195, top: 0, width: 113, height: 120 } }),
    v.extraOver && extra,
    React.createElement("span", { style: { position: "absolute", left: 12, top: 12, color: v.light, display: "block", width: 47, height: 15 } },
      React.createElement(Icon, { name: "letter-m-display-8", size: { width: 17.1, height: 15 }, style: { position: "absolute", left: 0, top: 0 } }),
      React.createElement(Icon, { name: "letter-i-display-6", size: { width: 4.3, height: 15 }, style: { position: "absolute", left: 21.4, top: 0 } }),
      React.createElement(Icon, { name: "letter-p-display-13", size: { width: 17.1, height: 15 }, style: { position: "absolute", left: 30, top: 0 } })
    )
  );
}
function LevelDeco() {
  return React.createElement("div", { style: { position: "absolute", left: 0, top: 0, width: 351, height: 80, backgroundColor: "#fcdf03", overflow: "hidden" } },
    LEVEL_DECO.map(function (d, i) {
      return React.createElement("img", { key: i, src: ASSETS + d.src + ".png", alt: "",
        style: { position: "absolute", left: d.left, top: d.top, width: d.width, height: d.height,
                 mixBlendMode: d.blend || "normal", objectFit: "fill" } });
    })
  );
}
const slots = [];
ORDER.forEach(function (key, i) {
  slots.push(React.createElement("div", { key: key, style: { position: "relative", width: 351 * SCALE, height: 200 * SCALE, overflow: "hidden" } },
    React.createElement("div", { style: { position: "absolute", left: 0, top: 0, width: 351, height: 200, transform: "scale(" + SCALE + ")", transformOrigin: "0 0" } },
      React.createElement(CoopDeco, { v: VARIANTS[key] }))));
});
slots.push(React.createElement("div", { key: "level", style: { position: "relative", width: 351 * SCALE, height: 80 * SCALE, overflow: "hidden" } },
  React.createElement("div", { style: { position: "absolute", left: 0, top: 0, width: 351, height: 80, transform: "scale(" + SCALE + ")", transformOrigin: "0 0" } },
    React.createElement(LevelDeco, null))));
ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, slots)
);
`;
writeFileSync(join(work, "entry.jsx"), entryJsx);
execFileSync("npx", ["-y", "esbuild", join(work, "entry.jsx"), "--bundle", "--outfile=" + join(work, "bake.bundle.js"),
  "--alias:react=" + join(work, "shim-react.js"), "--alias:react-dom=" + join(work, "shim-react-dom.js"),
  "--jsx=transform", "--format=iife", "--log-level=warning"], { cwd: root, stdio: "inherit" });

writeFileSync(join(work, "bake.html"), `<!doctype html>
<html><head><meta charset="utf-8"><title>bake</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<style>html,body{margin:0;padding:0;background:#fff}</style>
</head><body><div id="root"></div><script src="bake.bundle.js"></script></body></html>`);

/* ---------- 截图 + 裁切 ---------- */
const H = (200 * SCALE) * ORDER.length + 80 * SCALE;
const shot = join(work, "bake-shot.png");
execFileSync(FIREFOX, ["--headless", "--screenshot", shot, "--window-size=" + 351 * SCALE + "," + H,
  "file://" + join(work, "bake.html")], { stdio: "ignore" });

const py = `
import sys
from PIL import Image
im = Image.open(${JSON.stringify(shot)})
out = ${JSON.stringify(OUT)}
S = ${SCALE}
names = ${JSON.stringify(ORDER)}
assert im.size[0] == 351 * S, "截图宽度不符: %s" % (im.size,)
px = im.convert("RGB").getpixel((500, 300))  # 首卡（dogplaner #7b00ff）纯底区，白图=CDN/资产没加载
assert px[2] > 200 and px[0] < 180, "首卡渲染异常 %s，烘焙页可能空白" % (px,)
jobs = [("coop-card-" + n, i * 200 * S, 200 * S, 351, 200) for i, n in enumerate(names)]
jobs.append(("level-banner-deco", len(names) * 200 * S, 80 * S, 351, 80))
total = 0
for name, ytop, h3, w1, h1 in jobs:
    crop = im.crop((0, ytop, 351 * S, ytop + h3))
    crop.save(out + "/" + name + "@3x.png", optimize=True)
    crop.resize((w1 * 2, h1 * 2), Image.LANCZOS).save(out + "/" + name + "@2x.png", optimize=True)
    total += 1
print("baked", total, "assets ->", out)
`;
execFileSync("python3", ["-c", py], { stdio: "inherit" });

console.log("deliverables/miniprogram/ 烘焙完成（@3x 主图 + @2x 降采样）");
