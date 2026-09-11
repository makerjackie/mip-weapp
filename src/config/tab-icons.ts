/**
 * MIP 底部 TabBar 图标 — 逐字移植自 mip-design-system skill SOT(snapshot 2026-09-09.2)。
 *  - 图标形体(TAB_ICON_PARTS 的 vb/mono/body):assets/wechat/mip-icon/icons.js,只收录 TabBar 用到的子集;
 *  - 组合几何(TAB_ICON_COMPOSITIONS 的每件 x/y/w/h,28×28 盒内偏移):assets/react-source/chrome.jsx TAB_ICON_NODES;
 *  - 合同:references/wechat-component-contracts.md `TabBar` — 图标盒 56rpx、激活 brand #fcdf03、未激活 #b3b3b3。
 *  形体与几何必须跟 SOT 逐字同步,不得手改路径数据;新增页面图标时从 SOT 追加并保留本文件命名。
 */

interface TabIconPart {
  vb: string
  mono: boolean
  body: string
}

interface TabIconNode {
  name: string
  x: number
  y: number
  w: number
  h: number
}

const TAB_ICON_PARTS: Record<string, TabIconPart> = {
  'smileys-13-12': { vb: '0 0 24 24', mono: false, body: '<path d="M19.7782 4.22183C24.0739 8.5176 24.0739 15.4824 19.7782 19.7782C15.4824 24.0739 8.51758 24.0739 4.22183 19.7782C-0.0739431 15.4824 -0.0739431 8.51758 4.22183 4.22183C8.5176 -0.0739433 15.4824 -0.0739433 19.7782 4.22183Z" fill="#202020" stroke="#B3B3B3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'smileys-13-12-2': { vb: '0 0 11 11', mono: true, body: '<path fill="none" d="M1.01092 8.61162L2.15092 2.92962C2.18976 2.73604 2.28503 2.5583 2.42472 2.41878C2.56442 2.27926 2.74229 2.18421 2.93592 2.14562L8.61792 1.00962C8.69857 0.993566 8.78195 0.997652 8.86065 1.02152C8.93934 1.04538 9.01094 1.08829 9.06909 1.14645C9.12725 1.2046 9.17016 1.2762 9.19402 1.3549C9.21789 1.4336 9.22197 1.51697 9.20592 1.59762L8.06992 7.27962C8.03115 7.47307 7.93603 7.65072 7.79652 7.79023C7.65702 7.92973 7.47936 8.02485 7.28592 8.06362L1.60392 9.20462C1.52241 9.22194 1.43787 9.21861 1.35797 9.19495C1.27808 9.17128 1.20537 9.12802 1.14645 9.06909C1.08753 9.01017 1.04426 8.93746 1.0206 8.85757C0.996927 8.77767 0.9936 8.69313 1.01092 8.61162Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'smileys-13-2-2': { vb: '0 0 24 24', mono: true, body: '<path fill="none" d="M19.7782 4.22183C24.0739 8.5176 24.0739 15.4824 19.7782 19.7782C15.4824 24.0739 8.51758 24.0739 4.22183 19.7782C-0.0739432 15.4824 -0.0739432 8.51758 4.22183 4.22183C8.5176 -0.0739433 15.4824 -0.0739433 19.7782 4.22183Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-note-outline': { vb: '0 0 23 23', mono: false, body: '<path d="M5.66667 1H17.3333C18.571 1 19.758 1.49167 20.6332 2.36683C21.5083 3.242 22 4.42899 22 5.66667V15.4003C22 16.638 21.5083 17.825 20.6332 18.7002L18.7002 20.6332C17.825 21.5083 16.638 22 15.4003 22H5.66667C4.42899 22 3.242 21.5083 2.36683 20.6332C1.49167 19.758 1 18.571 1 17.3333V5.66667C1 4.42899 1.49167 3.242 2.36683 2.36683C3.242 1.49167 4.42899 1 5.66667 1Z" fill="#202020" stroke="#B3B3B3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-note-fold': { vb: '0 0 9 9', mono: true, body: '<path fill="none" d="M8 1H3.33333C2.71449 1 2.121 1.24583 1.68342 1.68342C1.24583 2.121 1 2.71449 1 3.33333V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-note-line': { vb: '0 0 12 2', mono: true, body: '<path fill="none" d="M1 1H10.3333" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'document-note-paper-angle-right-3': { vb: '0 0 23 23', mono: true, body: '<path fill="none" d="M5.66667 1H17.3333C18.571 1 19.758 1.49167 20.6332 2.36683C21.5083 3.242 22 4.42899 22 5.66667V15.4003C22 16.638 21.5083 17.825 20.6332 18.7002L18.7002 20.6332C17.825 21.5083 16.638 22 15.4003 22H5.66667C4.42899 22 3.242 21.5083 2.36683 20.6332C1.49167 19.758 1 18.571 1 17.3333V5.66667C1 4.42899 1.49167 3.242 2.36683 2.36683C3.242 1.49167 4.42899 1 5.66667 1Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-bag-body': { vb: '0 0 23 19', mono: false, body: '<path d="M4.71233 1H18.2877C19.2722 1 20.2165 1.39112 20.9127 2.08732C21.6089 2.78352 22 3.72776 22 4.71233V13.8333C22 14.7616 21.6313 15.6518 20.9749 16.3082C20.3185 16.9646 19.4283 17.3333 18.5 17.3333H4.5C3.57174 17.3333 2.6815 16.9646 2.02513 16.3082C1.36875 15.6518 1 14.7616 1 13.8333V4.71233C1 3.72776 1.39112 2.78352 2.08732 2.08732C2.78351 1.39112 3.72776 1 4.71233 1Z" fill="#202020" stroke="#B3B3B3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-bag-band': { vb: '0 0 23 5', mono: true, body: '<path fill="none" d="M22.0002 1C16.2012 4.11111 6.79917 4.11111 1.00018 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-bag-handle': { vb: '0 0 12 9', mono: true, body: '<path fill="none" d="M1 8V3.33333C1 2.71449 1.24583 2.121 1.68342 1.68342C2.121 1.24583 2.71449 1 3.33333 1H8C8.61884 1 9.21233 1.24583 9.64992 1.68342C10.0875 2.121 10.3333 2.71449 10.3333 3.33333V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'tab-bag-dash': { vb: '0 0 6 2', mono: true, body: '<path fill="none" d="M4.5 1H1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'satchel-bag-3': { vb: '0 0 23 19', mono: true, body: '<path fill="none" d="M4.71233 1H18.2877C19.2722 1 20.2165 1.39112 20.9127 2.08732C21.6089 2.78352 22 3.72776 22 4.71233V13.8333C22 14.7616 21.6313 15.6518 20.9749 16.3082C20.3185 16.9646 19.4283 17.3333 18.5 17.3333H4.5C3.57174 17.3333 2.6815 16.9646 2.02513 16.3082C1.36875 15.6518 1 14.7616 1 13.8333V4.71233C1 3.72776 1.39112 2.78352 2.08732 2.08732C2.78351 1.39112 3.72776 1 4.71233 1Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'smileys-13-11-2': { vb: '0 0 24 24', mono: true, body: '<path fill="none" d="M19.7782 4.22183C24.0739 8.5176 24.0739 15.4824 19.7782 19.7782C15.4824 24.0739 8.51758 24.0739 4.22183 19.7782C-0.0739432 15.4824 -0.0739432 8.51758 4.22183 4.22183C8.5176 -0.0739433 15.4824 -0.0739433 19.7782 4.22183Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  'smileys-13-11': { vb: '0 0 16 8', mono: true, body: '<path d="M15.8284 1.09491C10.7278 -0.364971 5.28402 -0.364971 0.183432 1.09491C0.0710059 1.12288 0 1.22356 0 1.32984C0 1.45849 0.118343 1.56476 0.254438 1.56476L7.02959 1.56476V1.58154C7.02959 3.36025 6.07692 4.932 4.63905 5.8717C4.45562 5.98916 4.4497 6.24646 4.62722 6.36952L6.13609 7.42108C7.2426 8.19297 8.7574 8.19297 9.8639 7.42108L11.3728 6.36952C11.5503 6.24646 11.5503 5.98916 11.3609 5.8717C9.91716 4.932 8.97041 3.36025 8.97041 1.58154V1.56476L15.7456 1.56476C15.8817 1.56476 15.9941 1.45849 16 1.32984C16 1.22356 15.929 1.12288 15.8166 1.09491"/>' },
}

const TAB_ICON_COMPOSITIONS: Record<string, { off: TabIconNode[], on: TabIconNode[] }> = {
  发现: {
    off: [
      { name: 'smileys-13-12', x: 3, y: 3, w: 22, h: 22 },
      { name: 'smileys-13-12-2', x: 10, y: 10, w: 8.2, h: 8.2 },
    ],
    on: [
      { name: 'smileys-13-2-2', x: 3, y: 3, w: 22, h: 22 },
      { name: 'smileys-13-12-2', x: 10, y: 10, w: 8.2, h: 8.2 },
    ],
  },
  活动: {
    off: [
      { name: 'tab-note-outline', x: 3.5, y: 3.5, w: 21, h: 21 },
      { name: 'tab-note-fold', x: 17.5, y: 17.5, w: 7, h: 7 },
      { name: 'tab-note-line', x: 8.3, y: 8.3, w: 11.3, h: 2 },
      { name: 'tab-note-line', x: 8.3, y: 13, w: 11.3, h: 2 },
    ],
    on: [
      { name: 'document-note-paper-angle-right-3', x: 3.5, y: 3.5, w: 21, h: 21 },
      { name: 'tab-note-fold', x: 17.5, y: 17.5, w: 7, h: 7 },
      { name: 'tab-note-line', x: 8.3, y: 8.3, w: 11.3, h: 2 },
      { name: 'tab-note-line', x: 8.3, y: 13, w: 11.3, h: 2 },
    ],
  },
  机会: {
    off: [
      { name: 'tab-bag-body', x: 3.5, y: 8.2, w: 21, h: 16.3 },
      { name: 'tab-bag-band', x: 3.5, y: 12.8, w: 21, h: 2.3 },
      { name: 'tab-bag-handle', x: 9.3, y: 3.5, w: 9.3, h: 7 },
      { name: 'tab-bag-dash', x: 11.3, y: 18.8, w: 5.5, h: 2 },
    ],
    on: [
      { name: 'satchel-bag-3', x: 3.5, y: 8.2, w: 21, h: 16.3 },
      { name: 'tab-bag-band', x: 3.5, y: 12.8, w: 21, h: 2.3 },
      { name: 'tab-bag-handle', x: 9.3, y: 3.5, w: 9.3, h: 7 },
      { name: 'tab-bag-dash', x: 11.3, y: 18.8, w: 5.5, h: 2 },
    ],
  },
  我的: {
    off: [
      { name: 'smileys-13-11-2', x: 3, y: 3, w: 22, h: 22 },
      { name: 'smileys-13-11', x: 6, y: 10, w: 16, h: 8 },
    ],
    on: [
      { name: 'smileys-13-11-2', x: 3, y: 3, w: 22, h: 22 },
      { name: 'smileys-13-11', x: 6, y: 10, w: 16, h: 8 },
    ],
  },
}

const TAB_ICON_BOX = 28
const ACTIVE_COLOR = '#fcdf03'
const INACTIVE_COLOR = '#b3b3b3'

function svgSource(nodes: TabIconNode[], color: string) {
  const layers = nodes.map((node) => {
    const part = TAB_ICON_PARTS[node.name]
    if (!part) {
      return ''
    }
    const body = part.mono ? part.body.replaceAll('currentColor', color) : part.body
    return [
      `<svg x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" viewBox="${part.vb}"`,
      `fill="${part.mono ? color : 'none'}">`,
      body,
      '</svg>',
    ].join(' ')
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TAB_ICON_BOX} ${TAB_ICON_BOX}"`,
    `width="${TAB_ICON_BOX}" height="${TAB_ICON_BOX}" fill="none">`,
    ...layers,
    '</svg>',
  ].join(' ')
}

function iconUri(label: string, state: 'off' | 'on', color: string) {
  const composition = TAB_ICON_COMPOSITIONS[label]
  if (!composition) {
    return ''
  }
  // encodeURIComponent is required because icon paths contain quotes and
  // whitespace; WeChat image accepts a UTF-8 SVG data URI.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSource(composition[state], color))}`
}

/** 每个底部 Tab 的设计稿图标,按未激活(off)/激活(on)预渲染为 SVG data URI。 */
export const tabIconSources = Object.fromEntries(
  Object.keys(TAB_ICON_COMPOSITIONS).map(label => [label, {
    iconOff: iconUri(label, 'off', INACTIVE_COLOR),
    iconOn: iconUri(label, 'on', ACTIVE_COLOR),
  }]),
) as Record<string, { iconOff: string, iconOn: string }>
