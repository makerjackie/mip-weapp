#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  printf 'mip-design-system SOT check failed: %s\n' "$1" >&2
  exit 1
}

required=(
  "SKILL.md"
  "references/DESIGN.md"
  "references/wechat-component-contracts.md"
  "assets/react-source/index.js"
  "assets/react-source/Icon.jsx"
  "assets/react-source/icons.js"
  "assets/react-source/chrome.jsx"
  "assets/react-source/primitives.jsx"
  "assets/react-source/business.jsx"
  "assets/react-source/README.md"
  "assets/react-source/tools/gen-baked-assets.mjs"
  "assets/react-source/tools/icon-names.json"
  "assets/react-source/tools/icons-index.json"
  "assets/wechat/tokens.wxss"
  "assets/wechat/mip-icon/index.js"
  "assets/wechat/mip-icon/index.json"
  "assets/wechat/mip-icon/index.wxml"
  "assets/wechat/mip-icon/index.wxss"
  "assets/wechat/mip-icon/package.json"
  "assets/wechat/mip-icon/icons.js"
  "assets/MANIFEST.md"
  "assets/MANIFEST.sha256"
)

for file in "${required[@]}"; do
  [[ -f "$file" ]] || fail "missing $file"
done

variants=(dogplaner upstart design-slave pimp business-man old-nanny)
for variant in "${variants[@]}"; do
  for scale in 2x 3x; do
    file="assets/wechat/baked/coop-card-${variant}@${scale}.png"
    [[ -f "$file" ]] || fail "missing baked asset $file"
  done
done

for scale in 2x 3x; do
  file="assets/wechat/baked/level-banner-deco@${scale}.png"
  [[ -f "$file" ]] || fail "missing baked asset $file"
done

asset_count="$(find assets/wechat/baked -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
[[ "$asset_count" == "14" ]] || fail "expected 14 baked PNGs, found $asset_count"

if grep -RInE 'TODO:|FIXME|TBD:' \
    SKILL.md \
    references/wechat-component-contracts.md \
    assets/wechat/tokens.wxss \
    assets/wechat/mip-icon/index.js \
    assets/MANIFEST.md >/dev/null; then
  fail "unfinished marker found"
fi

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c assets/MANIFEST.sha256 >/dev/null || fail "manifest checksum mismatch"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c assets/MANIFEST.sha256 >/dev/null || fail "manifest checksum mismatch"
else
  fail "no SHA-256 command found"
fi

if command -v node >/dev/null 2>&1; then
  node --check assets/wechat/mip-icon/icons.js
  node --check assets/wechat/mip-icon/index.js
  node - <<'NODE'
const { ICONS } = require("./assets/wechat/mip-icon/icons.js");
const count = Object.keys(ICONS).length;
if (count !== 451) {
  throw new Error(`expected 451 icons, found ${count}`);
}
for (const name of ["search-big-left-1", "star-favorite-3", "target", "cup"]) {
  if (!ICONS[name]) {
    throw new Error(`missing required icon: ${name}`);
  }
}
NODE
else
  fail "node is required to validate the icon registry and component JS"
fi

VALIDATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py"
if [[ -f "$VALIDATOR" ]] && python3 -c 'import yaml' >/dev/null 2>&1; then
  python3 "$VALIDATOR" "$ROOT"
elif command -v ruby >/dev/null 2>&1; then
  ruby -e '
    require "yaml"
    frontmatter = YAML.load_file("SKILL.md")
    name = frontmatter.fetch("name")
    description = frontmatter.fetch("description")
    raise "invalid skill name" unless name.match?(/\A[a-z0-9-]+\z/)
    raise "empty description" if description.strip.empty?
    puts "skill frontmatter valid: #{frontmatter.dig("metadata", "version")}"
  '
else
  fail "cannot validate frontmatter: install PyYAML or Ruby"
fi

echo "mip-design-system SOT check passed"
