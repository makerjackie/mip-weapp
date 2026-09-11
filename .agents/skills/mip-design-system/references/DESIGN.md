# MIP 小程序设计系统（DESIGN.md）

> 来源：Figma 文件 **「MIP (Copy)」**，通过 figma-mcp-free 本地桥（命令通道）抓取。2026-09-07 还原页面「我的」64 屏；2026-09-08 补齐「活动」「机会」「勋章」36 屏，**共 4 页 100 屏**。
> 原始数据：`figma-restored/snapshot/*.json`；HTML 还原：`figma-restored/pages/`；组件库：`figma-restored/components/`；图标：`figma-restored/icons/`。
> 复现工具：`figma-restored/tools/`（fetch-frames → figma-to-html → export-assets → aggregate-tokens）。

---

## 1. 设计概览

| 维度 | 约定 |
|------|------|
| 画板宽度 | **375px**（iOS 逻辑分辨率），安全区：状态栏 47px + 底部 Home Indicator 34px |
| 主题 | **暗黑主题**：页面底 `#080808`，卡片/行底 `#202020` |
| 主色 | **品牌黄 `#fcdf03`**（按钮、高亮、图标、计时器、激活态） |
| 字体 | 中文 **PingFang SC**；数字/计时器 **SF Pro Text**；**D-DIN Exp** 活动页倒计时/大数字（×31，见 §9）；标注 Inter（仅设计稿注释） |
| 图标 | **Remix Icon** 体系（`*-line` / `*-fill` 命名），单色，随文字色 |
| 布局 | 左右页边距 **12px**（内容宽 351）；卡片内边距 `10px 12px`；行高 46px |
| 层级 | 无投影（仅 4 处 drop-shadow），靠明度差 `#080808 → #202020 → #333333`；iOS 16 UI Kit 提供 StatusBar/NavBar/TabBar/HomeIndicator 实例 |

---

## 2. 色彩 Tokens

### 2.1 背景与表面

| Token | 值 | 频次 | 用法 | Tailwind |
|---|---|---|---|---|
| `bg-page` | `#080808` | 408 | 页面底色 | `bg-[#080808]` |
| `bg-surface` | `#202020` | 469 | 行/卡片/输入底 | `bg-[#202020]` |
| `bg-surface-2` | `#333333` | 39 | 次级卡片、Dialog、城市格 | `bg-[#333333]` |
| `bg-surface-3` | `#242424` | 57 | 小徽章底（Lv 徽章等） | `bg-[#242424]` |
| `bg-surface-deep` | `#191919` | 212(描边) | 紫卡上的引荐条（亦作描边） | `bg-[#191919]` |
| `bg-cell` | `#d9d9d9` | 66 | 占位头像底 | `bg-[#d9d9d9]` |

### 2.2 品牌色

| Token | 值 | 频次 | 用法 |
|---|---|---|---|
| `brand` | `#fcdf03` | 528 | 主按钮、激活 Chip、星星、图标、AI 文案、计时器、字母滑条 |
| `brand-bright` | `#ffdd02` `@10%` | 22 | 主按钮外圈光晕 |
| `brand-alt` | `#fde104` | 22 | 品牌黄变体（插画/描边） |
| `brand-dark-stroke` | `#d0b801` | 69(描边) | 黄色图形描边（插画/词标） |

### 2.3 紫色系（合作卡专属）

| Token | 值 | 频次 | 用法 |
|---|---|---|---|
| `purple-card` | `#7b00ff` | — | 合作卡大卡底 |
| `purple-deep` | `#3b007a` / `#6500d1` | 275 | 卡内装饰图形 |
| `purple-text` | `#f2e5ff` | 44 | 紫卡上的反白偏紫文字 |
| `purple-light` | `#dab8ff` | — | 紫卡装饰光带 |

### 2.4 合作卡插画五色（`2004:2227` 装饰图形）

| 值 | 用法 |
|---|---|
| `#1a71ff` / `#04a44f` / `#ff5500` / `#af0484` / `#7a2900` | 合作卡大卡上的彩色装饰矢量（人物/图形插画），各出现 ~26 次 |

### 2.5 文字（实测频率排序）

