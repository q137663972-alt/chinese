#!/usr/bin/env bash
# 一条命令推完本轮修复（token 从环境变量 GIT_TOKEN 读，不落盘、不进 git config 里持久化）
#
# 用法：GIT_TOKEN=ghp_xxx ./push-fix.sh
# 做四件事：1) 推 main  2) 推 gh-pages（含热更包）  3) 清 jsDelivr  4) 线上复核
set -uo pipefail

GH_USER="${GH_USER:-q137663972-alt}"
REPO_DIR="${REPO_DIR:-/root/.codebuddy/artifact/chinese-222/chinese}"
PROXY_HTTPS="https://ghfast.top/https://github.com"
PROXY_GIT="https://gh-proxy.com/https://github.com"

[ -n "${GIT_TOKEN:-}" ] || { echo "❌ 需要 GIT_TOKEN=ghp_xxx"; exit 1; }

AUTH="$(printf '%s:%s' "$GH_USER" "$GIT_TOKEN" | base64 -w0)"
HDR="http.extraHeader=Authorization: Basic $AUTH"
gh() {
  git -c "$HDR" \
      -c "user.name=$GH_USER" \
      -c "user.email=${GH_USER}@users.noreply.github.com" "$@"
}

cd "$REPO_DIR" || exit 1

echo "════ 1/4 推 main ════"
git remote set-url origin "$PROXY_HTTPS" 2>/dev/null || true
if gh push origin main 2>&1 | tail -5; then
  echo "   ✅ main 已推"
else
  echo "   ⚠️ 直连代理失败，换 gh-proxy 再试"
  git remote set-url origin "$PROXY_GIT"
  gh push origin main 2>&1 | tail -5
fi
git remote set-url origin "$PROXY_HTTPS" 2>/dev/null || true

echo "════ 2/4 等 CI 出包（并推 gh-pages）════"
# CI 会在 main 上构建并把 hot/pack 推到 gh-pages。这里轮询远程包版本。
TARGET_BUILD="$(node -e "console.log(require('./hot/pack/manifest.json').build)")"
echo "   目标 build：$TARGET_BUILD"
OK=0
for i in $(seq 1 40); do
  sleep 15
  LIVE="$(curl -s -m 20 "https://cdn.jsdelivr.net/gh/$GH_USER/chinese@gh-pages/hot/pack/manifest.json?t=$(date +%s)" \
          | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',''))" 2>/dev/null || echo "")"
  echo "   [$((i*15))s] 线上 build = ${LIVE:-(空)}"
  if [ "$LIVE" = "$TARGET_BUILD" ]; then OK=1; break; fi
done

if [ "$OK" != "1" ]; then
  echo "   ⚠️ CI 未在 10 分钟内产出目标 build。可能是 CI 失败或还在排队。"
  echo "      用 gh 看运行：gh run list --repo $GH_USER/chinese --limit 3"
  exit 2
fi

echo "════ 3/4 清 jsDelivr 缓存 ════"
curl -s -m 40 -X POST "https://purge.jsdelivr.net/" -H "Content-Type: application/json" -d "{\"path\":[\
/gh/$GH_USER/chinese@gh-pages/hot/pack/manifest.json,\
/gh/$GH_USER/chinese@gh-pages/hot/pack/code.$TARGET_BUILD.zip,\
/gh/$GH_USER/chinese@gh-pages/hot/pack/assets.$TARGET_BUILD.zip,\
/gh/$GH_USER/chinese@gh-pages/hot/pack/code.zip,\
/gh/$GH_USER/chinese@gh-pages/hot/pack/assets.zip\
]}" >/dev/null 2>&1 && echo "   ✅ 已请求清缓存（约数十秒生效）"

echo "════ 4/4 线上复核 ════"
BASE="https://cdn.jsdelivr.net/gh/$GH_USER/chinese@gh-pages/hot/pack"
M="$(curl -s -m 25 "$BASE/manifest.json?t=$(date +%s)")"
echo "$M" | python3 -c "
import json,sys,hashlib,urllib.request
m=json.load(sys.stdin)
print('build =', m['build'], ' min_apk =', m['min_apk'])
base='$BASE'
for pk in m['packs']:
    url=base+'/'+pk['name']
    try:
        d=urllib.request.urlopen(url, timeout=90).read()
        h=hashlib.sha256(d).hexdigest()
        ok = (h==pk['sha256']) and (len(d)==pk['size'])
        print(('  ✅ ' if ok else '  ❌ ')+pk['name'], len(d),'字节  sha256', '一致' if h==pk['sha256'] else '不一致!')
    except Exception as e:
        print('  ❌', pk['name'], '取不到:', e)
"
