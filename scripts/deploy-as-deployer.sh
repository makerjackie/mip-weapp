#!/usr/bin/env bash
# 以 CAM 子用户 mip-deployer 身份运行部署命令（MIW-111 M2 专用通道）。
#
# 密钥存放：仓库根 .env.secrets.local 的 TENCENTCLOUD_SECRETID/SECRETKEY
# （不自动加载；只有本脚本显式激活）。日常部署仍走环境 API Key / Device Flow。
#
# 用法：
#   ./scripts/deploy-as-deployer.sh node scripts/ops.mjs --target=test
#   ./scripts/deploy-as-deployer.sh node scripts/deploy-functions.mjs --confirm-...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$ROOT/.env.secrets.local"

SID=$(sed -n 's/^TENCENTCLOUD_SECRETID=//p' "$SECRETS" | tail -1 | tr -d '\r')
SKEY=$(sed -n 's/^TENCENTCLOUD_SECRETKEY=//p' "$SECRETS" | tail -1 | tr -d '\r')
if [ -z "$SID" ] || [ -z "$SKEY" ]; then
  echo "[deploy-as-deployer] .env.secrets.local 中未找到 TENCENTCLOUD_SECRETID/SECRETKEY" >&2
  exit 1
fi

# local 模式会让 MCP 包装器剥掉 CLOUDBASE_API_KEY，
# MCP 随即回退到下面的 CAM 密钥身份（mip-deployer）。
export CLOUDBASE_AUTH_MODE=local
export TENCENTCLOUD_SECRETID="$SID"
export TENCENTCLOUD_SECRETKEY="$SKEY"
unset CLOUDBASE_API_KEY

echo "[deploy-as-deployer] 以 mip-deployer 身份运行：$*"
exec "$@"
