/**
 * chrome.jsx — 系统层组件：Screen / StatusBar / NavBar / TabBar / HomeIndicator。
 * 规格逐一对照 pages/*.html 机器直译稿（如 1732_19949_我的-b、1728_19083_账号设置）：
 * StatusBar 375×47（时间 17/600@26,14 + 信号@273,19 + Wi-Fi@299,19 + 电池组合@323,18）；
 * NavBar 标题 16/600 居中@y55，返回钮 20×20@(14,56)，胶囊 83×30@(285,51)；
 * TabBar 375×56（仅 Tab 行；iOS HomeIndicator 34 是独立系统组件，页面各自叠加，勿并入）。
 */
import React from "react";
import { Icon } from "./Icon.jsx";

const FONT = "-apple-system,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif";

/** 页面壳：375 宽 #080808 */
export function Screen({ children, className = "", style, ...rest }) {
  return (
    <div
      className={`relative w-[375px] overflow-hidden bg-page text-white ${className}`}
      style={{ fontFamily: FONT, minHeight: 812, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** iOS 状态栏：375×47（坐标取自页面直译稿，非 flex 近似） */
export function StatusBar({ time = "9:41", className = "" }) {
  return (
    <div className={`relative h-[47px] w-full ${className}`}>
      <span
        className="absolute left-[26px] top-[14px] h-[20px] w-[54px] text-center text-[17px] font-semibold leading-[22px] tracking-[-0.4px] text-white"
        style={{ fontFamily: "'SF Pro Text',-apple-system,sans-serif" }}
      >
        {time}
      </span>
      <Icon name="mobile-signal-2" size={{ width: 18, height: 12 }} style={{ position: "absolute", left: 273, top: 19 }} className="text-white" />
      <Icon name="wifi" size={{ width: 17, height: 11.8 }} style={{ position: "absolute", left: 299, top: 19 }} className="text-white" />
      <span className="absolute left-[323px] top-[18px] block h-[13px] w-[27.4px]">
        <Icon name="statusbar-battery-outline" size={{ width: 25, height: 13 }} style={{ position: "absolute", left: 0, top: 0, opacity: 0.35 }} className="text-white" />
        <Icon name="battery-end" size={{ width: 1.4, height: 4.2 }} style={{ position: "absolute", left: 26, top: 5, opacity: 0.4 }} className="text-white" />
        <Icon name="statusbar-battery-fill" size={{ width: 21, height: 9 }} style={{ position: "absolute", left: 2, top: 2 }} className="text-white" />
      </span>
    </div>
  );
}

/** 底部 Home Indicator：区域 34px，白条 134×5 距底 8 */
export function HomeIndicator({ className = "" }) {
  return (
    <div className={`flex h-[34px] w-full items-end justify-center pb-[8px] ${className}`}>
      <span className="h-[5px] w-[134px] rounded-[100px] bg-white" />
    </div>
  );
}

/** 系统胶囊（NavigationBar-Accessory）：83×30 r15，黑 15% 底 + 白 25% 0.3px 描边；
 *  左「···」Union 18.5×6.5@(0.8,6.8)，分隔线 0.3×17@(41.3,6.5)，右圆环 17×17@(1.5,1.5) */
export function Capsule({ className = "", style }) {
  return (
    <span className={`absolute block h-[30px] w-[83px] ${className}`} style={style}>
      <span className="absolute inset-0 rounded-[15px] bg-black opacity-[0.15]" />
      <span className="absolute inset-0 rounded-[15px] border-[0.3px] border-white opacity-[0.25]" />
      <span className="absolute left-[12px] top-[5px] block h-5 w-5">
        <Icon name="statusbar-island" size={{ width: 18.5, height: 6.5 }} style={{ position: "absolute", left: 0.8, top: 6.8 }} className="text-white" />
      </span>
      <Icon name="nav-divider" size={{ width: 0.3, height: 17 }} style={{ position: "absolute", left: 41.3, top: 6.5, opacity: 0.25 }} className="text-white" />
      <span className="absolute left-[52px] top-[5px] block h-5 w-5">
        <Icon name="nav-home-ring" size={{ width: 17, height: 17 }} style={{ position: "absolute", left: 1.5, top: 1.5 }} className="text-white" />
      </span>
    </span>
  );
}

/** 导航栏：含状态栏共 88px。返回钮 20×20@(14,56)（箭头 7.5×15@(3.5,2.5)）；
 *  标题 16/600 居中@y55；胶囊 @(285,51)。tab 页无返回（back={false}）。 */
export function NavBar({ title, back = true, onBack, capsule = true, time, className = "" }) {
  return (
    <div className={`relative z-20 w-full ${className}`}>
      <StatusBar time={time} />
      <div className="relative h-[41px] w-full">
        {back && (
          <button type="button" aria-label="返回" onClick={onBack} className="absolute left-[14px] top-[9px] block h-5 w-5">
            <Icon name="nav-back" size={{ width: 7.5, height: 15 }} style={{ position: "absolute", left: 3.5, top: 2.5 }} className="text-white" />
          </button>
        )}
        {title && (
          <span className="absolute left-[98px] top-[8px] w-[179px] text-center text-[16px] font-semibold leading-[22px] text-white">{title}</span>
        )}
        {capsule && <Capsule style={{ left: 285, top: 4 }} />}
      </div>
    </div>
  );
}

/* TabBar 图标 = 设计稿中盖在占位槽上的兄弟图层（多矢量组合，坐标为 28×28 盒内偏移）。
 * off = 未激活（彩色基底 #202020+#b3b3b3，mono 矢量随 #b3b3b3 文字色）；
 * on  = 激活（全 mono，随 text-brand；设计稿激活态即纯黄描边，底 #080808 与页面同色）。
 * 2026-09-09 修正：此前 活动/机会 引用的 -2/-3/-5/-6 自动编号名内容串图
 * （icons.js 同名碰撞按文件名字母序编号，与内容无关），现改用 icon-names.json
 * 固定命名的 tab-note-* / tab-bag-* 部件，逐件核对过 SVG 内容。 */
const TAB_ICON_NODES = {
  发现: {
    off: [
      { n: "smileys-13-12", x: 3, y: 3, w: 22, h: 22 },
      { n: "smileys-13-12-2", x: 10, y: 10, w: 8.2, h: 8.2 },
    ],
    on: [
      { n: "smileys-13-2-2", x: 3, y: 3, w: 22, h: 22 },
      { n: "smileys-13-12-2", x: 10, y: 10, w: 8.2, h: 8.2 },
    ],
  },
  活动: {
    off: [
      { n: "tab-note-outline", x: 3.5, y: 3.5, w: 21, h: 21 },
      { n: "tab-note-fold", x: 17.5, y: 17.5, w: 7, h: 7 },
      { n: "tab-note-line", x: 8.3, y: 8.3, w: 11.3, h: 2 },
      { n: "tab-note-line", x: 8.3, y: 13, w: 11.3, h: 2 },
    ],
    on: [
      { n: "document-note-paper-angle-right-3", x: 3.5, y: 3.5, w: 21, h: 21 },
      { n: "tab-note-fold", x: 17.5, y: 17.5, w: 7, h: 7 },
      { n: "tab-note-line", x: 8.3, y: 8.3, w: 11.3, h: 2 },
      { n: "tab-note-line", x: 8.3, y: 13, w: 11.3, h: 2 },
    ],
  },
  机会: {
    off: [
      { n: "tab-bag-body", x: 3.5, y: 8.2, w: 21, h: 16.3 },
      { n: "tab-bag-band", x: 3.5, y: 12.8, w: 21, h: 2.3 },
      { n: "tab-bag-handle", x: 9.3, y: 3.5, w: 9.3, h: 7 },
      { n: "tab-bag-dash", x: 11.3, y: 18.8, w: 5.5, h: 2 },
    ],
    on: [
      { n: "satchel-bag-3", x: 3.5, y: 8.2, w: 21, h: 16.3 },
      { n: "tab-bag-band", x: 3.5, y: 12.8, w: 21, h: 2.3 },
      { n: "tab-bag-handle", x: 9.3, y: 3.5, w: 9.3, h: 7 },
      { n: "tab-bag-dash", x: 11.3, y: 18.8, w: 5.5, h: 2 },
    ],
  },
  我的: {
    off: [
      { n: "smileys-13-11-2", x: 3, y: 3, w: 22, h: 22 },
      { n: "smileys-13-11", x: 6, y: 10, w: 16, h: 8 },
    ],
    on: [
      { n: "smileys-13-11-2", x: 3, y: 3, w: 22, h: 22 },
      { n: "smileys-13-11", x: 6, y: 10, w: 16, h: 8 },
    ],
  },
};

export const DEFAULT_TABS = ["发现", "活动", "机会", "我的"].map((label) => ({ label, nodes: TAB_ICON_NODES[label] }));

/** 底部 TabBar：375×56，仅 Tab 行（应用层组件）。
 *  iOS HomeIndicator（375×34）是独立系统组件，见下方 HomeIndicator；页面自行叠加：
 *  `<TabBar … /><HomeIndicator className="absolute bottom-0" />`。
 *  图标 28×28 水平居中@top 8，标签 10/500 居中@top 38，激活 #fcdf03。 */
export function TabBar({ items = DEFAULT_TABS, activeIndex = 3, onSelect, className = "" }) {
  return (
    <div className={`w-full bg-[#080808] ${className}`}>
      <div className="relative h-[56px] w-full">
        {items.map((it, i) => {
          const active = i === activeIndex;
          const nodes = (active ? it.nodes?.on : it.nodes?.off) || it.nodes || [];
          return (
            <button
              key={it.label}
              type="button"
              onClick={() => onSelect?.(i)}
              className="absolute top-0 block h-full"
              style={{ left: `${i * 25}%`, width: "25%" }}
            >
              <span className={`absolute left-1/2 top-[8px] -ml-[14px] block h-[28px] w-[28px] ${active ? "text-brand" : "text-[#b3b3b3]"}`}>
                {nodes.map((nd, k) => (
                  <Icon
                    key={k}
                    name={nd.n}
                    size={{ width: nd.w, height: nd.h }}
                    style={{ position: "absolute", left: nd.x, top: nd.y }}
                  />
                ))}
              </span>
              <span
                className={`absolute left-1/2 top-[38px] -ml-[28px] w-[56px] text-center text-[10px] font-medium leading-[14px] ${
                  active ? "text-brand" : "text-[#b3b3b3]"
                }`}
              >
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
