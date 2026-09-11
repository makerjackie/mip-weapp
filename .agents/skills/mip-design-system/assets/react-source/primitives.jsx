/**
 * primitives.jsx — 基础 UI 组件（规格逐一对照 pages/*.html 实测值）。
 * 所有组件均接受 className 追加覆盖；图标来自 ./icons.js（<Icon>，未知名渲染 null）。
 */
import React from "react";
import { Icon } from "./Icon.jsx";

/* ---------- 行 / 表单 ---------- */

/** 详情行：351×46 #202020（pad 10/10/10/12），label 白 14/500 + 右侧箭头 4×8#979797（16 盒内@(6,4)，旋转 1.6°） */
export function DetailRow({ label, value, chevron = true, className = "", onClick }) {
  return (
    <div className={`flex h-[46px] items-center justify-between bg-[#202020] pl-[12px] pr-[10px] ${className}`} onClick={onClick}>
      <span className="text-[14px] font-medium leading-[20px] text-white">{label}</span>
      <span className="flex items-center gap-[6px] text-right text-xs font-medium leading-[17px] text-[#b3b3b3]">
        {value}
        {chevron && (
          <span className="relative block h-4 w-4" style={{ transform: "rotate(1.6deg)" }}>
            <Icon name="chevron-down-1-6" size={{ width: 4, height: 8 }} style={{ position: "absolute", left: 6, top: 4 }} className="text-[#979797]" />
          </span>
        )}
      </span>
    </div>
  );
}

/** 详情行组：共享 8px 圆角外壳（首行上圆角、末行下圆角） */
export function DetailRowGroup({ children, className = "" }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-[8px] [&>*:not(:first-child)]:mt-px [&>*:first-child]:rounded-t-[8px] [&>*:last-child]:rounded-b-[8px] ${className}`}>
      {children}
    </div>
  );
}

const CALENDAR = (
  <span className="relative block h-4 w-4">
    <Icon name="calendar-schedule" size={{ width: 14, height: 14 }} style={{ position: "absolute", left: 1, top: 1 }} className="text-[#b3b3b3]" />
  </span>
);
const CHEVRON_DOWN = (
  <span className="relative block h-4 w-4">
    <Icon name="chevron-down-1" size={{ width: 3, height: 6 }} style={{ position: "absolute", left: 6.5, top: 5 }} className="text-[#b3b3b3]" />
  </span>
);

/** 表单行：编辑态（占位/日历/下拉箭头） */
export function FormFieldRow({ label, value, placeholder, trailing, className = "", onClick }) {
  const showTrailing = trailing === "calendar" ? CALENDAR : trailing === "chevron" ? CHEVRON_DOWN : null;
  return (
    <div className={`flex h-[46px] items-center justify-between bg-[#202020] pl-[12px] pr-[10px] ${className}`} onClick={onClick}>
      <span className="text-[14px] font-medium leading-[20px] text-white">{label}</span>
      <span className="flex items-center gap-[6px]">
        <span className={`text-sm leading-[20px] ${value ? "text-white" : "text-[#b3b3b3]"}`}>{value || placeholder}</span>
        {showTrailing}
      </span>
    </div>
  );
}

/** 区块标题：16 盒内约 13px 黄图标 + 16/500 标题（+右侧附加），间距 4 */
export function SectionHeader({ icon, title, extra, className = "" }) {
  return (
    <div className={`flex items-center gap-[4px] px-3 ${className}`}>
      {icon && <Icon name={icon} className="text-brand" />}
      <span className="text-[16px] font-medium leading-[22.4px] text-white">{title}</span>
      {extra && <span className="ml-auto text-xs text-[#b3b3b3]">{extra}</span>}
    </div>
  );
}

/* ---------- 选择器 ---------- */

