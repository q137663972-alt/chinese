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
# -c 里带身份：/tmp 里新克隆的仓库没有 user.name/email，commit 会直接失败
gh() {
  git -c "$HDR" \
      -c "user.name=$GH_USER" \
      -c "user.email=${GH_USER}@users.noreply.github.com" "$@"
}

# 清 jsDelivr @gh-pages 缓存，避免设备卡在 12h 旧包（手册 §4.3 / 历史 §5 坑：
# 发布后不 purge，设备从首选源 jsDelivr 拉到旧 manifest→指向已删除的 zip→404→热更失败）
purge_cdn() {
  local repo="$1"
  curl -s -m 30 -X POST "https://purge.jsdelivr.net/" -H "Content-Type: application/json" \
    -d "{\"path\":[\
/gh/$GH_USER/$repo@gh-pages/hot/pack/manifest.json,\
/gh/$GH_USER/$repo@gh-pages/hot/pack/code.zip,\
/gh/$GH_USER/$repo@gh-pages/hot/pack/assets.zip,\
/gh/$GH_USER/$repo@gh-pages/hot/js/games.js,\
/gh/$GH_USER/$repo@gh-pages/hot/js/app.js\
]}" >/dev/null 2>&1 \
    && echo "   ✅ 已请求清 jsDelivr 缓存（异步，约数十秒生效）" \
    || echo "   ⚠️ 清 jsDelivr 缓存请求未成功（可手动补 purge.jsdelivr.net）"
}

# 1. 构建并签名（SKIP_BUILD=1 时用已有 ./apk 里的包）
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "跳过构建，使用 /workspace/apk 现有包"
else
  ./build-apk.sh "${1:-}" || { echo "❌ 构建失败，未发布"; exit 1; }
fi

# 1.5 生成热更资源包（js / css 改动全靠它下发，不用出新 APK）
#     tools/gen-pack.mjs 会扫 css + js（boot.js 除外，它是冻结文件），
#     新增的 js/praise.js 这类普通文件会被 boot.js 追加到末尾加载。
gen_hot() {
  local dir="$1" label="$2"
  [ -d "/workspace/$dir/tools" ] || return 0
  echo ""
  echo "════ 生成 $label 热更包 ════"
  ( cd "/workspace/$dir" && node tools/gen-pack.mjs --out page/hot/pack ) 2>&1 \
    | grep -E "build|总计|❌" | sed 's/^/   /'
}

# 2. 每个包推到对应仓库的 gh-pages（Pages 直链）
#    $1=仓库名 $2=APK 文件名 $3=Pages 路径名 $4=项目目录（放热更包用）
publish() {
  local repo="$1" apk="$2" page="$3" sdir="$4"
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
    # 热更包一起发：hot/ 在 .gitignore 里，需要 -f 强制入仓
    if [ -n "$sdir" ] && [ -d "/workspace/$sdir/page/hot/pack" ]; then
      mkdir -p hot/pack && cp -f "/workspace/$sdir/page/hot/pack/"* hot/pack/ 2>/dev/null
      git add -f hot/pack
      echo "   附带热更包 build $(python3 -c "import json;print(json.load(open('hot/pack/manifest.json'))['build'])" 2>/dev/null)"
    fi
    if git diff --cached --quiet; then
      echo "   APK 内容与线上一致，无需提交"
      exit 0
    fi
    gh commit -q -m "发布 $apk + 热更包（$(date +%F)）" || { echo "   ❌ 提交失败"; exit 1; }
    # 代理偶发 403（大二进制被限流），重试 3 次
    for i in 1 2 3; do
      if gh push -q origin HEAD:gh-pages 2>/tmp/pub-err-$repo; then
        echo "   ✅ 已推送 → https://${GH_USER}.github.io/${page}/apk/${apk}"
        purge_cdn "$repo"
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
         || { gh commit -q -m "chore: 同步源码与脚本（$(date +%F)）" && echo "      已提交"; }; } \
    && { gh push -q origin HEAD:main 2>/tmp/sync-err-$label && echo "      ✅ main 已推送" \
         || { echo "      ❌ main 推送失败：$(tail -2 /tmp/sync-err-$label)"; false; }; } )
}

FILTER="${1:-}"
case "$FILTER" in
  ""|chinese) gen_hot chinese 语文 && publish chinese ChinesePlayground.apk chinese chinese && sync_main chinese 语文 ;;
esac
case "$FILTER" in
  ""|math)     gen_hot math 数学 && publish math MathPlayground.apk math math && sync_main math 数学 ;;
esac
case "$FILTER" in
  ""|english)  gen_hot . 英语 && publish English EnglishPlayground.apk English . && sync_main . 英语 ;;
esac

echo ""
echo "完成。APK 直链即时生效；热更包要等 App 下次启动自动拉取（约 1~2 分钟）。"
