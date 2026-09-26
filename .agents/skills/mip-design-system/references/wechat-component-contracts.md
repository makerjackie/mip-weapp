# MIP WeChat component contracts

Visual snapshot: `2026-09-09.2`; native integration rules updated `2026-09-26`.
`assets/react-source/*.jsx` preserves the browser reference. The following native
rules and current repository design decisions take precedence over browser-only
behavior; they do not require replacing existing native components with React.

## Native conversion rules

- Produce WXML for structure, WXSS for visual values, and JavaScript for state
  and events. Static Tailwind classes are supported in source WXML by the
  repository build; compiled WXSS must contain no Tailwind directives. Do not
  emit JSX, browser Preflight, or React dependencies into the mini-program.
- Convert design px to rpx at `1px = 2rpx`; 351px content is 702rpx and 12px
  page margin is 24rpx.
- Use `1rpx` for a design hairline of `0.5px` or `1px` when it is meant to be a
  physical hairline.
- Add `bindtap` for `onClick`/`onAction`; emit typed events with
  `triggerEvent` for React callbacks such as `onChange`, `onSelect`,
  `onCancel`, `onConfirm`, and `onShare`.
- Replace a React node prop with a named `slot`; provide a fallback slot when
  the source has a default child.
- For local baked PNGs, use `<image>`, not WXSS `background-image`. The app
  maps `assets/wechat/baked/` to `/assets/mip/`.
- Grouped rows share one radius shell: first row has the top radius, last row
  has the bottom radius, and middle rows are square.
- Keep text/progress controls above images and never bake instance text into a
  reusable card asset.
- Fixed action bars use the repository's unconditional dark background with
  optional blur. The original translucent GLASS is a visual reference, not a
  requirement to restore removed vendor prefixes or conditional fallbacks.

## System layer

| Component | Native contract |
|---|---|
| `Screen` | Full-width `view`, min-height `100vh`, page background `#080808`, Chinese font stack. Clip decoration locally; keep long page content scrollable. |
| `StatusBar` | Reference preview only: 94rpx, time `9:41`. Native pages use `app-top-safe-area`; do not draw fake system time, signal, or battery. |
| `HomeIndicator` | Reference preview only: 68rpx row. Native pages reserve actual `safe-area-inset-bottom`; do not draw a second white system bar. |
| `Capsule` | Reference preview only. Native pages use WeChat's own capsule and platform geometry when required. |
| `NavBar` | Native title is 32rpx/600; default `showStatusBar=false` and `showCapsule=false`. The reference 176rpx total includes simulated system chrome; do not add it on top of native safe areas. |
| `TabBar` | 112rpx tab row only. `items` defaults to 发现/活动/机会/我的; `activeIndex` defaults to 3; `onSelect(index)`. Icon box is 56rpx, label is 20rpx/500. Active color is brand; inactive is `#b3b3b3`. |

## Primitives

| Component | Props / events | Native visual contract |
|---|---|---|
| `DetailRow` | `label`, `value`, `chevron=true`, `onClick` | 92rpx row; label 28rpx/500 primary; value 24rpx/500 secondary; optional chevron. |
| `DetailRowGroup` | children/slots | Rounded 16rpx shell with card padding; first/last child receive the correct 8px group radius. |
| `FormFieldRow` | `label`, `value`, `placeholder`, `trailing=calendar/chevron`, `onClick` | 92rpx editable row on `#202020`; trailing control is 24rpx iconography. |
| `SectionHeader` | `icon`, `title`, `extra` | 32rpx brand icon + 32rpx/500 title + optional right extra/slot. |
| `TagChip` | `active`, children, `onClick` | 56rpx tall, 16rpx radius, black keyline, 8rpx horizontal padding, 24rpx/500 text. Active brand/on-brand; default `#202020/secondary`. |
| `CityCell` | `active`, children, `onClick` | 202×80rpx, 16rpx radius. Active brand/on-brand; default `#333333/#f7f7f7`. |
| `SearchBar` | `placeholder=搜索`, `value`, `onChange` | 80rpx tall, 16rpx radius, `#202020`; 24rpx brand-adjacent search glyph and 28rpx input text. |
| `AlphabetSlider` | `letters=A–Z#` | Absolute vertical slider; 22rpx/600 brand text. Parent must provide height and tap/move handling. |
| `PrimaryButton` | children=`保存`, `onClick`, `disabled` | Outer 702×112rpx brand halo; inner 654×80rpx brand core with black keyline and 32rpx/500 on-brand text. Disabled uses 40% opacity. |
| `PillButton` | `variant=primary/secondary`, `icon` slot, children, `onClick` | 80rpx tall pill, black keyline, 32rpx/500 text. Primary brand/on-brand; secondary `#202020`/brand. |
| `AddButton` | children=`添加`, `onClick` | 200rpx tall card, 16rpx radius, `#202020`, 1rpx brand dashed border with 4:4 pattern. Center a 28rpx filled plus + 28rpx/500 brand text with 8rpx gap. |
| `Switch` | `checked`, `onChange` | 102×62rpx; on `#07c160`, off `#39393d`; 54rpx white knob with source shadow stack. |
| `IconBadge` | `icon`, `label`, `color=#202020` | 32rpx brand circle with inset icon + 8rpx gap + 20rpx/400 primary label. |
| `StarRating` | `value=0`, `max=5`, `size=20` | Stars separated by 4rpx; active `star-favorite-3` brand, inactive `#4d4d4d`. |
| `ScoreCard` | `title`, `value`, `onChange` | 340×136rpx, 16rpx radius, `#202020`, centered 24rpx/500 title and rating. |

