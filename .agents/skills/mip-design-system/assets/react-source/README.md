# @mip/components — React + Tailwind 组件库

来源：Figma「我的」页 64 屏实测规格（见 [DESIGN.md](../../../../../DESIGN.md) §6）。零运行时依赖（仅 peer `react`），样式为 Tailwind 任意值类。

## 安装使用

```jsx
import { Screen, NavBar, DetailRow, DetailRowGroup, PrimaryButton, Icon } from "figma-restored/components";

// Tailwind 需注册品牌色（任选其一：config 或 CSS 变量）
// tailwind.config: colors: { page:'#080808', surface:'#202020', brand:'#fcdf03', t3:'#b3b3b3' }
```

无构建环境可直接打开 **`demo.html`**（组件实际渲染效果），或 **`gallery.html`**（组件 + 图标总览，按类型分组、点击复制名称；二者均 React/Tailwind 走 CDN，esbuild 预编译为 `*.bundle.js`）。

## 组件一览

### 系统层（chrome.jsx）

| 组件 | 说明 |
|---|---|
| `Screen` | 375 宽页面壳（#080808），含中文字体栈 |
| `StatusBar` | iOS 状态栏 47px（9:41 + 真实导出的信号/Wi-Fi/电池图标） |
| `NavBar` | 含状态栏 88px：返回 + 居中标题 16/600 + 系统胶囊 87×24 |
| `TabBar` | 56px 仅 Tab 行：4 tab（icon 28 + 10px 标签，激活 `#fcdf03`）。**不含** HomeIndicator |
| `HomeIndicator` | 白条 134×5（34px 行）· iOS 系统组件，与 TabBar 分离，页面自行叠加 |

### 基础件（primitives.jsx）

| 组件 | 规格 |
|---|---|
| `DetailRow` / `DetailRowGroup` | 46px 行，label 白 14/500 + 值 #b3b3b3 12/500；组内共享 8px 圆角 |
| `FormFieldRow` | 编辑态行，`trailing="calendar" \| "chevron"` |
| `SectionHeader` | 16px 黄图标 + 16/500 标题 + 右侧附加 |
| `TagChip` | h28 r8 + 1px 黑描边；激活 `#fcdf03/#080808`，默认 `#202020/#b3b3b3` |
| `CityCell` | 101×40 r8；激活黄底黑字，默认 `#333333/#f7f7f7` |
| `SearchBar` | 40px r8 #202020 + search 图标 |
| `AlphabetSlider` | A–Z# 竖排 11/600 品牌黄（absolute 定位） |
| `PrimaryButton` | 351×56 液态玻璃外圈（`#ffdd02@10%` + 白 frost + backdrop blur + 内高光，Group 27137）+ 327×40 黄芯 1px 黑描边 |
| `PillButton` | h40 r100 胶囊，1px 黑描边；primary 黄底黑字 / secondary `#202020` 黄字（Frame 27202/27203） |
| `AddButton` | 添加卡 351×100 r8 #202020 + 0.5px 黄**虚线**描边（4:4，SVG 直译）；「＋添加」居中（实心 plus 14 + 14/500 黄字，Group 27239） |
| `Switch` | iOS 开关 51×31（#34c759），旋钮双投影 `0 3px 1px @6%` + `0 3px 8px @15%` |
| `IconBadge` | 16 圆黄底 + 12 深色图标 + 10px 白标签 |
| `StarRating` / `ScoreCard` | 20px 星；打分卡 170×68 r8 |

### 业务件（business.jsx）

| 组件 | 说明 |
|---|---|
| `TipBanner` | 通栏 32px 黄底提示 |
| `AiAssistCard` | AI 助手入口卡 351×100 r8 #202020 + 1px 黄描边；「AI图标+AI助手」双居中（编辑合作卡 Frame 45 2571:34324） |
| `ProfileHeader` | 头像 80（2px #080808 圆环）+ 名字 + Lv 徽章 + meta/简介 |
| `StatHeader` | 四列统计（数值 20/600 + 10px 标签 + 红点角标） |
| `LevelBanner` | 玩家等级黄卡：装饰簇**烘焙底图**（sphere color-burn 混合已烘入）+ Lv + 进度条/文字叠加 |
| `CooperationCard` | 合作卡 351×200 r16，**六角色变种** `variant="dogplaner\|upstart\|design-slave\|pimp\|business-man\|old-nanny"`：装饰层烘焙为逐卡单张底图（`deliverables/miniprogram/`，组件只叠人名+目标/引荐条），见 gallery |
| `OrderCard` / `PriceRow` | 订单活动卡（标签+标题+时间地点）；价格行（highlight 黄色加粗） |
| `TaskCard` | NPC 任务卡（类型徽章 + 赏金 + 操作按钮） |
| `GuestCard` | 嘉宾卡 170×187（头像 + Lv + 简介 + 邀请人） |
| `EmptyState` | 空状态插画 + 文案 |
| `Dialog` | iOS 弹窗 320 宽 r8 #333；标题 17/500 + 正文 17/400 白；按钮行 56、17/500 `#7d90a9` + 发丝线；`single` 单按钮变体（5.Dialog「我知道了」） |
| `AttendPill` | 参加数胶囊 116×28 r100：头像堆 3×24 白描边 + 计数 12/600；variant dark `#242424` / yellow `#fcdf03`（Group 27053） |
| `ActivityCard` | 活动卡 351×238 r8：封面 149 高 + 标签 `#fde530/#d0b801` + AttendPill + 标题/时间/地点 + 分享圆（Group 27144） |
| `OpportunityCard` | 机会卡 351×176 r8：左图 120×160 + 标题 + 三行黄图标信息（价值/地区/寻找）+ AttendPill yellow（Group 27248） |
| `ActionSheet` | 半屏选择面板 `#333333/95`+blur：标题栏 56 + 选项行 56 发丝线分隔 + 取消（白@10%）/完成（`#07c160`）108×40（8.ActionSheet）；日期轮盘等自定义内容经 `children` 传入（活动-首页-原生 1824:19671） |
| `RecordPulse` | 录音按钮 88→76→64 三层光晕 + 麦克风 |
| `RoundIconButton` | 40 圆：check #18e779 / close #ff4d5e |
| `TimerText` | 48/700 SF Pro tabular-nums 品牌黄 |

### 图标

```jsx
import { Icon } from "figma-restored/components";
<Icon name="draft-line" size={16} className="text-brand" />
```

- 数据：`icons.js`（**自动生成**，451 个，来源 `../icons/*.svg`，内容 sha1 去重）
- 单色图标（mono）自动转 `currentColor`，颜色随容器 `text-*` 类；多色插画保留原色
- 未知 name 在开发环境 console.warn 并返回 null
- 全量名称清单见 `../tools/icons-index.json`（含使用次数，高频：battery/wifi/share/home/back/time/star-favorite-3 等）
- 命名：设计师命名 > `../tools/icon-names.json` 人工覆盖 > 来源节点聚合 > 兜底；设计师未命名的矢量已全部视觉定名（标题字母 `letter-*`、装饰素材 `deco-*`、功能图标 `icon-*`）

## 重新生成

```bash
node ../tools/gen-icons.mjs     # 图标变化后；改 tools/icon-names.json 后也重跑
node ../tools/gen-demo.mjs      # 组件源码变化后（需要 npx esbuild）
node ../tools/gen-gallery.mjs   # 同上，重新生成组件/图标总览页 gallery.html
node ../tools/gen-baked-assets.mjs  # 改合作卡/等级卡装饰（tools 里 VARIANTS 表）后重新烘焙切图
```