| Token | 值 | 典型规格 | 用法 |
|---|---|---|---|
| `text-primary` | `#ffffff` | 12/500、14/500、16/500、16/600、17/600、10/400、12/400、10/500 | 主文案、表单标签、导航标题 |
| `text-secondary` | `#b3b3b3` | 10/400、12/500、14/500、14/400 | 次要文案、占位符、行值、未激活 Chip |
| `text-on-brand` | `#080808` | 12/500、16/500 | 黄底上的文字（主按钮、激活 Chip） |
| `text-cell` | `#f7f7f7` | — | 城市格等格子文字 |
| `text-brand` | `#fcdf03` | 10/600 | 徽章标签、AI 文案、高亮值 |
| `text-disabled` | `#7d90a9` | — | Dialog 主操作禁用态（iOS 语义灰蓝） |
| `icon-dim` | `#dadada` | 195 | 状态栏/灰态图标 |

### 2.6 状态色

| Token | 值 | 用法 |
|---|---|---|
| `record` | `#ff2238` | 录音红点（64×64 圆） |
| `success` | `#18e779` | 确认（✓）圆形按钮 40×40 |
| `danger` | `#ff4d5e` | 取消（✕）圆形按钮 40×40 |
| `annotation` | `#ff1313` | 设计稿红字标注（非 UI） |

### 2.7 描边与半透明

| Token | 值 | 用法 |
|---|---|---|
| `hairline` | `rgba(255,255,255,0.10)` | Dialog 按钮分隔线、细描边（白色描边 290 次多为半透明发丝线） |
| `stroke-dark` | `#191919` / `#080808` / `#000000` | 深色图形描边 |
| `keyline` | `#080808` 1px INSIDE | **黄色元素统一黑描边**：主按钮内芯、胶囊按钮（27202/27203）、TagChip 激活态——设计语言规则，勿漏 |
| `overlay-*` | 白 `@0.9 / 0.5` | Dialog 按钮文字 / 正文 |
| 液态玻璃 `GLASS` | 参数不随 REST 导出 | 仅底部主按钮 wrapper（Group 27137→Frame 3719，22 屏）：fill `#ffdd02@10%` + 白 frost ≈12% + `backdrop-blur(20px) saturate(1.5)` + 内侧白高光，实测观感近似 |
| 节点透明度 | `0.15 / 0.25 / 0.35 / 0.4` 为主 | 白色蒙层、按钮按压态、装饰 |

### 2.8 录音脉冲光晕

`#fff7b8`（88×88 外圈）→ `#feeb5d`（76×76 内圈）→ `#fcdf03`（64×64 麦克风主圆）。

---

## 3. 字体 Token（实测频率排序）

| Token | 规格 | 行高 | 频次 | 用法 | Tailwind 类 |
|---|---|---|---|---|---|
| `text-caption` | 10px / w400–500 | 14 | 360 | 徽章标签、合作卡小字、Lv、简介 | `text-[10px] leading-[14px]` |
| `text-body-sm` | 12px / w500 | 16.8 | 399 | 行值、占位示例、Chip 文字 | `text-xs leading-[17px]` |
| `text-body` | 14px / w500 | 19.6 | 315 | 表单标签、格子文字、提示条 | `text-sm font-medium` |
| `text-title` | 16px / w500–600 | 22.4 | 249 | 导航标题、区块标题、按钮文字 | `text-base font-semibold` |
| `text-small-title` | 11px / w500 | 13 | 27 | 迷你标签 | `text-[11px] leading-[13px]` |
| `text-ios` | 17px / w500–600 | 22 | 80 | iOS 系统层（状态栏时间、Dialog 文案） | `text-[17px]` |
| `text-subtitle` | 20px / w500–600 | 28 | 25 | 大数字、等级值 | `text-xl font-semibold` |
| `text-large` | 24px / w600 | — | 7 | 强调数值 | `text-2xl font-semibold` |
| `text-display` | 48px / w700 | 57 | 6 | 录音计时器（SF Pro Text, `tnum`） | `text-[48px] font-bold` |

> 字重分布：w500 ×856、w400 ×327、w600 ×280、w700 ×6。**中文一律 PingFang SC**；计时器/状态栏数字用 SF Pro Text 并加 `font-variant-numeric: tabular-nums`（SF Pro Text ×97）。

---

## 4. 圆角 / 间距 / 层级

### 4.1 圆角