## Business components

| Component | Props / events | Native visual contract |
|---|---|---|
| `TipBanner` | children | Full-content 64rpx brand banner with on-brand 28rpx/500 text. |
| `AiAssistCard` | `title=AI助手`, `onClick` | 200rpx tall, 16rpx radius, `#202020`, 1rpx brand border; centered AI icon + 28rpx/500 brand title. |
| `LevelBadge` | children=`Lv.23` | 4rpx radius micro-badge on `#242424`; caption-size brand text. |
| `ProfileHeader` | `avatar`, `name`, `level`, `meta`, `intro`, `badge` | 160rpx avatar with 4rpx page-background ring; name, level badge, metadata, and one-line intro. |
| `StatHeader` | `stats=[{value,label,badge?}]` | Four equal columns; value 40rpx/600 primary, label 20rpx secondary, optional red annotation badge. |
| `LevelBanner` | `level=Lv.23`, `current=3000`, `target=40000`, `fillPx` | See baked-card rules below. |
| `MipWordmark` | `color=#F2E6FF` | 94×30rpx M-I-P composition using registry letter icons. |
| `CooperationCard` | `variant`, `name`, `goal`, `referral`, `goalLabel`, `referralLabel`, `onClick` | See baked-card rules below. |
| `OrderTag` | `label`, `bg`, `border`, `color` | 32rpx tall, 8rpx radius, 1rpx stroke, 20rpx/500 text. Presets: 仅玩家 `#fde530/#d0b801/#000`; 沙龙 `#428bff/#075adf/#f7f7f7`. |
| `OrderCard` | `image`, `tags`, `avatars`, `attendees`, `title`, `rows`, `status`, `payment`, `onClick` | 16rpx radius order card with cover, tag chips, attendee pill, title, icon rows, status/payment controls. |
| `PriceHeader` | `icon=money-cny-box`, `title=价格明细` | 32rpx brand icon + 32rpx/500 primary title. |
| `PriceRow` | `label`, `value`, `highlight` | 28rpx/500 label and 28rpx/500 value; highlight value is brand bold. |
| `PriceRowGroup` | children | Shared surface and radius shell for price rows. |
| `GuestCard` | `avatar`, `level`, `name`, `meta`, `intro`, `badge`, `inviter`, `inviterAvatar`, `onClick` | 340×374rpx card: avatar, level, name, metadata, intro, and inviter row. |
| `TaskCard` | `title`, `desc`, `exp`, `done`, `actionText=去完成`, `onAction` | NPC task card with type/badge area, description, EXP, and action button; disabled/done state removes the action. |
| `EmptyState` | `image`, `text=页面不在MIP星球` | Centered illustration and secondary text. |
| `Dialog` | `open`, `title`, children, `cancelText=取消`, `confirmText=确定`, `single=false`, `onCancel`, `onConfirm`, `confirmDisabled` | 640rpx wide dialog, 16rpx radius, `#333333`; iOS 34rpx title/body; hairline-separated 112rpx button row; disabled confirm `#7d90a9`. |
| `RecordPulse` | `onClick` | Concentric 176/152/128rpx brand pulse with mic icon; `#fff7b8` → `#feeb5d` → brand. |
| `RoundIconButton` | `type=check/close`, `onClick` | 80rpx circle; check `#18e779`, close `#ff4d5e`; 32rpx white glyph. |
| `TimerText` | `value=00:00:00` | 96rpx/700 SF Pro Text, brand, tabular numerals. |
| `AttendPill` | `count=45`, `label=参加`, `avatars`, `variant=dark/yellow`, `onClick` | 232×56rpx pill, up to three 48rpx avatars with 2rpx white ring and 15rpx step; 24rpx/600 count. Dark is `#242424`; yellow is brand. |
| `ActivityCard` | `cover`, `tags`, `title`, `date`, `location`, `attendees=45`, `label=参加`, `avatars`, `onShare` | 702×476rpx, 16rpx radius; 298rpx cover, 40rpx tag chips, attendee pill, title/date/location, share circle. |
| `OpportunityCard` | `image`, `title`, `value`, `region`, `seeking`, `referrals=45`, `label=引荐`, `avatars`, `onClick` | 702×352rpx, 16rpx radius; 240×320rpx image and three brand-icon rows plus yellow attendee pill. |
| `ActionSheet` | `open`, `title`, `options`, `activeIndex=-1`, `cancelText=取消`, `confirmText=完成`, `onCancel`, `onConfirm`, children | Half sheet, translucent `#333333` + blur; 112rpx title and option rows with hairlines; 216×80rpx cancel (`white 10%`) and complete (`#07c160`) buttons. |

