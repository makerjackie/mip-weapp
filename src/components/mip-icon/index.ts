import { resolveIconColor } from './colors'
import { ICONS } from './icons'

interface IconBox {
  width: number
  height: number
  css: string
}

function iconSize(icon: { w?: number, h?: number }, size: number): IconBox {
  const n = Number(size) || 0
  if (n > 0) {
    return { width: n, height: n, css: `${n * 2}rpx` }
  }
  const width = Number(icon.w) || Number(icon.h) || 16
  const height = Number(icon.h) || Number(icon.w) || 16
  return { width, height, css: `${width * 2}rpx ${height * 2}rpx` }
}

function svgSource(icon: { vb: string, w?: number, h?: number, mono?: boolean, body?: string }, color: string) {
  const size = iconSize(icon, 0)
  const body = icon.mono ? (icon.body ?? '').replace(/currentColor/g, color) : (icon.body ?? '')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.vb}"`,
    `width="${size.width}" height="${size.height}" fill="${icon.mono ? color : 'none'}">`,
    body,
    '</svg>',
  ].join(' ')
}

Component({
  options: {
    virtualHost: false,
  },
  properties: {
    // Must exist in the registry; unknown names warn and render nothing.
    name: { type: String, value: '' },
    // Design px; converted to rpx at 1px = 2rpx. Omit to use intrinsic size.
    size: { type: Number, value: 0 },
    color: { type: String, value: '#ffffff' },
  },
  data: {
    src: '',
    style: '',
  },
  lifetimes: {
    attached() {
      this.render()
    },
  },
  observers: {
    'name, size, color': function () {
      this.render()
    },
  },
  methods: {
    render() {
      const { name, size, color } = this.data as { name: string, size: number, color: string }
      const icon = ICONS[name]
      if (!icon) {
        // eslint-disable-next-line no-console -- The MIP icon contract requires a development warning.
        console.warn(`[mip-icon] unknown icon: ${name}`)
        this.setData({ src: '', style: '' })
        return
      }

      const box = iconSize(icon, size)
      const [width = '', height = width] = box.css.split(' ')
      // Templates pass var(--color-*) tokens; data-URI SVGs cannot see page CSS
      // variables, so the token is resolved to its hex mirror here (colors.ts).
      const svg = svgSource(icon, resolveIconColor(color))
      // encodeURIComponent is required because icon paths contain quotes and
      // whitespace; WeChat image accepts a UTF-8 SVG data URI.
      this.setData({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        style: `width:${width};height:${height};`,
      })
    },
  },
})
