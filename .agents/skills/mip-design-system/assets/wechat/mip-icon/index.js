const { ICONS } = require("./icons.js");

function iconSize(icon, size) {
  const n = Number(size) || 0;
  if (n > 0) {
    return { width: n, height: n, css: `${n * 2}rpx` };
  }
  const width = Number(icon.w) || Number(icon.h) || 16;
  const height = Number(icon.h) || Number(icon.w) || 16;
  return { width, height, css: `${width * 2}rpx ${height * 2}rpx` };
}

function svgSource(icon, color) {
  const size = iconSize(icon, 0);
  const strokeColor = icon.mono ? color : undefined;
  let body = icon.body || "";
  if (icon.mono) {
    body = body.replace(/currentColor/g, color);
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.vb}"`,
    `width="${size.width}" height="${size.height}" fill="${icon.mono ? color : "none"}">`,
    body,
    "</svg>",
  ].join(" ");
}

Component({
  options: {
    virtualHost: false,
  },
  properties: {
    name: { type: String, value: "" },
    size: { type: Number, value: 0 },
    color: { type: String, value: "#ffffff" },
  },
  data: {
    src: "",
    style: "",
  },
  lifetimes: {
    attached() {
      this.render();
    },
  },
  observers: {
    "name, size, color": function () {
      this.render();
    },
  },
  methods: {
    render() {
      const { name, size, color } = this.data;
      const icon = ICONS[name];
      if (!icon) {
        console.warn(`[mip-icon] unknown icon: ${name}`);
        this.setData({ src: "", style: "" });
        return;
      }

      const box = iconSize(icon, size);
      const svg = svgSource(icon, color || "#ffffff");
      // encodeURIComponent is required because icon paths contain quotes and
      // whitespace; WeChat image accepts a UTF-8 SVG data URI.
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      this.setData({
        src,
        style: `width:${box.css.split(" ")[0]};height:${box.css.split(" ")[1] || box.css.split(" ")[0]};`,
      });
    },
  },
});