## Baked-card rules

### `LevelBanner`

- Size: 702×160rpx; top radius 32rpx; clip with `overflow: hidden`.
- Base: brand yellow plus `/assets/mip/level-banner-deco@3x.png`, absolute and
  `width: 702rpx; height: 160rpx`.
- Text/controls are code layers:
  - level text at left 28rpx, top 18rpx, 32rpx/600 on-brand.
  - `{current} I {target}` at left 28rpx, top 88rpx, 20rpx/600 on-brand.
  - 玩家等级 at left 582rpx, top 24rpx, 20rpx/400 on-brand.
  - progress slot at left 24rpx, top 120rpx: 300×12rpx, radius 100, `#4d4400`.
  - progress fill at left 28rpx, top 124rpx: 4rpx tall brand. Width is
    `fillPx` in design px, otherwise `4rpx + 292rpx * min(1, current/target)`.
- Do not accept a `deco` prop and do not reconstruct the three-source decorative
  cluster.

### `CooperationCard`

- Size: 702×400rpx; radius 32rpx; clip with `overflow: hidden`.
- Choose the exact baked image for `variant`; use its background color only as
  the pre-load垫底色.
- Image is a square source scaled to the full card and positioned behind all
  dynamic layers.
- Bottom strips are code layers: top strip at 240rpx, bottom strip at 320rpx;
  each is 80rpx tall, full width, `#202020`, 24rpx horizontal padding, and has
  the matching outer card radius.
- Strip anatomy: 32rpx brand `IconBadge` + label, value right-aligned at
  24rpx from the right, 24rpx/500 primary text.
- Name sits at left 24rpx, top 192rpx, 24rpx/600 and uppercase. CJK uses
  PingFang; Latin/digits use Baloo or Baloo 2 at weight 400.
- Dynamic `name`, `goal`, and `referral` override the defaults; omit a strip if
  its value is absent.

| Variant | Image | Fallback bg | Name color | Default name |
|---|---|---|---|---|
| `dogplaner` | `/assets/mip/coop-card-dogplaner@3x.png` | `#7b00ff` | `#f2e5ff` | 狗策划 DOGPLANER |
| `upstart` | `/assets/mip/coop-card-upstart@3x.png` | `#7a2900` | `#fadab3` | 暴发户 UPSTART |
| `design-slave` | `/assets/mip/coop-card-design-slave@3x.png` | `#04a44f` | `#e5fff1` | 死美工 Design Slave |
| `pimp` | `/assets/mip/coop-card-pimp@3x.png` | `#df07a9` | `#ffe5f9` | 皮条客 pimp |
| `business-man` | `/assets/mip/coop-card-business-man@3x.png` | `#ff5500` | `#ffeee5` | 生意佬 business man |
| `old-nanny` | `/assets/mip/coop-card-old-nanny@3x.png` | `#1a71ff` | `#e5efff` | 老保姆 old nanny |

### Other image assets

- Runtime images use `/assets/mip/<filename>@3x.png`; keep the copied filename
  unchanged so audits can trace it to this skill.
- Baked images are rectangular; a card's container performs radius clipping.
- `cover`, `avatar`, `image`, and `EmptyState` images are not part of this
  skill's baked bundle. Use the page's already-exported assets or a project
  resource, and preserve the source aspect/clip.

## Icon contract

`mip-icon` properties:

```text
name  String  required; must exist in assets/wechat/mip-icon/icons.js
size  Number  optional; design px, converted to rpx
color String  optional; default #ffffff; ignored by multicolor icons
```

Render as a data-URI SVG in `<image mode="aspectFit">`. If `size` is omitted,
use the registry's intrinsic width/height and convert both to rpx. Unknown
names must warn in development and render nothing, matching `Icon.jsx`.
