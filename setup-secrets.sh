#!/usr/bin/env bash
# 一键把签名密钥写进三个仓库的 GitHub Actions Secrets
#
# 前置条件（只需一个）：
#   export GH_TOKEN=ghp_xxx     # 必须带 repo 权限（勾选 repo 全选），否则 API 会返回
#                               # "Resource not accessible by personal access token"
#
# 用法：
#   ./setup-secrets.sh           # 写入三个仓库
#   ./setup-secrets.sh English   # 只写某一个
#
# 说明：GitHub 不允许任何「非仓库管理员」的凭据写入 Secrets，这是平台硬限制，
#       所以这一步必须由一个有足够权限的 token 完成 —— 脚本只是把它压缩成一条命令。
set -euo pipefail

OWNER="q137663972-alt"
REPOS=(English math chinese)

KS_DIR="$(cd "$(dirname "$0")" && pwd)/keystore"
LIST="$KS_DIR/GitHub-Secrets填写清单.md"

if [ ! -r "$LIST" ]; then
  echo "❌ 找不到 $LIST"; exit 1
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "❌ 请先 export GH_TOKEN=<带 repo 权限的 token>"; exit 1
fi
command -v gh >/dev/null || { echo "❌ 需要 gh CLI：https://cli.github.com/"; exit 1; }

# 从清单里解析 4 个值（只认表格行：| NAME | VALUE |）
parse() { sed -n "s/^| *$1 *| *\(.*\) *|$/\1/p" "$LIST" | head -1 | xargs; }

KEY_ALIAS="$(parse KEY_ALIAS)"
STORE_PASS="$(parse KEYSTORE_STORE_PASS)"
KEY_PASS="$(parse KEYSTORE_KEY_PASS)"
KS_B64="$(parse KEYSTORE_BASE64)"

[ -n "$KEY_ALIAS" ] && [ -n "$STORE_PASS" ] && [ -n "$KEY_PASS" ] && [ -n "$KS_B64" ] \
  || { echo "❌ 清单解析失败，请检查 $LIST 的表格格式"; exit 1; }

FILTER="${1:-}"
for repo in "${REPOS[@]}"; do
  [ -n "$FILTER" ] && [ "$repo" != "$FILTER" ] && continue
  R="$OWNER/$repo"
  echo "════ $R ════"
  gh secret set KEY_ALIAS           -R "$R" -b "$KEY_ALIAS" && echo "  ✓ KEY_ALIAS"
  gh secret set KEYSTORE_STORE_PASS -R "$R" -b "$STORE_PASS" && echo "  ✓ KEYSTORE_STORE_PASS"
  gh secret set KEYSTORE_KEY_PASS   -R "$R" -b "$KEY_PASS"   && echo "  ✓ KEYSTORE_KEY_PASS"
  gh secret set KEYSTORE_BASE64     -R "$R" -b "$KS_B64"     && echo "  ✓ KEYSTORE_BASE64"
done

echo ""
echo "✅ 完成。接下来到 Actions 页面 Rerun 失败的任务即可出签名包。"
for repo in "${REPOS[@]}"; do
  echo "   https://github.com/$OWNER/$repo/actions"
done
