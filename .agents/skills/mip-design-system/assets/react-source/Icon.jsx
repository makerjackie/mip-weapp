/**
 * Icon — MIP 图标组件（数据来自 figma-restored/icons/，见 icons.js）。
 * 用法：<Icon name="draft-line" size={16} className="text-brand" />
 * 多色插画图标（mono=false）忽略 color，保留原色。
 */
import React from "react";
import { ICONS } from "./icons.js";

export function Icon({ name, size, color, className = "", style, title, ...rest }) {
  const ic = ICONS[name];
  if (!ic) {
    if (process.env.NODE_ENV !== "production") console.warn(`[Icon] 未知图标: ${name}`);
    return null;
  }
  const s = size || { width: ic.w, height: ic.h };
  return (
    <svg
      viewBox={ic.vb}
      width={s.width || s}
      height={s.height || s}
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.125em", color, ...style }}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      dangerouslySetInnerHTML={{ __html: ic.body }}
      {...rest}
    />
  );
}

export default Icon;