/** 标签 Chip：h28 r8 + 1px 黑描边，激活 #fcdf03/#080808，默认 #202020/#b3b3b3 */
export function TagChip({ active, children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[28px] items-center rounded-[8px] border border-black px-2 text-xs font-medium leading-[17px] ${
        active ? "bg-brand text-[#080808]" : "bg-[#202020] text-[#b3b3b3]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** 城市格：101×40 r8，激活黄底黑字，默认 #333333/#f7f7f7 */
export function CityCell({ active, children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[40px] w-[101px] items-center justify-center rounded-[8px] text-[14px] font-medium leading-[20px] ${
        active ? "bg-brand text-[#080808]" : "bg-[#333333] text-[#f7f7f7]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** 搜索框：351×40 r8 #202020；图标盒 20×20@(8,10) 内 12×12 玻璃 #b3b3b3，文字起于 x32 */
export function SearchBar({ placeholder = "搜索", value, onChange, className = "" }) {
  return (
    <div className={`flex h-[40px] items-center rounded-[8px] bg-[#202020] pl-[8px] pr-3 ${className}`}>
      <span className="relative block h-5 w-5 flex-none">
        <Icon name="search-big-left-1" size={{ width: 12, height: 12 }} style={{ position: "absolute", left: 4, top: 4 }} className="text-[#b3b3b3]" />
      </span>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="ml-[4px] w-full bg-transparent text-sm text-white placeholder-[#b3b3b3] outline-none"
      />
    </div>
  );
}

/** A–Z# 字母滑条：x355 竖排 11/600 品牌黄，行距 0.8 */
export function AlphabetSlider({ letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#", className = "" }) {
  return (
    <div className={`absolute right-[8px] top-1/2 flex -translate-y-1/2 flex-col items-center gap-[0.8px] ${className}`}>
      {letters.split("").map((l) => (
        <span key={l} className="text-[11px] font-semibold leading-[13px] text-brand">{l}</span>
      ))}
    </div>
  );
}

/* ---------- 按钮 ---------- */

/** 主按钮：351×56 液态玻璃外圈 + 327×40 黄芯 1px #080808 内描边（文字 #080808 16/500）。
 *  Group 27137（22 屏共用）：GLASS 效果 REST 不导出参数，按 Figma 渲染实测近似。 */
export function PrimaryButton({ children = "保存", onClick, disabled, className = "" }) {
  return (
    <div
      className={`flex h-[56px] w-full items-center justify-center rounded-full bg-[#ffdd02]/10 ${className}`}
      style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.12),rgba(255,255,255,0.12))",
        backdropFilter: "blur(20px) saturate(1.5)",
        WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 1px 1.5px rgba(255,255,255,0.10)",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="h-[40px] w-[327px] rounded-full border border-[#080808] bg-brand text-[16px] font-medium text-[#080808] disabled:opacity-40"
      >
        {children}
      </button>
    </div>
  );
}

/** 胶囊按钮（Frame 27202/27203）：h40 r100 + 1px #080808 内描边，icon(20 盒)+8px+文字 16/500。
 *  primary #fcdf03 底黑字（立即续费）；secondary #202020 底品牌黄字（邀请加入）。 */
export function PillButton({ variant = "primary", icon, children, onClick, className = "" }) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[40px] items-center justify-center gap-[8px] rounded-full border border-[#080808] px-4 text-[16px] font-medium ${
        primary ? "bg-brand text-[#080808]" : "bg-[#202020] text-brand"
      } ${className}`}
    >
      {icon && <span className="relative block h-5 w-5 [&>svg]:absolute [&>svg]:left-[1px] [&>svg]:top-[1px]">{icon}</span>}
      {children}
    </button>
  );
}

const PLUS = (
  /* 设计稿为实心十字（臂宽 2px），非描边线条 */
  <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor">
    <path d="M6 6V0H8V6H14V8H8V14H6V8H0V6H6Z" />
  </svg>
);

/** 添加卡（我的-b Group 27239）：351×100 r8 #202020 + 0.5px #fcdf03 虚线描边（strokeDashes=[4,4]）；
 *  内容「＋添加」垂直居中——Figma SPACE_BETWEEN 单子节点实测渲染居中（export-png 对照），
 *  CSS justify-between 单子节点却是顶对齐，故用 justify-center；plus 14×14 实心 + 文字 14/500，间距 4。
 *  虚线用 SVG stroke-dasharray 直译：CSS border-style:dashed 的段长由浏览器固定（约 3:3×线宽），
 *  复现不了 Figma 4:4；rect 内缩 strokeWeight/2 对齐 INSIDE 描边 */
export function AddButton({ children = "添加", onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-[100px] w-full flex-col items-center justify-center rounded-[8px] bg-[#202020] p-2 ${className}`}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 351 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0.25" y="0.25" width="350.5" height="99.5" rx="7.75" fill="none" stroke="#fcdf03" strokeWidth="0.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="flex items-center gap-[4px] text-brand">
        {PLUS}
        <span className="text-[14px] font-medium leading-[20px]">{children}</span>
      </span>
    </button>
  );
}

/** iOS 开关（1.Element/Switch 实例）：51×31，ON #07c160；
 *  旋钮 27×27@top2 left2/22，投影 0 0 0 0.5px@4% + 0 3px 1px@6% + 0 3px 8px@15% */
export function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      aria-checked={checked}
      role="switch"
      onClick={() => onChange?.(!checked)}
      className={`relative h-[31px] w-[51px] rounded-full transition-colors ${checked ? "bg-[#07c160]" : "bg-[#39393d]"}`}
    >
      <span
        className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-[2px]"}`}
        style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.04), 0 3px 1px rgba(0,0,0,0.06), 0 3px 8px rgba(0,0,0,0.15)" }}
      />
    </button>
  );
}

/* ---------- 展示 ---------- */

/** 图标徽章：16 圆黄底 + 内缩 2px 原尺寸深色图标（默认 #202020）+ 10/400 白标签 */
export function IconBadge({ icon, label, color = "#202020", className = "" }) {
  return (
    <span className={`flex items-center gap-[4px] ${className}`}>
      <span className="relative block h-4 w-4 flex-none rounded-full bg-brand">
        <span className="absolute inset-[2px] flex items-center justify-center" style={{ color }}>
          <Icon name={icon} />
        </span>
      </span>
      {label && <span className="text-[10px] leading-[14px] text-white">{label}</span>}
    </span>
  );
}

const STAR_PATH = "M12 2l2.94 6.36 6.96.6-5.28 4.58 1.58 6.82L12 16.9l-6.2 3.46 1.58-6.82L2.1 8.96l6.96-.6L12 2z";

/** 星级评分：5×20px，满星品牌黄 */
export function StarRating({ value = 0, max = 5, size = 20, className = "" }) {
  return (
    <span className={`flex items-center gap-[2px] ${className}`}>
      {Array.from({ length: max }, (_, i) => (
        i < value ? (
          <Icon key={i} name="star-favorite-3" size={size} className="text-brand" />
        ) : (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} fill="#4d4d4d"><path d={STAR_PATH} /></svg>
        )
      ))}
    </span>
  );
}

/** 打分卡：170×68 r8 #202020（12/500 维度名 + 星级） */
export function ScoreCard({ title, value, onChange, className = "" }) {
  return (
    <div className={`flex h-[68px] w-[170px] flex-col items-center justify-center gap-[6px] rounded-[8px] bg-[#202020] ${className}`}>
      <span className="text-xs font-medium text-white">{title}</span>
      <StarRating value={value} onChange={onChange} />
    </div>
  );
}
