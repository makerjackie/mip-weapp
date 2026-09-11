/**
 * business.jsx — 业务组件（卡片/横幅/弹窗/录音等）。
 * 规格逐一对照 pages/*.html 机器直译稿（我的-b / 我的订单-全部 / 订单详情 / 玩家等级 /
 * 嘉宾-a / 编辑合作卡 / 空数据图标 / AI助手系列）。
 */
import React from "react";
import { Icon } from "./Icon.jsx";
import { IconBadge } from "./primitives.jsx";

/* ---------- 横幅 / 入口 ---------- */

/** 通栏提示：375×32 #fcdf03，#080808 14/500 */
export function TipBanner({ children, className = "" }) {
  return (
    <div className={`flex h-[32px] w-full items-center justify-center bg-brand px-3 text-[14px] font-medium leading-[20px] text-[#080808] ${className}`}>
      {children}
    </div>
  );
}

/** AI 助手入口卡（编辑合作卡 Frame 45 2571:34324）：351×100 r8 #202020 + 1px #fcdf03 描边；
 *  内容（69×24：AI 图标盒 24×24 = 气泡 22×21@(2,1) + 笑脸 12×6@(6,9)，+4px，文字 14/500 黄）
 *  水平垂直双居中——Frame 45 SPACE_BETWEEN 单子节点实测渲染居中（export-png 坐标核对
 *  子块中心 2942 == 卡片中心 2942），CSS justify-between 单子节点是顶对齐，故用 justify-center */
