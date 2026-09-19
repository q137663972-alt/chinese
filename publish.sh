#!/usr/bin/env bash
# 一条命令：构建 → 本地签名 → 发布到 Pages 下载直链 → 同步 main
#
# 这条链路完全不依赖 GitHub Actions Secrets：
#   签名在沙箱本地完成（keystore 不进仓库）；
#   发布用 git 推送 —— 代理对 git 协议（Smart HTTP）透传 Basic 认证，所以一直能推；
#   但它对 REST API 不透传 Authorization 头，所以写不了 Secrets（详见手册第 6 节）。
#
# 发布方式：在 /tmp 里单独浅克隆一份仓库操作 gh-pages，绝不切换主工作区分支
#           （上一版直接 checkout -B gh-pages，一旦本地有改动就被 git 拒绝，已修）。
#
# 用法：
#   ./publish.sh              # 三个包全做
#   ./publish.sh math         # 只做数学
#   SYNC_MAIN=0 ./publish.sh  # 只发 APK，不顺带同步 main
#   SKIP_BUILD=1 ./publish.sh # 已构建好，只做发布
set -uo pipefail

GH_USER="${GH_USER:-q137663972-alt}"
PROXY="${GIT_PROXY:-https://gh-proxy.com/https://github.com}"
SYNC_MAIN="${SYNC_MAIN:-1}"

if [ -z "${GIT_TOKEN:-}" ] && [ -r /workspace/.git_token ]; then
  GIT_TOKEN="$(cat /workspace/.git_token)"
fi
[ -n "${GIT_TOKEN:-}" ] || { echo "❌ 需要 GIT_TOKEN（或放一份在 /workspace/.git_token）"; exit 1; }

AUTH="$(printf '%s:%s' "$GH_USER" "$GIT_TOKEN" | base64 -w0)"
HDR="http.extraHeader=Authorization: Basic $AUTH"
gh() { git -c "$HDR" "$@"; }

# 1. 构建并签名（SKIP_BUILD=1 时用已有 ./apk 里的包）
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "跳过构建，使用 /workspace/apk 现有包"
else
  ./build-apk.sh "${1:-}" || { echo "❌ 构建失败，未发布"; exit 1; }
fi

# 2. 每个包推到对应仓库的 gh-pages（Pages 直链）
#    $1=仓库名 $2=APK 文件名 $3=Pages 路径名
publish() {
  local repo="$1" apk="$2" page="$3"
  [ -f "/workspace/apk/$apk" ] || { echo "跳过（未产出）：$apk"; return 0; }
  echo ""
  echo "════ 发布 $apk → $repo gh-pages ════"

  local wt="/tmp/pub-$repo"
  rm -rf "$wt"
  if ! gh clone -q --depth 1 "$PROXY/$GH_USER/$repo.git" "$wt" 2>/tmp/clone-err-$repo; then
    echo "   ❌ 克隆失败：$(tail -2 /tmp/clone-err-$repo)"; return 1
  fi

  (
    cd "$wt" || exit 1
    gh fetch -q --depth 1 origin gh-pages 2>/dev/null \
      && git checkout -q -B gh-pages FETCH_HEAD \
      || git checkout -q -B gh-pages
    mkdir -p apk && cp "/workspace/apk/$apk" "apk/$apk"
    git add -f "apk/$apk"
    if git diff --cached --quiet; then
      echo "   APK 内容与线上一致，无需提交"
      exit 0
    fi
    git commit -q -m "发布 $apk（$(date +%F)）"
    # 代理偶发 403（大二进制被限流），重试 3 次
    for i in 1 2 3; do
      if gh push -q origin HEAD:gh-pages 2>/tmp/pub-err-$repo; then
        echo "   ✅ 已推送 → https://${GH_USER}.github.io/${page}/apk/${apk}"
        exit 0
      fi
      echo "   第 $i 次推送失败，重试…"
      sleep 3
    done
    echo "   ❌ 推送失败：$(tail -2 /tmp/pub-err-$repo)"
    exit 1
  )
}

# 3. 顺带把主工作区的未提交改动同步到 main（可选）
sync_main() {
  [ "$SYNC_MAIN" = "1" ] || return 0
  local d="$1" label="$2"
  echo "   —— 同步 $label main ——"
  ( cd "/workspace/$d" \
    && git add -A \
    && { git diff --cached --quiet && echo "      main 无改动" \
         || { git commit -q -m "chore: 同步源码与脚本（$(date +%F)）" && echo "      已提交"; }; } \
    && { gh push -q origin HEAD:main 2>/tmp/sync-err-$label && echo "      ✅ main 已推送" \
         || { echo "      ❌ main 推送失败：$(tail -2 /tmp/sync-err-$label)"; false; }; } )
}

FILTER="${1:-}"
case "$FILTER" in
  ""|chinese) publish chinese ChinesePlayground.apk chinese && sync_main chinese 语文 ;;
esac
case "$FILTER" in
  ""|math)     publish math     MathPlayground.apk    math     && sync_main math     数学 ;;
esac
case "$FILTER" in
  ""|english)  publish English  EnglishPlayground.apk English  && sync_main .        英语 ;;
esac

echo ""
echo "完成。首次发布 Pages 需 1~2 分钟生效。"
