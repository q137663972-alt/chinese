#!/usr/bin/env bash
# 出一批新图并上线 —— 默认【只走热更】，不重出 APK
#
# 铁律（见《热更新运维手册》§4.5）：日常更新一律 push 完就结束。
# 只有命中「重大问题」清单（改 boot.js / 改原生层 / 启动即崩 / 升 versionCode /
# 换设备要离线自带全量图）才允许 --apk，且必须说得出命中的是哪一条。
#
# 用法：
#   ./tools/ship-pics.sh "批次说明"           # 热更：写回图库 → 重出画廊 → 验收 → push
#   ./tools/ship-pics.sh "说明" --apk         # 额外：同步 assets（含 img）→ 签名出包
#
# 顺序不能改：
#   1. emit-photos   把 img/ 里的新图写进 js/pics.js 的 PIC_PHOTOS（不写等于白生成）
#   2. gen-gallery   重出 pics.html 画廊
#   3. check-pics    验收：撞车不能比基线更差、出题模拟必须全绿；不过就停，绝不硬推
#   4. gen-pack      出 v3.0 资源包核对体积（CI 会再出一份发到 Pages）
#   5. 提交推送      CI 自动出资源包 → 设备下次启动自动拉取
#   (--apk 时) 6. sync-assets 含 img/  7. build-apk 签名出包
set -euo pipefail
MSG="${1:-补充生字真图}"
WANT_APK=0
[ "${2:-}" = "--apk" ] && WANT_APK=1
cd "$(dirname "${BASH_SOURCE[0]}")/.."
CH="$(pwd)"
WS="$(cd .. && pwd)"

echo "── 1/5 写回 PIC_PHOTOS ──"
node tools/emit-photos.mjs

echo "── 2/5 重出画廊 ──"
node tools/gen-gallery.mjs

echo "── 3/5 验收 ──"
node tools/check-pics.mjs --quiet

echo "── 4/5 出资源包（核对体积用，CI 会再出一份）──"
node tools/gen-pack.mjs --out hot/pack

echo "── 5/5 提交推送（只热更）──"
cd "$CH"
git add -u
git add img/ tools/ 2>/dev/null || true
if git diff --cached --quiet; then
  echo "  没有改动，跳过提交"
else
  git commit -q -m "$MSG"
  git push
  git log --oneline -1
fi

if [ "$WANT_APK" = "1" ]; then
  echo ""
  echo "⚠️  --apk：确认命中《运维手册》§4.5 重大问题清单的哪一条？"
  echo "    改 js/boot.js / 改原生层 / 启动即崩 / 升 versionCode / 换设备要离线全量图"
  echo "    说不出就 Ctrl+C 取消，回去走热更。10 秒后继续……"
  sleep 10
  echo "── 6/7 同步壳 assets（含内置 img/）──"
  cd "$WS" && ./sync-assets.sh --apply >/dev/null && echo "  已同步"
  echo "── 7/7 构建签名 APK ──"
  ./build-apk.sh chinese
  cd "$CH"
  git add -u
  git add chinese-universal/app/src/main/assets/img/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "  壳 assets 无新改动"
  else
    git commit -q -m "$MSG（同步壳 assets 内置 img）"
    git push
  fi
fi

echo ""
echo "✅ 完成。已推送，CI 会自动出资源包发布到 Pages。"
echo "   手机上【开两次 App】生效：第一次后台拉包，第二次用新内容。"