| Token | 值 | 频次 | 用法 |
|---|---|---|---|
| `radius-xs` | 2 | 65 | 微型徽章 |
| `radius-sm` | 4 | 181 | Lv 徽章、电池格、小标签 |
| `radius-md` | 8 | 267 | 行卡片、输入行、Chip、城市格、Dialog、搜索框 |
| `radius-nav` | 15 | 138 | 导航右侧胶囊（灵动岛区） |
| `radius-lg` | 16 | 31 | 合作卡大卡、banner 图 |
| `radius-half` | 50 | 9 | 半圆胶囊 |
| `radius-pill` | 100 | 255 | 主按钮、头像、圆形图标按钮、Home Indicator |

**分组行圆角规则**：连续堆叠的行共享一个圆角外壳 —— `8,8,0,0`（首行 ×42）／`0,0,8,8`（末行 ×40）；合作卡内的 `16,16,0,0` / `0,0,16,16` 同理（见 `DetailRowGroup`）。

### 4.2 间距（auto-layout 实测）

| Token | 值 | 频次 | 用法 |
|---|---|---|---|
| `page-margin` | 12 | — | 页面左右边距（375−351）/2 |
| `card-pad` | `10 12` | 97 | 行/卡片内边距 |
| `chip-pad` | `4 8` | 90 | Chip 内边距 |
| `badge-pad` | `1 4` | 46 | 微型徽章内边距 |
| `row-pad` | `8 10` | 42 | 列表行内边距 |
| `gap-xs` | 2 / 4 | 190 | 图标+文字、紧凑组合 |
| `gap-sm` | 8 | 55 | 卡片内纵向 |
| `gap-md` | 10 | 376 | 行内 label/value（最常用） |
| `gap-lg` | 12 | 10 | 表单标签行内 |
| `gap-xl` | 20 | 74 | 区块间、Tab 项 |
| `row-h` | 46 | — | 标准行高 |
| `chip-h` | 28 | — | Chip 高（py-4 px-8） |
| `cell-h` | 40 | — | 城市格高（101×40） |
| `btn-h` | 40 | — | 主按钮内芯（外圈光晕 56） |
| `tabbar` | 375×56 | — | 仅 Tab 行；Tab 项宽 94。HomeIndicator 34 是独立 iOS 系统组件，页面叠加 |

### 4.3 效果

- **主按钮光晕**：外层 `351×56` 圆角 100、`#ffdd02 @ 10%`；内芯 `327×40` 圆角 100 `#fcdf03`，文字 `#080808 16px/500`。
- **GLASS 效果 ×22**（导航/悬浮条）：REST 导出无参数，HTML 中以 `backdrop-filter: blur(24px) + rgba(20,20,20,.45)` 近似。
- **Dialog 遮罩**：全屏 `#080808` 半透明覆盖，内容 `320×232` 圆角 8。
- Drop-shadow 仅 4 处（Toast/浮层），其余层级靠明度差表达。

---

## 5. 图标体系

命名沿用 **Remix Icon**（实例中直接出现 `remix-icons/line/document/draft-line` 等路径；iOS 16 UI Kit 的 StatusBar 内部图标名为 `Outline`）。

| 图标 | 用途 | 出现位置 |
|---|---|---|
| `chevron-left`（Vector 52） | 返回 | NavBar |
| `share` / `home`（胶囊 Union） | 系统胶囊 | NavBar 右上 `NavigationBar-Accessory` |
| `search-big-left` | 搜索 | 搜索框 |
| `calendar-schedule-line` | 日期选择 | 表单「开始时间」 |
| `chevron-down` | 下拉 | 「主营城市」选择 |
| `plus` | 添加 | 「添加项目/圈子」 |
| `mic-ai-fill` | 麦克风 | 录音主按钮 32px |
| `check-line` / `close-line` | 确认/取消 | 40×40 圆形按钮 |
| `cup-line` | 奖杯 | 「需要引荐」「最大价值」徽章 |
| `target-line` | 靶心 | 「我的目标」「常混迹的圈子」 |
| `copper-diamond-line` | 钻石 | 「最大价值」 |
| `lifebuoy-line` | 救生圈 | 区块标题 |
| `virus-line` | 病毒 | 「需要被理解的臭毛病」 |
| `chat-smile-ai-3-line` | AI 对话 | 「AI助手」入口卡 |
| `star-favorite` | 星星 | 特征打分（5 星） |
| `draft-line` | 文档 | NPC 任务入口 |
| `money-cny-circle-line` | 金额 | 任务赏金 |
| `survey-line` | 问卷 | 任务类型 |
| `close-circle-fill` / `checkbox-circle-fill` | 清空/勾选 | 表单 |
| `file-text-line` / `settings-line` | 文件/设置 | 我的页入口、账号设置 |

