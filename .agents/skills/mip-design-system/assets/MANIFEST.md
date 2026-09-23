# SOT manifest

- Skill: `mip-design-system`
- Version: `2026-09-22.1`
- Snapshot: 2026-09-09 15:16 worktree
- Base commit: `922e431f2731cbde2b70cd481fae805fba482716` (business context;
  component updates were staged but not committed at capture time)
- Runtime asset path in app projects: `/assets/mip/`

## Canonical inventory

| Skill path | Source path | Role |
|---|---|---|
| `references/DESIGN.md` | `DESIGN.md` | Design tokens, layout, type, icon, and page conventions |
| `assets/react-source/index.js` | `figma-restored/components/index.js` | Public React reference API inventory |
| `assets/react-source/Icon.jsx` | `figma-restored/components/Icon.jsx` | Icon rendering contract |
| `assets/react-source/icons.js` | `figma-restored/components/icons.js` | Canonical 452-icon registry |
| `assets/react-source/chrome.jsx` | `figma-restored/components/chrome.jsx` | System layer source of truth |
| `assets/react-source/primitives.jsx` | `figma-restored/components/primitives.jsx` | Primitive component source of truth |
| `assets/react-source/business.jsx` | `figma-restored/components/business.jsx` | Business and baked-card source of truth |
| `assets/react-source/README.md` | `figma-restored/components/README.md` | Component inventory and regeneration notes |
| `assets/react-source/tools/gen-baked-assets.mjs` | `figma-restored/tools/gen-baked-assets.mjs` | Provenance/rebuild recipe for baked decoration |
| `assets/react-source/tools/icon-names.json` | `figma-restored/tools/icon-names.json` | Manual icon-name overrides |
| `assets/react-source/tools/icons-index.json` | `figma-restored/tools/icons-index.json` | Full icon index and usage counts |
| `assets/wechat/tokens.wxss` | Generated from `DESIGN.md` | Native WXSS token/class layer |
| `assets/wechat/mip-icon/*` | Generated from `Icon.jsx` + `icons.js` | Native mini-program icon reference component |
| `assets/wechat/baked/*.png` | `figma-restored/deliverables/miniprogram/*.png` | Canonical fixed-decoration cards (14 PNG files) |

The complete checksum list is in `MANIFEST.sha256`. Run
`scripts/check-sot.sh` before publishing or after any SOT update.

## Explicit exclusions

- `demo.bundle.js` and `gallery.bundle.js` build artifacts.
- `demo.html` and `gallery.html` browser harnesses.
- `figma-restored/pages/assets/` raw source asset pool.
- Figma snapshots and page HTML.

The baked PNGs are included because the updated `CooperationCard` and
`LevelBanner` contracts require them as fixed decoration layers. The bake
generator remains as provenance; regenerating it requires the upstream asset
pool and browser toolchain.

The additional `bell-notification` SVG comes from upstream `cb5956b` (introduced by `6086f3e`),
`figma-restored/role-flows-build/build_prototype.py`, Figma node `3364:16248`.
