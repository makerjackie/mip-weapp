# UI fidelity harness — operating notes

Three layers gate UI fidelity against the `figma-restored` references and the
`mip-design-system` skill (SOT). All numbers below were re-baselined on
2026-09-09 after the icon migration; **any pixel number recorded before that is
invalid** (the proxy could not render components, text interpolations, or inline
styles correctly — see "Renderer fixes" below).

## How to run

```sh
node scripts/ui-fidelity/audit-tokens.mjs      # Layer 1 — static token conformance
node scripts/ui-fidelity/audit-contracts.mjs   # Layer 2 — icons, baked assets, component contracts
node scripts/ui-fidelity/audit-screens.mjs     # static per-route conformance
node scripts/ui-fidelity/score-pixel.mjs       # Layer 3 — headless pixel diff, per screen
node scripts/ui-fidelity/score-pixel.mjs --only 'profile-我的-a'
```

Layer 3 needs a fixture per screen in `config/ui-fidelity-screens.json`
(`data`, optional `crop`, reference page path). Screens without fixtures are
reported as unscored — fixtures, not the renderer, are the remaining bulk work.

## Baseline (2026-09-09, after icon migration)

| Layer | Metric | Score |
| ----- | ------ | ----- |
| 1 tokens | color / theme / geometry | 100% / 100% / 99.91% → **99.99%**, 0 hard-rule breaches |
| 2 contracts | registry-valid `mip-icon` of all icon usages | **65.08%** (123/189; 66 foreign `t-icon`, all SOT gaps or dynamic) |
| 2 contracts | baked `/assets/mip/*` refs | **100%** (7 refs, 0 missing, 0 unused) |
| 2 contracts | CooperationCard / LevelBanner checks | **100%**; component coverage 3/18 (informational) |
| 2 contracts | composite | **88.36%** (pass mark 92) |
| screens | routes ≥92% static conformance | **47/70** (mean 94.47%) |
| 3 pixel | scored screens ≥92% | **1/1** — `profile-我的-a` **93.7%**; ~97 unscored |

## Renderer (Layer 3 proxy)

`score-pixel.mjs` transpiles each page's WXML + compiled WXSS into standalone
HTML (`lib/wxml.mjs`) and screenshots it and the `figma-restored` reference
through the same headless Chromium (375×812 @2x → 750×1624, pixelmatch
threshold 0.1, per-screen crop). It is a **renderer, not a runtime**: no WXS,
no lifecycle, no observers.

Renderer fixes now baked in (each one invalidated all earlier pixel numbers):

- Custom components resolve through `usingComponents` (app + page json) and are
  inlined recursively with their own styles.
- Kebab-case attributes map to camelCase component props, mirroring WeChat.
- `ctx.componentData` supplies observer-built render data the proxy cannot
  compute (e.g. `cooperation-role-card`'s `view` from `model.ts`, loaded via
  `lib/component-models.mjs` — TS evaluated with `node:module`
  `stripTypeScriptTypes`, no bundler needed).
- The tag tokenizer tolerates `>` and `<` inside quoted attribute values
  (previously shredded `width="{{fillPx}}"`-style expressions).
- Multi-interpolation strings render (`{{current}} I {{target}}`); the
  whole-expression fast path only fires when the value is exactly one `{{…}}`.
- Inline `style` is emitted once per node, with `rpx→px` conversion applied to
  declared styles, component wrapper styles, and class attributes.
- `<wxs>` blocks are dropped (mapped to nothing).
- `mip-icon` is emulated by `lib/mip-icons.mjs`: same data-URI SVG path as the
  component, intrinsic-size fallback, mono `currentColor` substitution, and
  `var(--color-*)` resolution through the component's own `colors.ts` mirror.

## Crop calibration (per-screen method, proven on profile)

The reference pages carry their own chrome: `body` padding 24px, a
`.page-label`, and a `.figma-page` frame whose top lands 21 CSS px into the raw
@2x screenshot; the reference frame includes an 88px status+nav band. For
`profile-我的-a` the content therefore starts at raw y = 21 + 88 = 109 CSS px →
`crop.topPx: 109`, `crop.bottomPx: 90` (tab bar). For a new screen: open the
reference HTML, read the frame offsets, scan the raw reference screenshot rows
for the first content edge, and set `crop` so both images compare the same
band — vertical misalignment of even 20px destroys the score (it cost 31px
before decoding). Nested absolute offsets inside the reference HTML chain
(parent-relative), so reconstructing geometry by hand from `left/top` values
alone misleads; measure the rendered screenshot instead.

