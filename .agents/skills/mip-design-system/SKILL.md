---
name: mip-design-system
description: Apply the MIP WeChat miniprogram design system when implementing, restoring, or reviewing MIP UI, components, pages, colors, typography, spacing, icons, or baked card assets.
metadata:
  version: "2026-09-22.1"
  source_snapshot: "2026-09-09 15:16 worktree; base commit 889464a"
---

# MIP Design System

Source of truth: this skill directory. The copied `references/DESIGN.md`,
React/Tailwind source, icon registry, and baked PNG assets are the canonical
snapshot for MIP UI decisions. Upstream `figma-restored/` paths are provenance,
not runtime dependencies.

Owner: MIP repository maintainers.

## When this applies

- Implement or review a MIP mini-program page or component.
- Restore a MIP Figma screen to WXML/WXSS/JS.
- Choose MIP colors, typography, spacing, radius, icon names, status styles,
  card variants, or baked assets.
- Audit whether output matches `DESIGN.md` and the component source.

Do not use this skill for a product that is not MIP or for generic design work.

## Workflow

1. Read `references/DESIGN.md` for the relevant tokens, layout, typography, and
   state rules before choosing any value.
2. Find the closest component in `assets/react-source/` and
   `references/wechat-component-contracts.md`. Reuse the existing contract
   before inventing a new component or style.
3. Convert the React/Tailwind reference into WXML, WXSS, and JavaScript. Do not
   import React, Tailwind, demo bundles, or browser-only code into the target.
4. Use `assets/wechat/tokens.wxss` variables and classes. Convert design px to
   rpx at `1px = 2rpx`; use `1rpx` for design hairlines at or below `0.5px`.
5. Use `<mip-icon>` and a valid name from `assets/wechat/mip-icon/icons.js`.
   Never use an approximate icon from another library.
6. Copy baked PNGs from `assets/wechat/baked/` to the app's `/assets/mip/`
   resource directory. Prefer `@3x` and scale with the card; use `@2x` only when
   the project has a specific low-density fallback rule.
7. Keep dynamic text, controls, progress bars, and interactive layers outside
   baked images. Baked images contain fixed decoration only.
8. Validate all colors, sizes, variants, states, image paths, and event names
   against the copied source. If a required SOT file is missing or corrupted,
   stop and report the mismatch; do not guess.

## Hard rules

- Page background is `#080808`; normal card/row surface is `#202020`.
- Brand yellow is `#fcdf03`; do not introduce an unregistered yellow.
- Yellow actions and activated chips use a `#080808` keyline.
- Content width is 702rpx with 24rpx side margins on a 750rpx page.
- Chinese text uses PingFang SC; timer/tabular numerals use SF Pro Text with
  `tabular-nums`; activity display numerals use D-DIN Exp with the documented
  fallback stack.
- Icons are monochrome through `color` unless the registry marks them multicolor.
- `CooperationCard` has exactly the six variants documented in
  `references/wechat-component-contracts.md`.
- `LevelBanner` has no decoration prop or child decoration layer; it uses
  `level-banner-deco@3x.png` plus code-level text and progress controls.
- Do not use local image paths in WXSS `background-image`; use `<image>` for
  packaged MIP assets.

## Required checks

Run `./scripts/check-sot.sh` after creating or changing this skill. For code
using this system, verify before completion:

1. Every core color and spacing value resolves to a MIP token.
2. Every component matches the source contract, including props, variants, and
   event names.
3. Every icon name exists in the icon registry.
4. Every baked asset path exists in the target mini-program project.
5. Output contains no React imports, Tailwind directives, demo bundle paths, or
   upstream `figma-restored/` runtime paths.

## SOT update policy

When design or component source changes, update the skill copy first, bump the
`metadata.version`, refresh `assets/MANIFEST.md` and `assets/MANIFEST.sha256`,
and run `./scripts/check-sot.sh`. Skill changes are advisory controls; if a rule
must be enforced in CI, call the same check script from the repository pipeline.

## 2026-09-22 notification icon increment

`bell-notification` is the exact 24px SVG from upstream `cb5956b` (introduced by `6086f3e`), frame
`3364:17173`, node `3364:16248`. The unread dot is 8px, `#ff1313`,
without a number. This supplements the original 451-icon snapshot.
