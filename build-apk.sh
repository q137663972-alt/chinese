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

echo "════ 1/4 同步 Web 层 → assets（防止两份代码脱节） ════"
# 先整个删干净再拷：三科迁移后 assets 里多出 cn/ math/ en/ 三个子目录，
# 不删就要面对"上次残留的旧路径文件"这类幽灵故障 —— 它不会报错，
# 只会在某些机型上被优先加载。
rm -rf "$ASSETS/css" "$ASSETS/js" "$ASSETS/img" "$ASSETS/cn" "$ASSETS/math" "$ASSETS/en"
mkdir -p "$ASSETS/css" "$ASSETS/js"

cp -f "$ROOT/index.html" "$ASSETS/index.html"
cp -f "$ROOT"/css/*.css "$ASSETS/css/"
cp -f "$ROOT"/js/*.js   "$ASSETS/js/"

for d in cn math en; do
  [ -d "$ROOT/$d" ] || { echo "❌ 缺 $ROOT/$d（三合一后缺一科）"; exit 1; }
  mkdir -p "$ASSETS/$d/css" "$ASSETS/$d/js"
  cp -f "$ROOT/$d"/css/*.css "$ASSETS/$d/css/" 2>/dev/null || true
  cp -f "$ROOT/$d"/js/*.js   "$ASSETS/$d/js/"  2>/dev/null || true
  # 图片至今只有语文有（看图识字 143 张 webp），写成通用循环，哪科有了自动带上
  if ls "$ROOT/$d"/img/* >/dev/null 2>&1; then
    mkdir -p "$ASSETS/$d/img"
    cp -f "$ROOT/$d"/img/* "$ASSETS/$d/img/"
  fi
done

# 完整性校验：boot.js 清单上的每个文件都必须真的躺在 assets 里。
# 少了任何一个，启动都是 404 → 哨兵超时 → 回滚 → 无限重启的黑屏循环，
# 而且只在装着资源包的旧机上复现，开发机上怎么跑都正常。
node -e '
const fs=require("fs"),path=require("path");
const A=process.argv[1];
const src=fs.readFileSync(A+"/js/boot.js","utf8");
const bad=[];
for(const m of src.matchAll(/var\s+(?:BUILTIN_(?:CN|MATH|EN)|HOST_JS)\s*=\s*\[([\s\S]*?)\]/g))
  for(const q of m[1].matchAll(/"([^"]+)"/g))
    if(!fs.existsSync(path.join(A,q[1]))) bad.push(q[1]);
if(bad.length){console.error("❌ assets 缺文件：\n  "+bad.join("\n  "));process.exit(1);}
console.log("   assets 完整性校验通过");
' "$ASSETS"

echo "   宿主 $(ls "$ROOT"/js/*.js | wc -l) js / $(ls "$ROOT"/css/*.css | wc -l) css" \
     "| cn $(ls "$ROOT"/cn/js/*.js | wc -l) | math $(ls "$ROOT"/math/js/*.js | wc -l) | en $(ls "$ROOT"/en/js/*.js | wc -l)"

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
