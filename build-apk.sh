#!/usr/bin/env bash
# 语文乐园：构建 → 对齐 → 本地签名 → 输出到 /workspace/apk/ChinesePlayground.apk
#
# 被 publish.sh 调用；也可以单独跑。签名材料读 keystore/keystore.properties（git 已忽略）。
#
# 关键：出包前必须把仓库根的 js/ 同步进壳工程 assets/js —— 这两份文件长期脱节，
#       boot.js 又是冻结文件（热更包会剔除它），只改源目录等于改了个寂寞。见手册 §11.10。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$ROOT/chinese-universal"
ASSETS="$SHELL_DIR/app/src/main/assets"

GRADLE="${GRADLE:-/opt/gradle/gradle-8.2/bin/gradle}"
ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
BUILD_TOOLS="${BUILD_TOOLS:-$ANDROID_HOME/build-tools/34.0.0}"
OUT="${OUT:-/workspace/apk/ChinesePlayground.apk}"

echo "════ 1/4 同步 js → assets（防止两份代码脱节） ════"
cp -f "$ROOT"/js/*.js "$ASSETS/js/"
cp -f "$ROOT"/css/*.css "$ASSETS/css/"
echo "   js $(ls "$ROOT"/js/*.js | wc -l) 个 / css $(ls "$ROOT"/css/*.css | wc -l) 个 → assets"

echo "════ 2/4 Gradle 构建（unsigned） ════"
cd "$SHELL_DIR"
ANDROID_HOME="$ANDROID_HOME" "$GRADLE" assembleRelease --no-daemon -q
UNSIGNED="$SHELL_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
[ -f "$UNSIGNED" ] || { echo "❌ 未产出 unsigned APK"; exit 1; }

echo "════ 3/4 对齐 + 签名 ════"
KS="$ROOT/keystore/keystore.properties"
[ -r "$KS" ] || { echo "❌ 缺 $KS（keystore 丢失则签名会变，用户需卸载重装）"; exit 1; }
# shellcheck disable=SC1090
. "$KS"
mkdir -p "$(dirname "$OUT")"
"$BUILD_TOOLS/zipalign" -p -f 4 "$UNSIGNED" /tmp/aligned.apk
cp -f /tmp/aligned.apk "$OUT"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$ROOT/${KS_FILE}" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_STORE_PASS" --key-pass "pass:${KS_KEY_PASS:-$KS_STORE_PASS}" \
  --min-sdk-version 21 --v1-signing-enabled true --v2-signing-enabled true "$OUT"

echo "════ 4/4 校验 ════"
"$BUILD_TOOLS/apksigner" verify "$OUT" >/dev/null && echo "   签名校验通过"
"$BUILD_TOOLS/apksigner" verify --print-certs "$OUT" 2>/dev/null | grep "SHA-1" | sed 's/^/   /'
"$BUILD_TOOLS/aapt" dump badging "$OUT" 2>/dev/null | sed -n '1p' | sed 's/^/   /'
ls -la "$OUT"