## Icon migration record (2026-09-09)

- 125 static `t-icon` usages migrated to `mip-icon` via an 18-name map
  (`.tmp/migrate-icons.cjs`): `chevron-right→chevron-down-1`,
  `chevron-down→chevron-down-1-15`, `check→check`, `calendar→calendar-schedule`,
  `calendar-event→calendar-event-1`, `location→icon-map-pin-line`,
  `search→search-big-left-1`, `share→share-circle`, `filter→filter-2`,
  `file→file-text`, `file-copy→file-copy`, `star-filled→star-favorite-3`,
  `image→image`, `microphone→mic-ai-fill-1`, `add→icon-plus-fill`,
  `close→close`, `time→time`, `gift→gift`.
  **Gotcha:** `chevron-down-1` is a *right*-pointing chevron (3×6 glyph) and
  `chevron-down-1-15` is the down-pointing one (8×4) — the Figma export names
  lie. Sizes converted `NNrpx → {{NN/2}}` design px, `NNpx → {{NN}}`.
- `size` is a Number (design px, ×2 → rpx); `color` stays a `var(--color-*)`
  token in templates. Data-URI SVGs cannot see page CSS variables, so the
  component resolves tokens to hex through `src/components/mip-icon/colors.ts`,
  a mirror of the `@theme` block pinned against drift by
  `tests/mip-design-tokens.test.ts`. `assertSemanticIconColors`
  (`scripts/lib/ui-contracts.mjs`) now forbids hex `color` on both `t-icon` and
  `mip-icon`.
- Registry subset to the 20 referenced names: `icons.ts` 417 KB → 13 KB
  (dist component 28 KB total), keeping the main package inside the
  `mainNonNpmBytes` 1.5 MiB budget. The subset discipline (no dead glyphs, no
  missing glyphs, size guard) is pinned by the same test file.
- 66 foreign `t-icon` usages remain, in two classes:
  1. **Dynamic names** (custom-tab-bar `{{item.icon}}`, badge `iconName`,
     open/close ternaries) — need a runtime name source; stay `t-icon` for now.
  2. **SOT gaps** — `user-avatar`(11), `heart`(6), `usergroup`(5), `user`(3),
     `heart-filled`(3), `scan`, `pending`, `info-circle`, `chat`, `certificate`
     (×2 each) and ~20 singletons have **no glyph in the design system**: the
     skill bundle's `icons.js` carries the same 451 icons as the vendored
     registry. The registry's only hearts/stars are multicolor with baked fills
     (`icon-heart-fill` #FF2238, `heart-rounded-1-1` red), so they cannot honor
     `color` and must not substitute. The skill forbids approximate icons from
     other libraries — these stay `t-icon` as reported deviations until the
     missing glyphs are exported from Figma (`figma-bridge` →
     `tools/gen-icons.mjs`) or added by the designer.

## Baked asset provenance

- `coop-card-<variant>@3x.png` ×6: vendor drops from the skill bundle
  (`assets/wechat/baked/`). `@2x` copies deleted — the project has no
  low-density fallback rule (skill: prefer `@3x` only).
- `level-banner-deco@3x.png`: **rebaked from reference screenshot pixels**, not
  the original Figma export. Source: the `profile-我的-a` reference @2x
  screenshot, banner box x 24..726, y 432..592; the 玩家等级+chevron text rect
  (banner-relative x 578..700, y 12..56) inpainted by vertical linear
  interpolation (text stays a live layer per the component contract); upscaled
  1.5× bilinear to 1053×240. Script preserved at `.tmp/rebake-deco.cjs`.
  A 3-layer composite reconstruction from the reference HTML was attempted
  first and abandoned — nested absolute positioning misreads easily; pixel
  rebake is the reliable path. The unused `@2x` variant was deleted.
- `src/assets/figma/profile/level-art.png` is kept (mip-growth screen blend).
- `src/assets/figma/cooperation/*.webp` ×6 deleted — superseded by the baked
  coop cards, zero references.

## Per-screen playbook (remaining ~97 screens)

1. Find the reference page under `~/project/ame-project/mip-minip-dev/figma-restored/pages`.
2. Decode the frame chrome → set `crop` (method above).
3. Write the fixture `data` so copy, counts and states match the reference
   (row/edge scans of the raw reference screenshot resolve geometry questions).
4. `score-pixel.mjs --only <screen>`; iterate WXSS/fixture until ≥92%.
5. Keep Layer 1/2 green: tokens only, registry-valid icons, contract audits.