已导出的全部矢量见 `figma-restored/icons/`（内容 sha1 去重），索引 `figma-restored/tools/assets-map.json`。

**IconBadge 模式**：`16×16 #fcdf03` 圆底 + 12px 深色图标 + 10px 白字标签（见 `IconBadge` 组件）。

---

## 6. 组件清单（`figma-restored/components/`）

> React + Tailwind 实现；浏览器直接打开 **`figma-restored/components/demo.html`** 查看全部组件渲染效果；用法见 `figma-restored/components/README.md`。

### 6.1 系统层（来自 Figma 实例，频次为全页出现次数）

| 组件 | 规格 | 说明 |
|---|---|---|
| `Screen` | 375×N `#080808` | 页面壳，含安全区 |
| `StatusBar` | 375×47 | iOS 状态栏（9:41/信号/Wi-Fi/电池）×65 |
| `NavigationBar` | 375×88 | 返回 + 标题 16/600 + 右侧胶囊；胶囊实例 `NavigationBar-Accessory` ×121 |
| `TabBar` | 375×56 | 4 tab（56×56，Label 10px）；设计稿误将 `Indicator` 并入组件（×20），应拆分 |
| `HomeIndicator` | 375×34 | 底部白条 134×5 ×63 |
| `Dialog` | 320×232 r8 | `#333333`，标题 17/500 + 正文 17/400 白 + 按钮行 56（17/500 `#7d90a9`）+ 0.1 白发丝线（实例 ×8） |

### 6.2 业务组件

