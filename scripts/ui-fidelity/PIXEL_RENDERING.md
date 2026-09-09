# Layer 3 — per-screen pixel scoring: what gates it

Layers 1 and 2 (`audit-tokens.mjs`, `audit-contracts.mjs`, `audit-screens.mjs`) are
static and run anywhere. The pixel layer needs something that can actually rasterize
a mini-program screen. Nothing on this machine can do that today, and the two ways
out have different costs — this file records the decision that is still open.

Measured state (2026-09-09, branch `worktree-ui-align-design`):

| Layer       | Metric                                                                                   | Score                             |
| ----------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| 1 tokens    | literal colour conformance                                                               | 100%                              |
| 1 tokens    | `@theme`/brand var conformance                                                           | 100%                              |
| 1 tokens    | rpx type + radius scale                                                                  | 99.91%                            |
| 1 tokens    | hard-rule breaches (page bg, unregistered yellow, WXSS background-image, upstream paths) | 0                                 |
| 2 contracts | registry-valid `mip-icon` of all icon usages                                             | 0% (187/187 are TDesign `t-icon`) |
| 2 contracts | `/assets/mip/*` refs that resolve                                                        | n/a — nothing references them yet |
| 2 contracts | CooperationCard / LevelBanner contract checks                                            | 16.67% (2/12 pass)                |
| screens     | routes ≥92% conformance                                                                  | 23/70 (mean 82.49%)               |

## Blocker 1 — there is no renderer on this machine

- WeChat DevTools is **not installed** (`/Applications` has no `wechatwebdevtools.app`),
  so the repo's existing automator path (`scripts/verify-runtime.mjs` → `weapp-ide-cli`
  → `automator.screenshot()`) cannot run. It also needs a GUI login with a scanned QR,
  which cannot be scripted.
- Headless Chromium **is** available (`~/Library/Caches/ms-playwright/chromium_headless_shell-1187`,
  verified: it screenshots a 375×812 page at `--force-device-scale-factor=2` → 750×1624 px).
  It can render HTML/CSS, not WXML/WXSS.

The workable proxy: transpile each page's WXML + the _compiled_ WXSS (the Tailwind
output `pnpm build` emits) into a standalone HTML document — `view`→`div`, `text`→`span`,
`image mode`→`object-fit`, `rpx`→px at `viewport/750`, `page`→`body`, custom components
inlined recursively with their own styles namespaced — then screenshot both that and the
`figma-restored/pages/*.html` reference through the _same_ Chromium, so the diff measures
the design and not two different engines.

Cost that is not optional: **per-screen fixtures**. The reference screens carry specific
content (a named user, order rows, stats). Without feeding the same content in, the diff
measures copy differences instead of fidelity. Roughly 98 screens are mapped
(`.tmp/ui-map/screens.json`); fixtures are the bulk of the remaining work, not the renderer.

## Blocker 2 — the mip-icon registry does not cover this app

The vendored registry (`src/components/mip-icon/icons.ts`, 451 names) is the icon set
that happened to be exported from the Figma 「我的/活动/机会/勋章」 pages. The glyphs this
app actually renders are missing from it:

- `chevron-right` — **56 usages**, the most-used icon in the app; not in the registry
  (`arrow-right-s` exists, which is an arrow, not a chevron)
- `chevron-up` / `chevron-left` (registry has ~25 numbered `chevron-down-*` variants only)
- `user-avatar` (11), `usergroup` (5), `user` (3), `notification`, `grid-view`, `scan`,
  `tag`, `certificate`, `avatar`, `stop-circle`, `order`, `pending` — no equivalent
- Clean matches do exist: `check`, `close`, `time`, `image`, `search-big-left-1`,
  `icon-map-pin-line`, `icon-plus-fill`, `star-favorite-3`, `share-circle`, `filter-2`,
  `calendar-schedule`, `file-text`, `icon-heart-fill`, `mic-ai-fill-1`

The skill forbids substituting an approximate icon from another library, so a wholesale
`t-icon`→`mip-icon` sweep is not possible without new assets. Two ways in:

1. Export the missing glyphs from the Figma file through the `figma-bridge` skill
   (`figma-mcp-free` local bridge → `tools/gen-icons.mjs` regenerates the registry).
   Needs the Figma desktop app open with the plugin running — a human step.
2. Have the designer add the missing icons to the source page, then re-vendor.

## Cost check before vendoring

Two size facts that must be reconciled before either blocker is "just fixed":

- `scripts/lib/package-size-contract.mjs` budgets `mainNonNpmBytes: 1.5 MiB`
  (`tests/package-size-contract.test.ts` enforces it).
- The full icon registry is 432 KB of JS, and the 7 baked `@3x` PNGs are 1.06 MB.

Dropping both into the main package as-is is not free, and `CooperationCard` is rendered
from `pages/profile/index` (main package) as well as from member pages, so the baked PNGs
cannot simply move into `packages/member` without changing where the component lives.
Subset the registry to the names actually used (or lazy-load per subpackage) and measure
before committing.

## What is on disk but deliberately uncommitted

`src/assets/mip/*.png` (1.5 MB, all densities) and `src/components/mip-icon/*` are
vendored copies from the skill, present for the audits to run against, but **not
committed** until the placement and subsetting decision above is made — committing them
now would put unverified weight in the main package and leave 187 `t-icon` call sites
alongside an unused registry.