export function AiAssistCard({ title = "AI助手", onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[100px] w-full flex-col items-center justify-center rounded-[8px] border border-brand bg-[#202020] p-2 ${className}`}
    >
      <span className="flex items-center gap-[4px]">
        <span className="relative block h-6 w-6">
          <Icon name="chat-smile-ai-3-2" style={{ position: "absolute", left: 2, top: 1 }} className="text-brand" />
          <Icon name="chat-smile-ai-3" style={{ position: "absolute", left: 6, top: 9 }} className="text-brand" />
        </span>
        <span className="text-[14px] font-medium leading-[20px] text-brand">{title}</span>
      </span>
    </button>
  );
}

/* ---------- 我的页 ---------- */

/** Lv 徽章：34×16 r4 #242424 + 0.5px #080808 描边，文字 10/600 品牌黄 */
export function LevelBadge({ children = "Lv.23", className = "", style }) {
  return (
    <span
      className={`flex h-4 w-[34px] items-center justify-center rounded-[4px] border-[0.5px] border-[#080808] bg-[#242424] text-[10px] font-semibold leading-[14px] text-brand ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

/** 个人信息头（我的-b）：相对 375×80 定位——头像 80@(12,0) 带 2px #080808 内描边圆环
 *  （Ellipse 5 strokes 实测，覆盖层画环避免 border 挤压 img）；名字 16/500@(104,9)；
 *  Lv 徽章@(142,12)；MIP 勋章 20×20@(180,10)；meta 10/500 白@(104,37)；简介 10/400 #b3b3b3@(104,57) */
export function ProfileHeader({ avatar, name, level, meta, intro, badge, className = "" }) {
  return (
    <div className={`relative h-20 w-full ${className}`}>
      {avatar && (
        <span className="absolute left-3 top-0 block h-20 w-20">
          <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover" />
          <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#080808]" />
        </span>
      )}
      {name && <span className="absolute left-[104px] top-[9px] text-[16px] font-medium leading-[22.4px] text-white">{name}</span>}
      {level && <LevelBadge className="absolute left-[142px] top-[12px]">{level}</LevelBadge>}
      {badge && <img src={badge} alt="" className="absolute left-[180px] top-[10px] h-5 w-5" />}
      {meta && <span className="absolute left-[104px] top-[37px] text-[10px] font-medium leading-[14px] text-white">{meta}</span>}
      {intro && <span className="absolute left-[104px] top-[57px] text-[10px] leading-[14px] text-[#b3b3b3]">{intro}</span>}
    </div>
  );
}

/** 四列统计头（我的-b Group 27184）：351×68 r8 #202020；四列 48 宽，列原点 x=31.5+80i、top 12；
 *  数值 20/500 白 + 2px + 标签 10/400 白；红点角标 14×14@(数值右+1, 上-4) */
export function StatHeader({ stats = [], className = "" }) {
  return (
    <div className={`relative h-[68px] w-full rounded-[8px] bg-[#202020] ${className}`}>
      {stats.map((s, i) => (
        <div key={s.label} className="absolute top-[12px] flex w-12 flex-col items-center gap-[2px]" style={{ left: 31.5 + i * 80 }}>
          <span className="relative text-[20px] font-medium leading-[28px] text-white">
            {s.value}
            {s.badge != null && (
              <span className="absolute -right-[1px] -top-[4px] flex h-3.5 w-3.5 items-center justify-center rounded-[100px] bg-[#ff2238] px-[2px] text-[10px] font-medium leading-[13px] text-white">
                {s.badge}
              </span>
            )}
          </span>
          <span className="text-[10px] leading-[14px] text-white">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 玩家等级黄卡（我的-b 顶部）：351×80，上圆角 16；文案区（14,9）/（14,44）；
 *  右上「玩家等级 ›」组（Group 27185）：10/400 #080808@(291,12) + 3×6 箭头@(40,1) 盒内、旋转 1.6°；
 *  进度槽 #4d4400 150×6@(12,60)，内芯 #fcdf03 高 2@(14,62)。
 *  右侧装饰簇（sphere/贴图，7 屏实测一致）已烘焙为单张底图 deliverables/miniprogram/level-banner-deco@3x.png
 *  （生成器 tools/gen-baked-assets.mjs），组件只叠文字/进度条。 */
export function LevelBanner({ level = "Lv.23", current = 3000, target = 40000, fillPx, className = "" }) {
  const pct = Math.min(1, current / target);
  return (
    <div className={`relative block h-[80px] w-full overflow-hidden rounded-t-[16px] bg-brand ${className}`} style={{ backgroundImage: "url(../deliverables/miniprogram/level-banner-deco@3x.png)", backgroundSize: "100% 100%" }}>
      <span className="absolute left-[14px] top-[9px] text-[16px] font-semibold leading-[22.4px] text-[#080808]">{level}</span>
      <span className="absolute left-[14px] top-[44px] text-[10px] font-semibold leading-[14px] text-[#080808]">{current} I {target}</span>
      <span className="absolute left-[291px] top-[12px]">
        <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] font-normal leading-[14px] text-[#080808]">玩家等级</span>
        <span className="absolute left-[40px] top-[1px] block h-3 w-3" style={{ transform: "rotate(1.6deg)" }}>
          <Icon name="chevron-down-1" size={{ width: 3, height: 6 }} style={{ position: "absolute", left: 4.5, top: 3 }} className="text-[#080808]" />
        </span>
      </span>
      <span className="absolute left-[12px] top-[60px] h-[6px] w-[150px] rounded-[100px] bg-[#4d4400]" />
      <span className="absolute left-[14px] top-[62px] h-[2px] rounded-[100px] bg-brand" style={{ width: fillPx ?? 2 + 146 * pct }} />
    </div>
  );
}

/** MIP 字标（合作卡左上 47.1×15）：M 17.1×15 + I 4.3×15@21.4 + P 17.1×15@30，默认 #F2E6FF */
export function MipWordmark({ color = "#F2E6FF", className = "", style }) {
  return (
    <span className={`relative block h-[15px] w-[47px] ${className}`} style={{ color, ...style }}>
      <Icon name="letter-m-display-8" size={{ width: 17.1, height: 15 }} style={{ position: "absolute", left: 0, top: 0 }} />
      <Icon name="letter-i-display-6" size={{ width: 4.3, height: 15 }} style={{ position: "absolute", left: 21.4, top: 0 }} />
      <Icon name="letter-p-display-13" size={{ width: 17.1, height: 15 }} style={{ position: "absolute", left: 30, top: 0 }} />
    </span>
  );
}

/* ---------- 合作卡六角色变种（合作卡页 2004:2932/3107/3166/3225 + 2991/2816 实测） ----------
 * 六张结构一致，装饰层（纯色背景/水印/阴影/印章 MAKE IMPOSSIBLE POSSIBLE/P+笑脸小标/副图/
 * 角色插画/MIP 字标）已烘焙为单张底图 deliverables/miniprogram/coop-card-<variant>@3x.png，
 * 生成器 tools/gen-baked-assets.mjs（逐卡配色/插画源数据在其 VARIANTS 表，两处靠注释互为锚点）。
 * 组件只叠动态内容：人名（light 色）+ 目标/引荐条 y120/y160（值右缘均 339 = pr12）。
 * bg 仅作底图加载前的同色垫底。 */
const COOP_BAKED = "../deliverables/miniprogram/coop-card-";
const COOP_VARIANTS = {
  "dogplaner": { name: "狗策划 DOGPLANER", bg: "#7b00ff", light: "#f2e5ff" },
  "upstart": { name: "暴发户 UPSTART", bg: "#7a2900", light: "#fadab3" },
  "design-slave": { name: "死美工 Design Slave", bg: "#04a44f", light: "#e5fff1" },
  "pimp": { name: "皮条客 pimp", bg: "#df07a9", light: "#ffe5f9" },
  "business-man": { name: "生意佬 business man", bg: "#ff5500", light: "#ffeee5" },
  "old-nanny": { name: "老保姆 old nanny", bg: "#1a71ff", light: "#e5efff" },
};

/* 印章/小标的字母级坐标表随装饰层一起移入 tools/gen-baked-assets.mjs（STAMP/MARK）。
 * 人名按拉丁/CJK 分 run：Figma 里中文段 PingFang 600、拉丁段 Baloo 400（characterStyleOverrides 实测），
 * 本机无原版 Baloo 时回退 Baloo 2（官方后继，字形最接近） */
function CoopNameRuns({ text }) {
  const parts = (text ?? "").split(/([A-Za-z0-9][A-Za-z0-9\s'!.\-]*)/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        /[A-Za-z0-9]/.test(p[0]) ? (
          <span key={i} style={{ fontFamily: "'Baloo','Baloo 2',-apple-system,system-ui,sans-serif", fontWeight: 400 }}>{p}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/** 合作卡（我的-b Group 27240；六角色变种见 COOP_VARIANTS）。
 *  351×200 r16；装饰层为烘焙底图（COOP_BAKED，生成器 tools/gen-baked-assets.mjs），
 *  底部两条 40px 全宽 #202020 条：我的目标@y120（上圆角 16）、需要引荐@y160（下圆角 16），
 *  值右对齐 pr12（两页实测右缘均 339）；条内：16 圆黄 + 深色图标 + 4px + 标签 10/400 白，值 12/500 白。
 *  人名 Figma 渲染为全大写（export-png 实测；节点 characters 是混合大小写、REST 未吐 textCase，
 *  属桥序列化缺口，页面同病），故加 uppercase 直译渲染真相。 */
export function CooperationCard({ variant = "dogplaner", name, goal, referral, goalLabel = "我的目标", referralLabel = "需要引荐", className = "", onClick }) {
  const v = COOP_VARIANTS[variant] || COOP_VARIANTS.dogplaner;
  const strip = (top, roundCls, icon, label, value, pr) => (
    <div className={`absolute left-0 flex h-10 w-full items-center justify-between bg-[#202020] px-3 ${roundCls}`} style={{ top, paddingRight: pr }}>
      <span className="flex items-center gap-[4px]">
        <IconBadge icon={icon} label={label} />
      </span>
      {value != null && <span className="text-[12px] font-medium leading-[16.8px] text-white">{value}</span>}
    </div>
  );
  return (
    <div className={`relative h-[200px] w-full overflow-hidden rounded-[16px] ${className}`} style={{ backgroundColor: v.bg, backgroundImage: `url(${COOP_BAKED}${variant}@3x.png)`, backgroundSize: "100% 100%" }} onClick={onClick}>
      {(name ?? v.name) && <span className="absolute left-3 top-[96px] text-[12px] font-semibold leading-[16.8px] uppercase" style={{ color: v.light }}><CoopNameRuns text={name ?? v.name} /></span>}
      {goal && strip(120, "rounded-t-[16px]", "target", goalLabel, goal, 12)}
      {referral && strip(160, "rounded-b-[16px]", "cup", referralLabel, referral, 12)}
    </div>
  );
}

/* ---------- 订单 / 任务 / 列表 ---------- */

const ORDER_TAG_PRESETS = {
  仅玩家: { bg: "#fde530", border: "#d0b801", color: "#000000" },
  沙龙: { bg: "#428bff", border: "#075adf", color: "#f7f7f7" },
};

/** 订单角标：h16 r4 + 0.5px 描边，10/500；默认配色仅玩家（黄）/沙龙（蓝） */
export function OrderTag({ label, bg, border, color, className = "" }) {
  const p = ORDER_TAG_PRESETS[label] || {};
  return (
    <span
      className={`flex h-4 items-center rounded-[4px] border-[0.5px] px-[6px] text-[10px] font-medium leading-[14px] ${className}`}
      style={{ background: bg || p.bg, borderColor: border || p.border, color: color || p.color }}
    >
      {label}
    </span>
  );
}

/** 订单活动卡（我的订单-全部 Group 27189）：351 宽 r8；
 *  头图 351×149 r8，角标组 右下@(右8,底8) 间距 4；参与 pill 28 高 #242424@(8,113)：
 *  头像 24 重叠 -9、+ 10/600、人数 12/600；标题 16/500@157；时间/地点行：16 盒黄图标 + 4px + 12/400 白；
 *  底条 40px：状态角标 10/500 #b3b3b3 #080808 底 + 实付款（¥12px + 数 20px）24/500 黄。 */
export function OrderCard({ image, tags = [], avatars = [], attendees, title, rows = [], status, payment, className = "", onClick }) {
  return (
    <div className={`w-full overflow-hidden rounded-[8px] ${className}`} onClick={onClick}>
      <div className="rounded-t-[8px] bg-[#202020]">
        {image && (
          <div className="relative">
            <img src={image} alt="" className="block h-[149px] w-full rounded-[8px] object-cover" />
            {tags.length > 0 && (
              <div className="absolute bottom-2 right-2 flex gap-[4px]">
                {tags.map((t) => (
                  <OrderTag key={t.label || t} label={t.label || t} />
                ))}
              </div>
            )}
            {avatars.length > 0 && (
              <div className="absolute bottom-2 left-2 flex h-[28px] items-center rounded-[100px] bg-[#242424] pl-[2px] pr-[10px]">
                {avatars.map((a, i) => (
                  <img key={i} src={a} alt="" className="h-6 w-6 rounded-full object-cover" style={{ marginLeft: i ? -9 : 0, zIndex: 3 - i, position: "relative" }} />
                ))}
                <span className="relative z-[4] ml-[6px] text-[10px] font-semibold leading-[14px] text-white">+</span>
                {attendees != null && <span className="relative z-[4] text-[12px] font-semibold leading-[16.8px] text-white">{attendees}参加</span>}
              </div>
            )}
          </div>
        )}
        {title && <div className="truncate px-3 pt-[8px] text-[16px] font-medium leading-[22.4px] text-white">{title}</div>}
        <div className="flex flex-col gap-[4px] px-3 pb-[11px] pt-[8px]">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-[4px]">
              <span className="relative block h-4 w-4 flex-none">
                <Icon name={r.icon} size={{ width: r.iw, height: r.ih }} style={{ position: "absolute", left: r.ix ?? 1, top: r.iy ?? 1 }} className="text-brand" />
              </span>
              <span className="truncate text-[12px] leading-[16.8px] text-white">{r.text}</span>
            </div>
          ))}
        </div>
      </div>
      {(status || payment) && (
        <div className="mt-px flex h-10 items-center rounded-b-[8px] bg-[#202020] px-3">
          {status && (
            <span className="flex h-4 items-center rounded-[4px] border-[0.5px] border-[#080808] bg-[#080808] px-[6px] text-[10px] font-medium leading-[14px] text-[#b3b3b3]">
              {status}
            </span>
          )}
          {payment != null && (
            <span className="ml-auto whitespace-nowrap font-medium leading-[33.6px] text-brand">
              <span className="text-[12px]">实付款：¥</span>
              <span className="text-[20px]">{payment}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 价格明细头行（订单详情）：40px #202020：16 圆黄 + money 图标（黑）+ 4px + 12/400 白标题 */
export function PriceHeader({ icon = "money-cny-box", title = "价格明细", className = "" }) {
  return (
    <div className={`flex h-10 items-center gap-[4px] bg-[#202020] px-3 ${className}`}>
      <IconBadge icon={icon} color="#000000" />
      <span className="text-[12px] leading-[16.8px] text-white">{title}</span>
    </div>
  );
}

/** 价格行（订单详情）：40px #202020，label 12/400 白 + 值 12/500 白右对齐；
 *  highlight（总计）：label 12/500，值 ¥12px + 数字 20px 品牌黄 */
export function PriceRow({ label, value, highlight, className = "" }) {
  return (
    <div className={`flex h-10 items-center justify-between bg-[#202020] px-3 ${className}`}>
      <span className={`text-[12px] leading-[16.8px] text-white ${highlight ? "font-medium" : ""}`}>{label}</span>
      {highlight ? (
        <span className="text-[20px] font-medium leading-[33.6px] text-brand">
          <span className="text-[12px]">¥</span>
          {value}
        </span>
      ) : (
        <span className="text-[12px] font-medium leading-[16.8px] text-white">¥{value}</span>
      )}
    </div>
  );
}

/** 价格组：共享 8px 圆角（首行上圆角、末行下圆角），行间 1px 缝 */
export function PriceRowGroup({ children, className = "" }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-[8px] [&>*:not(:first-child)]:mt-px [&>*:first-child]:rounded-t-[8px] [&>*:last-child]:rounded-b-[8px] ${className}`}>
      {children}
    </div>
  );
}

/** 嘉宾卡（嘉宾-a）：170×187 r8 #202020——Lv 徽章@(8,8)、头像 56@(57,8)、
 *  名字 16/500 居中@72、meta 10/500 #f7f7f7 居中@98、简介 10/400 #b3b3b3@(12,119) 两行；
 *  底部：MIP 勋章 20@(8,159) + 邀请人 10/400 #b3b3b3@(86,162) + 头像 20@(142,159) */
export function GuestCard({ avatar, level, name, meta, intro, badge, inviter, inviterAvatar, className = "", onClick }) {
  return (
    <div className={`relative h-[187px] w-[170px] rounded-[8px] bg-[#202020] ${className}`} onClick={onClick}>
      {level && <LevelBadge className="absolute left-2 top-2">{level}</LevelBadge>}
      {avatar && <img src={avatar} alt="" className="absolute left-[57px] top-2 h-14 w-14 rounded-full object-cover" />}
      {name && <span className="absolute left-0 top-[72px] w-full text-center text-[16px] font-medium leading-[22.4px] text-white">{name}</span>}
      {meta && <span className="absolute left-0 top-[98px] w-full text-center text-[10px] font-medium leading-[16.8px] text-[#f7f7f7]">{meta}</span>}
      {intro && (
        <p className="absolute left-3 top-[119px] w-[144px] text-[10px] leading-[14px] text-[#b3b3b3]" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {intro}
        </p>
      )}
      {badge && <img src={badge} alt="" className="absolute left-2 top-[159px] h-5 w-5" />}
      {inviter && <span className="absolute left-[86px] top-[162px] text-[10px] leading-[14px] text-[#b3b3b3]">{inviter}</span>}
      {inviterAvatar && <img src={inviterAvatar} alt="" className="absolute left-[142px] top-[159px] h-5 w-5 rounded-full object-cover" />}
    </div>
  );
}

/** NPC 任务行（玩家等级 Group 27234）：351×67 r8 #202020——标题 12/500 白@(12,14)、
 *  描述 10/400 白@(12,32)；+EXP（+16px EXP12px 数16px 黄）紧贴右侧按钮；按钮 64×25 r100：
 *  去完成 #fcdf03 底黑字 / 已完成 #080808 底黄字，文字 12/500 */
export function TaskCard({ title, desc, exp, done, actionText = "去完成", onAction, className = "" }) {
  return (
    <div className={`flex h-[67px] w-full items-center rounded-[8px] bg-[#202020] px-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium leading-[16.8px] text-white">{title}</div>
        {desc && <div className="mt-[1px] truncate text-[10px] leading-[14px] text-white">{desc}</div>}
      </div>
      {exp != null && (
        <span className="whitespace-nowrap text-[16px] font-medium leading-[22.4px] text-brand">
          + <span className="text-[12px]">EXP</span> {exp}
        </span>
      )}
      <button
        type="button"
        onClick={onAction}
        className={`flex h-[25px] w-16 flex-none items-center justify-center rounded-[100px] px-2 text-[12px] font-medium leading-[16.8px] ${
          exp == null ? "ml-auto" : ""
        } ${done ? "bg-[#080808] text-brand" : "bg-brand text-black"}`}
      >
        {done ? "已完成" : actionText}
      </button>
    </div>
  );
}

/** 空状态（空数据图标页）：Mystery Box 180×180 + 3px + 文案 16/500 白 */
export function EmptyState({ image, text = "页面不在MIP星球", className = "" }) {
  return (
    <div className={`flex flex-col items-center py-16 ${className}`}>
      {image && <img src={image} alt="" className="h-[180px] w-[180px] object-cover" />}
      {text && <span className="mt-[3px] text-[16px] font-medium leading-[22px] text-white">{text}</span>}
    </div>
  );
}

/* ---------- 弹窗 / 录音 ---------- */

/** iOS 风格 Dialog（5.Dialog 实测）：320×232 r8 #333333；
 *  标题 17/500 white/90@32、正文 17/400 白@72（宽 272 居中）；按钮行 56，17/500 #7d90a9 + 发丝线 */
export function Dialog({ open, title, children, cancelText = "取消", confirmText = "确定", single = false, onCancel, onConfirm, confirmDisabled, className = "" }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className={`w-[320px] overflow-hidden rounded-[8px] bg-[#333333] ${className}`}>
        <div className="relative h-[176px]">
          <div className="absolute left-6 top-[32px] w-[272px] text-center text-[17px] font-medium leading-[22px] text-white/90">{title}</div>
          {children && <div className="absolute left-6 top-[72px] w-[272px] text-center text-[17px] leading-[24px] text-white">{children}</div>}
        </div>
        {/* single：iOS 5.Dialog 单按钮变体（活动-首页-b 1820:19040「我知道了」），无右侧分隔线 */}
        <div className="flex border-t border-white/10">
          {single ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="h-[56px] w-full text-[17px] font-medium text-[#7d90a9] disabled:opacity-60"
            >
              {confirmText}
            </button>
          ) : (
            <>
              <button type="button" onClick={onCancel} className="h-[56px] flex-1 border-r border-white/10 text-[17px] font-medium text-[#7d90a9]">
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirmDisabled}
                className="h-[56px] flex-1 text-[17px] font-medium text-[#7d90a9] disabled:opacity-60"
              >
                {confirmText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 录音按钮三层光晕：#fff7b8 88 → #feeb5d 76 → #fcdf03 64 + 麦克风 32 */
export function RecordPulse({ onClick, className = "" }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#fff7b8] ${className}`}>
      <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-[#feeb5d]">
        <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-brand">
          <Icon name="mic-ai-fill-1" size={32} className="text-[#080808]" />
        </span>
      </span>
    </button>
  );
}

const CHECK = (
  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);
const CLOSE = (
  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M5 5l14 14M19 5L5 19" />
  </svg>
);

/** 圆形图标按钮：40×40，勾/叉 32×32 白；check #18e779 / close #ff4d5e */
export function RoundIconButton({ type = "check", onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={type}
      className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${type === "check" ? "bg-[#18e779]" : "bg-[#ff4d5e]"} ${className}`}
    >
      {type === "check" ? CHECK : CLOSE}
    </button>
  );
}

/** 录音计时：48/700 SF Pro 品牌黄 tabular-nums */
export function TimerText({ value = "00:00:00", className = "" }) {
  return (
    <span className={`text-[48px] font-bold leading-[57px] tabular-nums text-brand ${className}`} style={{ fontFamily: "'SF Pro Text',-apple-system,sans-serif" }}>
      {value}
    </span>
  );
}

/* ============ 活动 / 机会页新增（2026-09-08，snapshot 1819:17664 / 1766:36567 / 1824:19671 实测） ============ */

/** 参加数胶囊 Group 27053：116×28 r100。头像堆 3×24@(2,2) 步进15、1px 白描边；
 *  "+" 10/600@(62,5)；计数 12/600@(69,5) 右距 8。
 *  variant：dark=#242424 白字（活动卡）/ yellow=#fcdf03 黑字（机会卡，实测无黑描边）。 */
export function AttendPill({ count = 45, label = "参加", avatars = [], variant = "dark", onClick, className = "" }) {
  const yellow = variant === "yellow";
  const fg = yellow ? "text-[#080808]" : "text-white";
  return (
    <button type="button" onClick={onClick} className={`relative block h-[28px] w-[116px] rounded-full ${yellow ? "bg-brand" : "bg-[#242424]"} ${className}`}>
      <span className="absolute left-[2px] top-[2px] h-6 w-14">
        {avatars.slice(0, 3).map((a, i) => (
          <img key={i} src={a} alt="" className="absolute top-0 h-6 w-6 rounded-full object-cover ring-1 ring-white" style={{ left: i * 15, zIndex: 3 - i }} />
        ))}
      </span>
      <span className={`absolute left-[62px] top-[5px] text-[10px] font-semibold leading-[14px] ${fg}`}>+</span>
      <span className={`absolute right-[8px] top-[5px] whitespace-nowrap text-[12px] font-semibold leading-[17px] ${fg}`}>{count}{label}</span>
    </button>
  );
}

/** 活动卡 Group 27144/27145：351×238 r8 #202020。封面 351×149 上圆角 8；
 *  标签 chips 右下(265,125) h16 r4 bg#fde530+1px #d0b801 黑字 10/500；
 *  AttendPill dark@(8,113)；标题 16/500@(12,157)；日历行@(12,187)、地点行@(12,209) 12/400 白 +16px 图标 gap4；
 *  分享圆 #fde530 24×24@(319,206) 内 share 图标 13。 */
export function ActivityCard({ cover, tags = [], title, date, location, attendees = 45, label = "参加", avatars = [], onShare, className = "" }) {
  return (
    <div className={`relative h-[238px] w-[351px] overflow-hidden rounded-[8px] bg-[#202020] ${className}`}>
      {cover && <img src={cover} alt="" className="absolute left-0 top-0 h-[149px] w-full rounded-t-[8px] object-cover" />}
      {tags.length > 0 && (
        <span className="absolute left-[265px] top-[125px] flex gap-1">
          {tags.map((t) => (
            <span key={t} className="flex h-4 items-center rounded-[4px] border border-[#d0b801] bg-[#fde530] px-[6px] text-[10px] font-medium leading-[14px] text-[#080808]">{t}</span>
          ))}
        </span>
      )}
      <AttendPill count={attendees} label={label} avatars={avatars} className="absolute left-2 top-[113px]" />
      <span className="absolute left-3 top-[157px] w-[327px] truncate text-[16px] font-medium leading-[22.4px] text-white">{title}</span>
      {date && (
        <span className="absolute left-3 top-[187px] flex items-center gap-1 text-[12px] leading-[18px] text-white">
          <Icon name="calendar-schedule" size={16} className="text-white" />
          {date}
        </span>
      )}
      {location && (
        <span className="absolute left-3 top-[209px] flex items-center gap-1 text-[12px] leading-[18px] text-white">
          <Icon name="icon-map-pin-line" size={16} className="text-white" />
          {location}
        </span>
      )}
      {onShare && (
        <button type="button" onClick={onShare} className="absolute left-[319px] top-[206px] flex h-6 w-6 items-center justify-center rounded-full bg-[#fde530]">
          <Icon name="share-circle" size={13} className="text-[#080808]" />
        </button>
      )}
    </div>
  );
}

/** 机会卡 Group 27248：351×176 r8 #202020。缩略图 120×160 r4@(8,8)；标题 16/500@(136,12) 宽192；
 *  信息行 x136 起三行：价值 y42（money-cny-circle）/地区 y65（map-pin）/寻找 y88（service-headset），
 *  16px 黄图标 #fcdf03 + 12/400 白 gap4；AttendPill yellow@(227,140)。 */
export function OpportunityCard({ image, title, value, region, seeking, referrals = 45, label = "引荐", avatars = [], onClick, className = "" }) {
  const rows = [
    [value, "money-cny-circle-line"],
    [region, "icon-map-pin-line"],
    [seeking, "service"],
  ];
  return (
    <div onClick={onClick} className={`relative h-[176px] w-[351px] rounded-[8px] bg-[#202020] ${className}`}>
      {image && <img src={image} alt="" className="absolute left-2 top-2 h-[160px] w-[120px] rounded-[4px] object-cover" />}
      <span className="absolute left-[136px] top-[12px] w-[192px] truncate text-[16px] font-medium leading-[22.4px] text-white">{title}</span>
      {rows.map(([text, icon], i) =>
        text ? (
          <span key={icon} className="absolute left-[136px] flex items-center gap-1 text-[12px] leading-[18px] text-white" style={{ top: 42 + i * 23 }}>
            <Icon name={icon} size={16} className="text-brand" />
            {text}
          </span>
        ) : null
      )}
      <AttendPill count={referrals} label={label} avatars={avatars} variant="yellow" className="absolute left-[227px] top-[140px]" />
    </div>
  );
}

/** 半屏选择面板（活动-首页-原生 8.ActionSheet，1824:19671 实测）：全宽底栏 #333333/95 + backdrop-blur；
 *  标题栏 h56 15/500 白@90 居中；选项行 x24 宽327 h56 17/400 白@90 居中、发丝线分隔；
 *  按钮排居中间距16：取消 108×40 r4 bg 白@10% / 完成 bg #07c160，白字 17/500；底部 HomeIndicator。 */
export function ActionSheet({ open, title, options = [], activeIndex = -1, cancelText = "取消", confirmText = "完成", onCancel, onConfirm, children, className = "" }) {
  if (!open) return null;
  return (
    <div className={`absolute inset-x-0 bottom-0 z-50 backdrop-blur-[24px] ${className}`} style={{ background: "rgba(51,51,51,.95)" }}>
      <div className="relative flex h-[56px] items-center justify-center border-b border-white/10">
        <span className="text-[15px] font-medium leading-[21px] text-white/90">{title}</span>
      </div>
      <div className="px-6 pt-2">
        {options.map((o, i) => (
          <div key={i} className={`flex h-[56px] items-center justify-center border-b border-white/10 text-[17px] leading-[24px] ${i === activeIndex ? "font-medium text-brand" : "text-white/90"}`}>
            {o}
          </div>
        ))}
      </div>
      {children}
      <div className="flex items-center justify-center gap-4 pb-[34px] pt-8">
        <button type="button" onClick={onCancel} className="h-10 w-[108px] rounded-[4px] bg-white/10 text-[17px] font-medium leading-[24px] text-white">
          {cancelText}
        </button>
        <button type="button" onClick={onConfirm} className="h-10 w-[108px] rounded-[4px] bg-[#07c160] text-[17px] font-medium leading-[24px] text-white">
          {confirmText}
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-[34px] items-start justify-center pt-[9px]">
        <span className="h-[5px] w-[134px] rounded-full bg-white" />
      </div>
    </div>
  );
}