| 组件 | 规格 | 说明 |
|---|---|---|
| `DetailRow` / `DetailRowGroup` | 351×46 | label(#fff 14/500) + value(#b3b3b3 12/500)，分组共享圆角 |
| `FormFieldRow` | 351×46 | 编辑态行：占位/日历/下拉箭头 |
| `SectionHeader` | 16/500 + 16px 黄图标 | 区块标题 |
| `TagChip` | h28 r8 pad `4 8` + 1px 黑描边 | 激活 `#fcdf03/#080808`，默认 `#202020/#b3b3b3` |
| `CityCell` | 101×40 r8 | 默认 `#333333/#f7f7f7`，激活 `#fcdf03/#080808` |
| `SearchBar` | 351×40 r8 | `#202020` + search 图标 + `#b3b3b3` 占位 |
| `AlphabetSlider` | 12×700 | A–Z# 竖排 `#fcdf03` 11/600 |
| `PrimaryButton` | wrapper 351×56 液态玻璃（`#ffdd02@10%`+frost+blur，见 §2.7）+ 内芯 327×40 黄 pill + 1px `#080808` 描边 | 「保存」等主操作（Group 27137，22 屏） |
| `PillButton` | h40 r100 + 1px `#080808` 描边 | primary `#fcdf03` 黑字（立即续费）/ secondary `#202020` 黄字（邀请加入），icon+8+16/500（Frame 27202/27203） |
| `AddButton` | 351×46 透明 | plus + `#fcdf03` 12/500 |
| `AiAssistCard` | 351×100 r8 | `#202020`，AI助手黄字入口 |
| `TipBanner` | 375×32 | `#fcdf03` 通栏提示（`#080808` 14/500） |
| `ListCard` / `OrderCard` | 351×r8 | 我的订单列表卡（状态徽章 + 标题 + 行值 + 操作） |
| `TaskCard` | 351×r8 | NPC 任务卡（类型图标 + 标题 + 赏金 + 状态/操作） |
| `BadgeCard` | 网格 | 我的徽章（图标 + 名称 + 等级） |
| `UserRow` | 56 头像 + 文案 | 嘉宾/互动过/访客列表行 |
| `StatHeader` | 4 列统计 | 嘉宾/互动过/魅力值/访客累计值 |
| `ProfileHeader` | 头像 80 + Lv 徽章 | 名字 16/500、meta 10/500、简介 10/400 `#b3b3b3` |
| `IconBadge` | 16 圆 + label | 见图标体系 |
| `StarRating` | 5×20px | 满星 `#fcdf03`，空星描边 |
| `ScoreCard` | 170×68 r8 | `#202020`，维度名 12/500 + StarRating |
| `Switch` / `Checkbox` | iOS 语义 | 实例 `1.Element/Switch/ON`、`Checkbox/Cell On` |
| `RecordPulse` | 88→76→64 | 录音按钮三层光晕 + 麦克风 |
| `RoundIconButton` | 40×40 | `#18e779` ✓ / `#ff4d5e` ✕ |
| `TimerText` | 48/700 SF Pro | `#fcdf03` 计时 |
| `CooperationCard` | 351×200 r16 | `#7b00ff` 紫卡 + 引荐条 + MIP 词标 + 插画五色装饰 |
| `EmptyState` | — | 空数据图标页（`1987:30475`） |

---

## 7. 页面清单（共还原 100 屏 → `figma-restored/pages/`）

| 模块 | 屏幕（数量） |
|---|---|
| 我的 | 我的-a/b/c/d、我的（未登录）、编辑信息、编辑信息 完成 |
| 名片 | 我的名片-编辑 ×3 变体、我的名片A/B/C-详情、预览名片（访客视角）、我的名片（空数据状态） |
| 订单 | 我的订单-全部/待使用/已完成/已退款、订单详情、订单详情-退款提示 |
| NPC 任务 | 我的任务-待完成/已结束（玩家视角）×2 + 已结束 a/b、派发任务-可派发（NPC 视角）、派发任务-待审核、任务分配列表 |
| 社交 | 嘉宾 a/b、互动过、心动值-你的心动、心动值-对你心动 a/b、访客 |
| 等级 | 玩家等级 a/b、经验值详情-经验值明细、经验值详情-规则明细、入会协议、我的徽章 a–d |
| 超级案例 | 编辑超级案例、超级案例详情 a/b、超级案例详情编辑 |
| 合作卡 | 合作卡、编辑合作卡、人才档案-合作卡、人才档案-合作卡编辑 |
| AI 助手 | 录音智能填充、录完、删除提示、确认录制 |
| 设置 | 账号设置、隐私设置、账号安全、代表行业 |
| 其他 | 空数据图标 |
| **活动** | 活动-首页 a/b/原生/日期选择/详情/分享、活动报名、活动报名-已结束、活动-时间选择、活动详情-已签到、往期活动、参与人、与你互动 a/b、嘉宾 a–c、编辑信息（活动）（18） |
| **机会** | 机会-机会探索 a/b、发布机会-编辑、机会详情、机会详情-访客视角（+默认封面）、机会-人才合作、机会-人才合作筛选 a/b、想给TA引荐、对TA感兴趣、嘉宾档案-合作卡、相关机会、玩家档案、玩家档案-超级案例、超级案例详情（机会页）、代表行业（机会页，与设置页同名异屏）（17） |
| **勋章** | 勋章-素材总览（26 枚六边形勋章图板：扁平版 + 3D 版各 13，位图资产） |

完整 id↔文件映射：`figma-restored/tools/page-index.json`；浏览入口：`figma-restored/pages/index.html`。

---

## 8. 落地约定（微信小程序 / Tailwind）

1. **Tailwind 自定义色**（`tailwind.config.js`）：
   ```js
   colors: {
     page: '#080808', surface: '#202020', 'surface-2': '#333333', 'surface-3': '#242424',
     brand: '#fcdf03', record: '#ff2238', ok: '#18e779', no: '#ff4d5e',
     t1: '#ffffff', t2: '#f7f7f7', t3: '#b3b3b3', dim: '#dadada',
     purple: { card: '#7b00ff', text: '#f2e5ff' },
   }
   ```
2. 分组行的「首末圆角」用 `first:rounded-t-lg last:rounded-b-lg`（放在组容器上）。
3. 计时器数字加 `tabular-nums`；SF Pro 回退 `-apple-system, 'PingFang SC', sans-serif`。
4. 所有图标单色 `currentColor`，通过文字色类控制（`text-brand` 等）；图标组件见 `figma-restored/components/Icon.jsx`。
5. 图片（banner/头像/插画）已按捕获的 IMAGE 填充导出到 `figma-restored/pages/assets/`，组件里用 `<Image>` 占位替换。
6. 行高对齐：Figma 12px 文本行高 16.8 → 落地取整 `leading-[17px]`；16px → `leading-[22px]`；14px → `leading-[20px]`。

---

## 9. 活动 / 机会 / 勋章页补充（2026-09-08，+36 屏实测）

> 三页新增 token 与「我的」页高度一致（暗黑双层底、375 画板、351 内容宽、页边距 12 不变），以下仅列**增量**。

### 9.1 新增色彩

| Token | 值 | 频次 | 用法 |
|---|---|---|---|
| `brand-bright-2` | `#fde530` | 62（填充+描边） | 活动/机会页插画高亮黄 + 活动卡标签 chip 底 + 分享圆；比 `#fcdf03` 更亮，**描边仍遵循黄元素 `#d0b801` 深黄描边规则** |
| `accent-red` | `#ff2248` | 15 | 嘉宾-c 插画红（六边形徽章装饰） |
| `text-dim-2` | `#4c4c4c` | 25 | 日期选择器日历非本月/次要数字（16/400） |
| `ios-gray` | `#8e8e93` | 9 | 详情页次要标签「主办方/报名须知」（iOS systemGray 语义） |
| `illus-navy` | `#09121f` | 4 | 机会探索/筛选深色图标矢量 |
| `illus-skin` | `#ffd3a7` | 4 | 嘉宾-b 插画肤色 |
| `illus-stroke-light` | `#eeeeee` | 3（描边） | 活动-首页-原生 浅色矢量描边 |
| `wechat-green` | `#07c160` | +1 | ActionSheet「完成」主操作按钮底（微信绿语义） |

### 9.2 字体增量

| Token | 规格 | 频次 | 用法 |
|---|---|---|---|
| `display-din` | **D-DIN Exp** | 31 | 活动页倒计时/场次大数字（窄体装饰数字；CSS 回退 `'DIN Alternate','SF Pro Text',sans-serif`） |
| 15px / 18px | 各 1 处 | 2 | 一次性规格（详情正文/弹窗标题），不立 token |

### 9.3 新增 iOS 组件（机会/活动页引入）

| 组件 | 规格 | 频次 |
|---|---|---|
| `8.ActionSheet` | 375×370 半屏面板：`#333333`+BACKGROUND_BLUR；标题栏 56（15/500 白@90 居中）；选项行 56（17/400 白@90，发丝线分隔）；按钮排 取消（白@10%）/完成（`#07c160`）108×40 r4 白字 17/500。**变体**：活动-首页-原生（1824:19671）实例内为日期轮盘（年/月/日 3 列 56px 行 + 选中发丝线），组件经 `options` 或 `children` 覆盖两种形态 | 6 |
| `5.Dialog` | 320×232 r8 `#333333` 单按钮变体（「我知道了」17/500 `#7d90a9`）→ 已并入 `Dialog single` prop | 1 |
| `7.Half-screen Dialog title` | 375×56 标题栏（15/500 白@90 居中） | 1 |
| `3.Button` | 108×40 r4 iOS 面板按钮 | 2 |

### 9.4 新增业务组件（`figma-restored/components/`）

| 组件 | 来源节点 | 规格 |
|---|---|---|
| `ActivityCard` | Group 27144/27145（活动-首页 ×6 屏） | 351×238 r8；封面 351×149；标签 chip `#fde530`+`#d0b801` 描边；AttendPill + 标题/时间/地点 + 分享圆 |
| `OpportunityCard` | Group 27248（机会-机会探索 ×4 屏） | 351×176 r8；左图 120×160 r4；三行黄图标信息（价值/地区/寻找）；AttendPill yellow |
| `AttendPill` | Group 27053（两卡共用） | 116×28 r100；头像堆 3×24 步进 15 白描边 1px；dark/yellow 双变体 |
| `ActionSheet` | 8.ActionSheet | 见 9.3 |

已有组件直接复用：`StatHeader`（= Group 27184，四列统计+红点，机会页档案屏 ×4）、`SearchBar`（351×40 ×10）、`FormFieldRow`（351×46）、`NavBar/TabBar/StatusBar`（iOS 实例不变）。机会页筛选屏的 375×56「Tabs」= 无 HomeIndicator 的 TabBar 变体。

### 9.5 勋章页说明

勋章页（`69:4973`）无 UI 屏幕，仅一个 **26 枚六边形勋章素材板**（`2083:3795`，~11000×5240，扁平版/3D 版各 13 枚，全部为位图 IMAGE 填充）。已按 `png:<imageRef>` 去重导出到 `figma-restored/pages/assets/`，供「我的徽章 a–d」及勋章详情使用。
