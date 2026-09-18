# 语文乐园（Chinese Playground）

小学 1–6 年级语文学习 H5 / 安卓 APK。拼音识字、必背古诗、词语成语、笔顺书写，全部离线可用。

## 玩法（14 种）

| 模块 | 玩法 |
| --- | --- |
| 拼音与识字 | 听音选字 · 看图识字 · 拼音配对 · 组词填空 · 生字消消乐 |
| 笔顺与书写 | 笔画数练习 · 笔顺演示（逐笔动画） |
| 必背古诗 | 诗句填空 · 连句成诗（54 首） |
| 词语与成语 | 成语填空（145 条）· 近反义词（132 组）· 量词搭配（64 条） |
| 综合与语音 | 限时挑战 · 朗读跟读（TTS 评分） |

## 内容规模

- **576 个生字**（6 年级 × 上/下册 × 4 单元），每个字带拼音、笔画数、组词、配图
- **567 字手写笔顺 SVG 数据**（逐笔演示）
- 54 首必背古诗、145 条成语、132 组近反义词、64 条量词、18 类拓展分类

## 目录结构

```
index.html / css/ / js/          H5 本体（纯静态，无构建）
chinese-app/                     电视版壳（横屏 + 遥控器焦点 + LEANBACK_LAUNCHER）
chinese-phone/                   手机版壳（竖屏 + 触屏交互）
.github/workflows/build.yml      CI：出 APK + 部署 GitHub Pages
```

## 在线版

<https://q137663972-alt.github.io/chinese/>

手机浏览器打开即可玩，数据存在本机 localStorage（`cn_` 前缀），不上传服务器。

## 本地运行

```bash
python3 -m http.server 8891
# 浏览器打开 http://127.0.0.1:8891/index.html
```

## 构建 APK

推送到 GitHub 后 Actions 自动构建；也可手动 `workflow_dispatch`。
产物在 Release（临时）与 Actions Artifacts 中：

- `ChinesePlayground-TV.apk`（电视版）
- `ChinesePlayground-Phone.apk`（手机版）

电视版遥控器操作：上下左右移动焦点，OK 确认，返回键回退，长按 OK 呼出语音（若设备支持）。

## 数据结构

`(function(g){ (window.GRADES=window.GRADES||[]).push(g); })({g:1, books:[{n:"一上册", u:[{n:"天地自然", k:"🌍", w:[{z:"天",p:"tiān",n:4,w:["今天","天空"],k:"🌤️"}]}]}]})`

- `z` 字 / `p` 拼音（含声调）/ `n` 笔画数 / `w` 组词 / `k` 配图 emoji
- `strokes.js`：`window.STROKES = { 字: [path,...] }`，一个 path 一笔
- `data-poem.js` / `data-word.js` / `strokes.js` 为拓展题库
