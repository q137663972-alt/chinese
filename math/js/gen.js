/* ===================== 数学乐园 · 题目生成器 =====================
   所有玩法统一出题入口 genQ(cfg) / genV(cfg) / genFrac(cfg)
   题目对象：{ q 题面, a 正确答案(String), opts 选项数组(String[4]),
              say 朗读文本, v 竖式数据{a,b,op,r} 可选 } */

function rnd(a, b){ return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function gcd(a, b){ a = Math.abs(a); b = Math.abs(b); while(b){ var t = b; b = a % b; a = t; } return a || 1; }

/* 数字读法（读题用） */
function numSay(n){
  if(typeof n === "string") n = parseFloat(n);
  if(isNaN(n)) return String(n);
  if(n < 0) return "负" + numSay(-n);
  if(!isFinite(n)) return String(n);
  if(String(n).indexOf(".") >= 0){
    var p = String(n).split(".");
    return numSay(parseInt(p[0], 10)) + "点" + p[1].split("").map(function(d){ return numSay(parseInt(d, 10)); }).join("");
  }
  n = Math.round(n);
  var C = "零一二三四五六七八九";
  if(n < 10) return C[n];
  if(n === 10) return "十";
  if(n < 20) return "十" + C[n % 10];
  if(n < 100){ var t = Math.floor(n / 10), o = n % 10; return C[t] + "十" + (o ? C[o] : ""); }
  if(n < 1000){ var h = Math.floor(n / 100), r = n % 100; return C[h] + "百" + (r === 0 ? "" : (r < 10 ? "零" + C[r] : numSay(r))); }
  if(n < 10000){ var th = Math.floor(n / 1000), r2 = n % 1000; return C[th] + "千" + (r2 === 0 ? "" : (r2 < 100 ? "零" + numSay(r2) : numSay(r2))); }
  return String(n);
}
var OP_SAY = { "+": "加", "-": "减", "×": "乘", "÷": "除以" };
function fracSay(a, b){
  return numSay(b) + "分之" + (a === 1 ? "一" : numSay(a));
}

/* 数字干扰项 */
function numOpts(ans, n, spread){
  var base = typeof ans === "number" ? ans : parseFloat(ans);
  if(isNaN(base)) base = 0;
  var s = {};
  s[base] = 1;
  var d = Math.max(1, Math.round(spread || Math.max(2, Math.abs(base) * 0.25)));
  var guard = 0;
  while(Object.keys(s).length < n && guard < 200){
    guard++;
    var delta = rnd(1, d) * (Math.random() < 0.5 ? -1 : 1);
    var v = base + delta;
    if(v < 0) v = base + Math.abs(delta) * 2;
    s[v] = 1;
    if(Object.keys(s).length < n && Math.random() < 0.4){ var v2 = base + rnd(1, d + 3) * (Math.random() < 0.5 ? -1 : 1); if(v2 >= 0) s[v2] = 1; }
  }
  return shuffle(Object.keys(s).map(String));
}
function strOpts(ans, pool, n){
  var set = {};
  set[ans] = 1;
  var others = shuffle(pool.filter(function(x){ return x !== ans; }));
  var i = 0;
  while(Object.keys(set).length < n && i < others.length){ set[others[i]] = 1; i++; }
  return shuffle(Object.keys(set));
}

/* ——— 选项统一整形：修浮点脏数据 → 去重 → 不足 4 个时补齐 ——— */
/* 只抹掉浮点噪声：7.199999999999999 → 7.2 */
function numFix(s){
  return String(s).replace(/-?\d+\.\d{3,}/g, function(m){
    return String(Math.round(parseFloat(m) * 100) / 100);
  });
}
/* 答案/选项用：再去掉多余的尾随 .0 —— 34.0 → 34、113.0cm³ → 113cm³ */
function numFixAns(s){
  return numFix(s).replace(/(\d+)\.0+(?=[^\d]|$)/g, "$1");
}
function padOpts(ans, opts, n){
  var m = String(ans).match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  var guard = 0;
  while(opts.length < n && m && guard < 60){
    guard++;
    var base = parseFloat(m[1]), suf = m[2];
    var dec = (String(m[1]).split(".")[1] || "").length;
    var step = Math.max(1, Math.round(Math.abs(base) * 0.3) + 1);
    var d = rnd(1, step) * (Math.random() < 0.5 ? -1 : 1);
    var v = parseFloat((base + d).toFixed(dec));
    if(v < 0) v = parseFloat((base + Math.abs(d)).toFixed(dec));
    var s = numFixAns(v + suf);
    if(opts.indexOf(s) < 0) opts.push(s);
  }
  return opts;
}
/* 分数涂色图：平均分 b 份，涂 a 份 */
function fracSVG(a, b){
  var W = 320, H = 90, gap = 5, pad = 3;
  var w = (W - gap * (b - 1) - pad * 2) / b;
  var s = '<svg class="frac-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
  for(var i = 0; i < b; i++){
    var x = pad + i * (w + gap);
    s += '<rect x="' + x.toFixed(1) + '" y="3" width="' + w.toFixed(1) + '" height="' + (H - 6) +
      '" rx="7" fill="' + (i < a ? "#ff8fab" : "#eef2f9") + '" stroke="#c3cfe3" stroke-width="2"/>';
  }
  return s + '</svg>';
}
function mk(q, a, opts, say, v, img){
  a = numFixAns(a);
  var out = [], seen = {};
  out.push(a); seen[a] = 1;
  (opts || []).forEach(function(o){
    o = numFixAns(o);
    if(!seen[o]){ seen[o] = 1; out.push(o); }
  });
  if(opts && opts.length >= 3 && out.length < 4) out = padOpts(a, out, 4);
  var r = { q: numFix(q), a: a, opts: shuffle(out), say: numFix(say || q), v: v || null };
  if(img) r.img = img;
  return r;
}

/* 图形配图：优先用矢量图，缺数据时回退 emoji */
function shapePic(s, cls){
  var v = (window.SHAPE_SVG || {})[s && s.n];
  return '<div class="shape-pic' + (cls ? " " + cls : "") + '">' + (v || (s ? s.k : "")) + '</div>';
}

/* ===================== 口算类生成器 ===================== */
var GEN = {

/* ——— 加减法 ——— */
addsub20c: function(){
  var a = rnd(6, 14), b = rnd(11 - a, 14);
  while(a + b <= 10 || a + b > 20) b = rnd(2, 14);
  var r = a + b;
  return mk(a + " + " + b + " = ?", r, numOpts(r, 4, 3), numSay(a) + "加" + numSay(b) + "等于几",
    { a: a, b: b, op: "+", r: r });
},
addsub20b: function(){
  var x = rnd(11, 18), y = rnd(Math.max(2, x - 9), 9);
  var r = x - y;
  return mk(x + " − " + y + " = ?", r, numOpts(r, 4, 3), numSay(x) + "减" + numSay(y) + "等于几",
    { a: x, b: y, op: "-", r: r });
},
shapeq: function(){
  var gi = (typeof state !== "undefined" && state) ? state.gi : 0;
  var pool = (window.SHAPES || []).filter(function(s){ return s.edges > 0 && (s.g || 1) <= gi + 2; });
  if(!pool.length) pool = (window.SHAPES || []).filter(function(s){ return s.edges > 0; });
  var s = pool[Math.floor(Math.random() * pool.length)];
  /* 立体图形说「棱」，平面图形说「边」 */
  var unit = s.solid ? "棱" : "边";
  return mk(s.n + (s.solid ? " 有几条棱？" : " 有几条边？"), String(s.edges), numOpts(s.edges, 4, 2),
    s.n + "有几条" + unit, null, shapePic(s));
},
addsub: function(c){
  var m = (c && c.max) || 10;
  var a = rnd(Math.ceil(m * 0.3), m), b = rnd(0, m - a);
  if(Math.random() < 0.5)
    return mk(a + " + " + b + " = ?", a + b, numOpts(a + b, 4, Math.max(2, m * 0.2)), numSay(a) + "加" + numSay(b) + "等于几",
      { a: a, b: b, op: "+", r: a + b });
  var x = rnd(Math.ceil(m * 0.3), m), y = rnd(0, x);
  return mk(x + " − " + y + " = ?", x - y, numOpts(x - y, 4, Math.max(2, m * 0.2)), numSay(x) + "减" + numSay(y) + "等于几",
    { a: x, b: y, op: "-", r: x - y });
},
addsub2: function(){
  var styles = [
    function(){ var a = rnd(11, 89), b = rnd(1, 9); return { q: a + " + " + b + " = ?", r: a + b, a: a, b: b, op: "+", say: numSay(a) + "加" + numSay(b) }; },
    function(){ var a = rnd(21, 99), b = rnd(1, 9); return { q: a + " − " + b + " = ?", r: a - b, a: a, b: b, op: "-", say: numSay(a) + "减" + numSay(b) }; },
    function(){ var a = rnd(12, 88), b = rnd(1, 8) * 10; return { q: a + " + " + b + " = ?", r: a + b, a: a, b: b, op: "+", say: numSay(a) + "加" + numSay(b) }; },
    function(){ var a = rnd(31, 99), b = rnd(1, 8) * 10; return { q: a + " − " + b + " = ?", r: a - b, a: a, b: b, op: "-", say: numSay(a) + "减" + numSay(b) }; }
  ];
  var s = pick(styles)();
  return mk(s.q, s.r, numOpts(s.r, 4, Math.max(3, s.r * 0.15)), s.say + "等于几", { a: s.a, b: s.b, op: s.op, r: s.r });
},
addsub100: function(){
  var plus = Math.random() < 0.5;
  var a = rnd(13, 97), b = rnd(4, 89);
  if(!plus && b > a){ var t = a; a = b; b = t; }
  var r = plus ? a + b : a - b;
  return mk(a + (plus ? " + " : " − ") + b + " = ?", r, numOpts(r, 4, Math.max(4, r * 0.12)),
    numSay(a) + OP_SAY[plus ? "+" : "-"] + numSay(b) + "等于几", { a: a, b: b, op: plus ? "+" : "-", r: r });
},
addsub1000: function(){
  var plus = Math.random() < 0.5;
  var a = rnd(105, 985), b = rnd(15, 489);
  if(!plus && b > a){ var t = a; a = b; b = t; }
  var r = plus ? a + b : a - b;
  return mk(a + (plus ? " + " : " − ") + b + " = ?", r, numOpts(r, 4, Math.max(10, r * 0.1)),
    numSay(a) + OP_SAY[plus ? "+" : "-"] + numSay(b) + "等于几", { a: a, b: b, op: plus ? "+" : "-", r: r });
},
twostep: function(){
  var a = rnd(3, 9), b = rnd(3, 9), c = rnd(2, 9);
  var r = a * b + c;
  return mk(a + " × " + b + " + " + c + " = ?", r, numOpts(r, 4, Math.max(3, r * 0.2)),
    numSay(a) + "乘" + numSay(b) + "再加" + numSay(c) + "等于几");
},
bignum: function(){
  var kind = Math.random();
  if(kind < 0.5){
    var a = rnd(1000, 99999), b = rnd(1000, 99999);
    while(b === a) b = rnd(1000, 99999);
    var big = Math.max(a, b);
    var opts = strOpts(String(big), [String(a), String(b), String(big + rnd(101, 999)), String(big - rnd(101, 999))], 4);
    return mk(numSay(a) + " 和 " + numSay(b) + " 哪个更大？", String(big), opts,
      numSay(a) + "和" + numSay(b) + "哪个大");
  }
  var digits = rnd(4, 5);
  var n = rnd(Math.pow(10, digits - 1), Math.pow(10, digits) - 1);
  return mk("「" + n + "」读作多少？", numSay(n), [numSay(n), numSay(n + rnd(1, 9) * Math.pow(10, rnd(1, 3))), numSay(n + rnd(1, 9)), numSay(n - rnd(1, 9))], "请读出" + n);
},

/* ——— 乘除法 ——— */
mult: function(c){
  var mx = (c && c.max) || 9;
  var a = rnd(1, mx), b = rnd(1, 9);
  return mk(a + " × " + b + " = ?", a * b, numOpts(a * b, 4, Math.max(3, a * b * 0.3)), numSay(a) + "乘" + numSay(b) + "等于几",
    { a: a, b: b, op: "×", r: a * b });
},
div: function(){
  var b = rnd(2, 9), r = rnd(1, 9), a = b * r;
  return mk(a + " ÷ " + b + " = ?", r, numOpts(r, 4, 3), numSay(a) + "除以" + numSay(b) + "等于几",
    { a: a, b: b, op: "÷", r: r });
},
mul1: function(cfg){
  /* d=2 两位数×一位数（二年级）；d=3 多位数×一位数（三年级，默认） */
  var d = (cfg && cfg.d) === 2 ? 2 : ((cfg && cfg.d) === 3 ? 3 : (Math.random() < 0.5 ? 2 : 3));
  var a = d === 2 ? rnd(12, 49) : rnd(102, 398);
  var b = rnd(2, 9);
  return mk(a + " × " + b + " = ?", a * b, numOpts(a * b, 4, Math.max(8, a * b * 0.1)), numSay(a) + "乘" + numSay(b) + "等于几",
    { a: a, b: b, op: "×", r: a * b });
},
mul2: function(){
  var a = rnd(11, 49), b = rnd(11, 49);
  return mk(a + " × " + b + " = ?", a * b, numOpts(a * b, 4, Math.max(30, a * b * 0.08)), numSay(a) + "乘" + numSay(b) + "等于几",
    { a: a, b: b, op: "×", r: a * b });
},
mul3x2: function(){
  var a = rnd(112, 898), b = rnd(11, 39);
  return mk(a + " × " + b + " = ?", a * b, numOpts(a * b, 4, Math.max(60, a * b * 0.05)), numSay(a) + "乘" + numSay(b) + "等于几",
    { a: a, b: b, op: "×", r: a * b });
},
div1: function(){
  var b = rnd(2, 9), r = rnd(11, 49), a = b * r;
  return mk(a + " ÷ " + b + " = ?", r, numOpts(r, 4, Math.max(4, r * 0.2)), numSay(a) + "除以" + numSay(b) + "等于几",
    { a: a, b: b, op: "÷", r: r });
},
div2: function(){
  var b = rnd(11, 29), r = rnd(5, 29), a = b * r;
  return mk(a + " ÷ " + b + " = ?", r, numOpts(r, 4, Math.max(3, r * 0.25)), numSay(a) + "除以" + numSay(b) + "等于几",
    { a: a, b: b, op: "÷", r: r });
},

/* ——— 混合运算 ——— */
mixed: function(){
  var a = rnd(4, 20), b = rnd(3, 12), c = rnd(2, 9), d = rnd(2, 9);
  var styles = [
    function(){ return mk(a + " + " + b + " × " + c + " = ?", a + b * c, numOpts(a + b * c, 4, Math.max(4, (a + b * c) * 0.15)),
      numSay(a) + "加" + numSay(b) + "乘" + numSay(c) + "等于几"); },
    function(){ return mk("(" + a + " + " + b + ") × " + c + " = ?", (a + b) * c, numOpts((a + b) * c, 4, Math.max(6, (a + b) * c * 0.12)),
      "括号里" + numSay(a) + "加" + numSay(b) + "，再乘" + numSay(c) + "等于几"); },
    function(){ return mk(a + " × " + b + " − " + c + " × " + d + " = ?", a * b - c * d, numOpts(a * b - c * d, 4, Math.max(4, Math.abs(a * b - c * d) * 0.3)),
      numSay(a) + "乘" + numSay(b) + "减" + numSay(c) + "乘" + numSay(d) + "等于几"); },
    function(){ return mk(a + " × " + b + " ÷ " + b + " = ?", a, numOpts(a, 4, 3), numSay(a) + "乘" + numSay(b) + "再除以" + numSay(b) + "等于几"); }
  ];
  return pick(styles)();
},
law: function(){
  var a = rnd(12, 49), b = rnd(2, 9), c = rnd(2, 9);
  if(Math.random() < 0.5){
    var r1 = a * (b + c);
    return mk(a + " × (" + b + " + " + c + ") = ?", r1, numOpts(r1, 4, Math.max(10, r1 * 0.1)),
      "用简便方法算：" + numSay(a) + "乘括号" + numSay(b) + "加" + numSay(c) + "等于几");
  }
  var x = rnd(25, 98), y = rnd(2, 20), z = x + y;
  var r2 = x * b + y * b;
  return mk(x + " × " + b + " + " + y + " × " + b + " = ?", r2, numOpts(r2, 4, Math.max(8, r2 * 0.1)),
    numSay(x) + "乘" + numSay(b) + "加" + numSay(y) + "乘" + numSay(b) + "等于几");
},
equation: function(){
  var kind = Math.random();
  var x, b, c, r;
  if(kind < 0.4){ x = rnd(2, 20); b = rnd(2, 30); r = x + b;
    return mk("x + " + b + " = " + r + "，x = ?", x, numOpts(x, 4, 3), "x加" + numSay(b) + "等于" + numSay(r) + "，x等于几"); }
  if(kind < 0.7){ x = rnd(5, 40); b = rnd(2, x - 1); r = x - b;
    return mk("x − " + b + " = " + r + "，x = ?", x, numOpts(x, 4, 3), "x减" + numSay(b) + "等于" + numSay(r) + "，x等于几"); }
  x = rnd(2, 12); b = rnd(2, 9); r = x * b;
  return mk(b + "x = " + r + "，x = ?", x, numOpts(x, 4, 3), numSay(b) + "x等于" + numSay(r) + "，x等于几");
},

/* ——— 小数 ——— */
dec0: function(){
  var whole = rnd(0, 9), part = rnd(1, 9);
  var dec = (whole + part / 10).toFixed(1);
  return mk(numSay(whole + part / 10) + " 写成小数是多少？", dec,
    numOpts(dec, 4, 0.9), numSay(whole + part / 10) + "写成小数是多少");
},
decadd: function(){
  var a = rnd(11, 99) / 10, b = rnd(11, 88) / 10;
  var plus = Math.random() < 0.5;
  if(!plus && b > a){ var t = a; a = b; b = t; }
  var r = Math.round((plus ? a + b : a - b) * 10) / 10;
  return mk(a.toFixed(1) + (plus ? " + " : " − ") + b.toFixed(1) + " = ?", r.toFixed(1),
    shuffle([r.toFixed(1), (r + 1).toFixed(1), (r - 0.1).toFixed(1), (r + 0.9).toFixed(1)]),
    numSay(a) + OP_SAY[plus ? "+" : "-"] + numSay(b) + "等于几");
},
decmul: function(){
  var a = rnd(11, 99) / 10, b = rnd(2, 9);
  var r = Math.round(a * b * 10) / 10;
  return mk(a.toFixed(1) + " × " + b + " = ?", r.toFixed(1),
    shuffle([r.toFixed(1), (r * 10).toFixed(1), (r / 10).toFixed(1), (r + 1).toFixed(1)]),
    numSay(a) + "乘" + numSay(b) + "等于几");
},
decdiv: function(){
  var b = rnd(2, 9), r = rnd(11, 49) / 10, a = Math.round(b * r * 10) / 10;
  return mk(a.toFixed(1) + " ÷ " + b + " = ?", r.toFixed(1),
    shuffle([r.toFixed(1), (r + 0.1).toFixed(1), (r - 0.1).toFixed(1), (r * 10).toFixed(1)]),
    numSay(a) + "除以" + numSay(b) + "等于几");
},

/* ——— 分数 ——— */
frac0: function(){
  var b = pick([2, 3, 4, 5, 6, 8]), a = rnd(1, b - 1);
  return mk("涂色部分占整个图形的几分之几？", a + "/" + b,
    shuffle([a + "/" + b, b + "/" + a, (a + 1) + "/" + b, a + "/" + (b + 1)]),
    "把整体平均分成" + numSay(b) + "份，涂了" + numSay(a) + "份，是几分之几",
    null, fracSVG(a, b));
},
fracadd: function(){
  var b = pick([4, 6, 8, 9, 10, 12]);
  var a1 = rnd(1, b - 2), a2 = rnd(1, b - a1 - 1);
  if(Math.random() < 0.5){
    var r = a1 + a2;
    return mk(a1 + "/" + b + " + " + a2 + "/" + b + " = ?", (r % b === 0 ? r / b + "/1" : r + "/" + b),
      shuffle([(r % b === 0 ? r / b + "/1" : r + "/" + b), (r + 1) + "/" + b, (r - 1) + "/" + b, (r + 2) + "/" + b]),
      fracSay(a1, b) + "加" + fracSay(a2, b) + "等于几");
  }
  /* 减法按「大 − 小」出题，避免出现负数结果 */
  var big = Math.max(a1, a2), small = Math.min(a1, a2);
  var d = big - small;
  var w1 = d + 1, w2 = (d - 1 >= 1 ? d - 1 : d + 2), w3 = d + 2;
  if(w2 === d || w2 === w1 || w2 === w3) w2 = d + 3;
  return mk(big + "/" + b + " − " + small + "/" + b + " = ?", d + "/" + b,
    shuffle([d + "/" + b, w1 + "/" + b, w2 + "/" + b, w3 + "/" + b]),
    fracSay(big, b) + "减" + fracSay(small, b) + "等于几");
},
fracmul: function(){
  var a1 = rnd(1, 5), b1 = rnd(2, 9), a2 = rnd(1, 5), b2 = rnd(2, 9);
  var n = a1 * a2, d = b1 * b2, g = gcd(n, d);
  n /= g; d /= g;
  return mk(a1 + "/" + b1 + " × " + a2 + "/" + b2 + " = ?", n + "/" + d,
    shuffle([n + "/" + d, (a1 * a2) + "/" + b1, n + "/" + (d + 1), (n + 1) + "/" + d]),
    fracSay(a1, b1) + "乘" + fracSay(a2, b2) + "等于几");
},
fracdiv: function(){
  var a1 = rnd(1, 5), b1 = rnd(2, 9), a2 = rnd(1, 5), b2 = rnd(2, 9);
  var n = a1 * b2, d = b1 * a2, g = gcd(n, d);
  n /= g; d /= g;
  return mk(a1 + "/" + b1 + " ÷ " + a2 + "/" + b2 + " = ?", n + "/" + d,
    shuffle([n + "/" + d, (a1 * a2) + "/" + (b1 * b2), n + "/" + (d + 2), (n + 2) + "/" + d]),
    fracSay(a1, b1) + "除以" + fracSay(a2, b2) + "等于几");
},
frac: function(){
  var b = rnd(3, 12);
  var a1 = rnd(1, b - 1), a2 = rnd(1, b - 1);
  while(a2 === a1) a2 = rnd(1, b - 1);
  var big = a1 > a2 ? a1 : a2;
  var sign = big === a1 ? ">" : "<";
  var q = a1 + "/" + b + " ○ " + a2 + "/" + b;
  return mk(q, sign, [">", "<", "="], fracSay(a1, b) + "和" + fracSay(a2, b) + "哪个大");
},
fracMix: function(){
  var b1 = pick([2, 3, 4, 6, 8]), b2 = pick([3, 4, 5, 6, 8, 10]);
  var a1 = rnd(1, b1 - 1), a2 = rnd(1, b2 - 1);
  var v1 = a1 / b1, v2 = a2 / b2;
  var sign = v1 === v2 ? "=" : (v1 > v2 ? ">" : "<");
  var big = v1 === v2 ? null : (v1 > v2 ? a1 + "/" + b1 : a2 + "/" + b2);
  var opts;
  if(v1 === v2) opts = ["=", ">", "<"];
  else opts = strOpts(sign, [">", "<", "="], 3);
  return mk(a1 + "/" + b1 + " ○ " + a2 + "/" + b2, sign, opts, fracSay(a1, b1) + "和" + fracSay(a2, b2) + "哪个大");
},

/* ——— 图形几何 ——— */
perimeter: function(){
  var kind = Math.random();
  if(kind < 0.4){
    var a = rnd(3, 15), b = rnd(3, 15), r = (a + b) * 2;
    return mk("长方形长 " + a + "cm、宽 " + b + "cm，周长是多少？", r + "cm", numOpts(r, 4, Math.max(4, r * 0.15)).map(function(x){ return x + "cm"; }),
      "长方形长" + numSay(a) + "厘米宽" + numSay(b) + "厘米，周长是多少");
  }
  var s = rnd(3, 15), r2 = s * 4;
  return mk("正方形边长 " + s + "cm，周长是多少？", r2 + "cm", numOpts(r2, 4, Math.max(4, r2 * 0.15)).map(function(x){ return x + "cm"; }),
    "正方形边长" + numSay(s) + "厘米，周长是多少");
},
area: function(){
  var kind = Math.random();
  if(kind < 0.4){
    var a = rnd(3, 12), b = rnd(3, 12), r = a * b;
    return mk("长方形长 " + a + "cm、宽 " + b + "cm，面积是多少？", r + "cm²", numOpts(r, 4, Math.max(4, r * 0.2)).map(function(x){ return x + "cm²"; }),
      "长方形长" + numSay(a) + "厘米宽" + numSay(b) + "厘米，面积是多少");
  }
  var s = rnd(3, 12), r2 = s * s;
  return mk("正方形边长 " + s + "cm，面积是多少？", r2 + "cm²", numOpts(r2, 4, Math.max(4, r2 * 0.2)).map(function(x){ return x + "cm²"; }),
    "正方形边长" + numSay(s) + "厘米，面积是多少");
},
polyarea: function(){
  var kind = rnd(0, 2);
  if(kind === 0){
    var a = rnd(4, 15), h = rnd(3, 12), r = a * h;
    return mk("平行四边形底 " + a + "cm、高 " + h + "cm，面积是多少？", r + "cm²", numOpts(r, 4, Math.max(4, r * 0.2)).map(function(x){ return x + "cm²"; }),
      "平行四边形底" + numSay(a) + "厘米高" + numSay(h) + "厘米，面积是多少");
  }
  if(kind === 1){
    var a2 = rnd(4, 15), h2 = rnd(3, 12), r2 = Math.round(a2 * h2 / 2);
    return mk("三角形底 " + a2 + "cm、高 " + h2 + "cm，面积是多少？", r2 + "cm²", numOpts(r2, 4, Math.max(4, Math.max(2, r2) * 0.25)).map(function(x){ return x + "cm²"; }),
      "三角形底" + numSay(a2) + "厘米高" + numSay(h2) + "厘米，面积是多少");
  }
  var up = rnd(2, 10), dn = rnd(4, 14), h3 = rnd(3, 10), r3 = (up + dn) * h3 / 2;
  return mk("梯形上底 " + up + "cm、下底 " + dn + "cm、高 " + h3 + "cm，面积是多少？", r3 + "cm²", numOpts(r3, 4, Math.max(4, r3 * 0.2)).map(function(x){ return x + "cm²"; }),
    "梯形上底" + numSay(up) + "下底" + numSay(dn) + "高" + numSay(h3) + "厘米，面积是多少");
},
cuboid: function(){
  var a = rnd(2, 9), b = rnd(2, 9), c = rnd(2, 9);
  if(Math.random() < 0.5){
    var v = a * b * c;
    return mk("长方体长宽高分别为 " + a + "、" + b + "、" + c + "cm，体积是多少？", v + "cm³", numOpts(v, 4, Math.max(6, v * 0.2)).map(function(x){ return x + "cm³"; }),
      "长方体长" + numSay(a) + "宽" + numSay(b) + "高" + numSay(c) + "厘米，体积是多少");
  }
  var s = rnd(2, 8), v2 = s * s * s;
  return mk("正方体棱长 " + s + "cm，体积是多少？", v2 + "cm³", numOpts(v2, 4, Math.max(6, v2 * 0.2)).map(function(x){ return x + "cm³"; }),
    "正方体棱长" + numSay(s) + "厘米，体积是多少");
},
circle: function(){
  var kind = Math.random() < 0.5;
  var r = pick([1, 2, 3, 4, 5, 6, 8, 10]);
  if(kind){
    var area = (r * r * 3.14).toFixed(2).replace(/\.?0+$/, "");
    return mk("圆的半径 r = " + r + "cm，面积是多少？（π 取 3.14）", area + "cm²",
      shuffle([area + "cm²", (r * r * 3).toFixed(0) + "cm²", (r * 2 * 3.14).toFixed(1) + "cm²", (r * r * 3.14 * 2).toFixed(0) + "cm²"]),
      "圆的半径" + numSay(r) + "厘米，面积是多少");
  }
  var c = (2 * r * 3.14).toFixed(2).replace(/\.?0+$/, "");
  return mk("圆的半径 r = " + r + "cm，周长是多少？（π 取 3.14）", c + "cm",
    shuffle([c + "cm", (r * 3.14).toFixed(1) + "cm", (2 * r * 3).toFixed(0) + "cm", (r * r * 3.14).toFixed(0) + "cm"]),
    "圆的半径" + numSay(r) + "厘米，周长是多少");
},
cylinder: function(){
  var r = pick([1, 2, 3, 5]), h = rnd(2, 10);
  var v = (r * r * 3.14 * h).toFixed(2).replace(/\.?0+$/, "");
  return mk("圆柱底面半径 " + r + "cm、高 " + h + "cm，体积是多少？（π 取 3.14）", v + "cm³",
    shuffle([v + "cm³", (r * r * 3.14).toFixed(1) + "cm³", (r * 2 * 3.14 * h).toFixed(1) + "cm³", (r * r * 3.14 * h * 3).toFixed(0) + "cm³"]),
    "圆柱底面半径" + numSay(r) + "厘米高" + numSay(h) + "厘米，体积是多少");
},
angle: function(){
  var kind = rnd(0, 3);
  var info = [
    { q: "直角是多少度？", a: "90°" },
    { q: "平角是多少度？", a: "180°" },
    { q: "周角是多少度？", a: "360°" },
    { q: "锐角是多少度以内的角？", a: "小于90°" }
  ][kind];
  return mk(info.q, info.a, strOpts(info.a, ["90°", "180°", "360°", "45°", "小于90°", "大于90°"], 4), info.q);
},
tri: function(){
  var kind = rnd(0, 2);
  if(kind === 0) return mk("三角形三个内角和是多少度？", "180°", strOpts("180°", ["90°", "180°", "270°", "360°"], 4), "三角形三个内角和是多少度");
  if(kind === 1){
    var a = rnd(20, 80), b = rnd(20, 80), c = 180 - a - b;
    while(c <= 0){ a = rnd(20, 60); b = rnd(20, 60); c = 180 - a - b; }
    return mk("三角形两个角分别是 " + a + "° 和 " + b + "°，第三个角是多少度？", c + "°", numOpts(c, 4, 15).map(function(x){ return x + "°"; }),
      "三角形两个角是" + numSay(a) + "度和" + numSay(b) + "度，第三个角多少度");
  }
  return mk("三角形任意两边之和（　）第三边", "大于", strOpts("大于", ["大于", "小于", "等于"], 3), "三角形任意两边之和大于还是小于第三边");
},

/* ——— 数与代数其他 ——— */
money: function(){
  var y = rnd(1, 9), j = rnd(1, 9);
  var total = y + j / 10;
  return mk(y + " 元 " + j + " 角 = ? 元", total.toFixed(1), numOpts(total.toFixed(1), 4, 0.9),
    numSay(y) + "元" + numSay(j) + "角，等于几元");
},
compare: function(){
  var m = 20;
  var a = rnd(1, m), b = rnd(1, m);
  while(a === b) b = rnd(1, m);
  var sign = a > b ? ">" : "<";
  return mk(a + " ○ " + b, sign, strOpts(sign, [">", "<", "="], 3), numSay(a) + "和" + numSay(b) + "哪个大");
},
compare1000: function(){
  var a = rnd(100, 9999), b = rnd(100, 9999);
  while(a === b) b = rnd(100, 9999);
  var sign = a > b ? ">" : "<";
  return mk(a + " ○ " + b, sign, strOpts(sign, [">", "<", "="], 3), numSay(a) + "和" + numSay(b) + "哪个大");
},
factor: function(){
  var kind = rnd(0, 2);
  if(kind === 0){
    var n = rnd(12, 60);
    var fac = [], primes = [];
    for(var i = 2; i < n; i++) if(n % i === 0) fac.push(i);
    /* 只有「质因数」才能作为答案，9 不是 27 的质因数 */
    function isPrime(x){ if(x < 2) return false; for(var j = 2; j * j <= x; j++) if(x % j === 0) return false; return true; }
    primes = fac.filter(isPrime);
    if(!primes.length || fac.length < 2) return GEN.factor();
    /* 一个数可能有多个质因数（21 = 3×7），问「哪一个是质因数」会有两个正确答案，
       所以固定问「最小质因数」，答案唯一 */
    var f = Math.min.apply(null, primes);
    var wrongs = fac.filter(function(x){ return x !== f; }).concat([n, 1]);
    return mk(n + " 的最小质因数是多少？", String(f),
      strOpts(String(f), wrongs.map(String), 4),
      numSay(n) + "的最小质因数是多少");
  }
  if(kind === 1){
    var a = pick([4, 6, 8, 9, 10, 12]), b = pick([3, 5, 6, 9, 15]);
    var l = a * b / gcd(a, b);
    return mk(a + " 和 " + b + " 的最小公倍数是多少？", String(l), numOpts(l, 4, Math.max(3, l * 0.3)),
      numSay(a) + "和" + numSay(b) + "的最小公倍数是多少");
  }
  var a2 = pick([12, 18, 24, 30, 36]), b2 = pick([8, 9, 12, 15, 20]);
  var g = gcd(a2, b2);
  return mk(a2 + " 和 " + b2 + " 的最大公因数是多少？", String(g), numOpts(g, 4, 4),
    numSay(a2) + "和" + numSay(b2) + "的最大公因数是多少");
},
percent: function(){
  var kind = rnd(0, 2);
  var base = pick([20, 40, 50, 80, 100, 200]);
  var p = pick([10, 20, 25, 50, 75]);
  if(kind === 0){
    var r = base * p / 100;
    return mk(base + " 的 " + p + "% 是多少？", String(r), numOpts(r, 4, Math.max(3, r * 0.3)),
      numSay(base) + "的百分之" + numSay(p) + "是多少");
  }
  if(kind === 1){
    var part = base * p / 100;
    return mk(part + " 是 " + base + " 的百分之多少？", p + "%", shuffle([p + "%", (100 - p) + "%", (p * 2) + "%", Math.max(5, p - 10) + "%"]),
      numSay(part) + "是" + numSay(base) + "的百分之几");
  }
  var d = pick([0.25, 0.5, 0.75, 0.2]);
  var pc = d * 100 + "%";
  return mk("小数 " + d + " 化成百分数是多少？", pc, strOpts(pc, [pc, (d * 10) + "%", (d * 1000) + "%", (100 - d * 100) + "%"], 4),
    "零点" + (d === 0.25 ? "二五" : d === 0.5 ? "五" : d === 0.75 ? "七五" : "二") + "化成百分数是多少");
},
neg: function(){
  var a = rnd(-20, -1), b = rnd(-20, 20);
  var sign = a < b ? "<" : ">";
  return mk(a + " ○ " + b, sign, strOpts(sign, [">", "<", "="], 3), numSay(a) + "和" + numSay(b) + "哪个大");
},
ratio: function(){
  var a = rnd(1, 6), b = rnd(1, 9), k = rnd(2, 5);
  if(Math.random() < 0.5){
    var x = a * k, y = b * k;
    return mk(x + " : " + y + " 化成最简整数比是多少？", a + " : " + b, strOpts(a + " : " + b, [a + " : " + b, x + " : " + y, (a + 1) + " : " + b, a + " : " + (b + 1)], 4),
      numSay(x) + "比" + numSay(y) + "化成最简整数比是多少");
  }
  /* 比值：分母取能除尽的数，选项用邻近小数，避免出现 3 个选项或分数混排 */
  var bd = pick([2, 4, 5, 8, 10, 20, 25]), ad = rnd(1, 9);
  var v = Math.round(ad / bd * 100) / 100;
  var set = {}; set[String(v)] = 1;
  [1, 2, 3, 4].forEach(function(i){
    var x = Math.round((v + i / bd) * 100) / 100;
    if(x > 0 && Object.keys(set).length < 4) set[String(x)] = 1;
  });
  var gi2 = 1;
  while(Object.keys(set).length < 4){
    set[String(Math.round((v + 0.5 * gi2) * 100) / 100)] = 1; gi2++;
  }
  return mk("比 " + ad + " : " + bd + " 的比值是多少？", String(v), shuffle(Object.keys(set)),
    numSay(ad) + "比" + numSay(bd) + "的比值是多少");
}
};

/* 无参数兜底 */
function genQ(cfg){
  var f = GEN[(cfg && cfg.t)] || GEN.addsub;
  return f(cfg || {});
}

/* 竖式题：把口算生成器的 v 数据取出来，挖一个空 */
function genV(cfg){
  var t = cfg && cfg.t;
  var map = { addsub: "addsub", addsub2: "addsub2", addsub100: "addsub100", addsub1000: "addsub1000",
    mult: "mult", mul1: "mul1", mul2: "mul2", mul3x2: "mul3x2", div: "div", div1: "div1", div2: "div2",
    decadd: "decadd", decmul: "decmul", decdiv: "decdiv" };
  var q = genQ({ t: map[t] || "addsub100", max: cfg && cfg.max });
  if(!q.v) return genV({ t: "addsub100" });
  var v = q.v;
  // 小数题竖式按整数展示去点处理，直接换一道整数题
  if(String(v.a).indexOf(".") >= 0 || String(v.b).indexOf(".") >= 0) return genV({ t: "addsub100" });
  var miss = pick(["r", "b", "op"]);
  if(v.op === "÷") miss = "r";
  var shown = { a: v.a, b: v.b, op: v.op, r: v.r, miss: miss };
  var ans, qtext, say;
  if(miss === "r"){ ans = String(v.r); qtext = numSay(v.a) + OP_SAY[v.op] + numSay(v.b) + "等于几"; }
  /* 挖空在第二行 → 题干必须问第二行，答案才是 v.b */
  else if(miss === "b"){ ans = String(v.b); qtext = numSay(v.a) + OP_SAY[v.op] + "多少等于" + numSay(v.r); }
  else if(miss === "op"){ ans = v.op; qtext = numSay(v.a) + "和" + numSay(v.b) + "运算后得到" + numSay(v.r); }
  else { ans = String(v.a); qtext = numSay(v.a) + OP_SAY[v.op] + numSay(v.b) + "等于几"; }
  var opts = v.op && miss === "op" ? strOpts(ans, ["+", "-", "×", "÷"], 4) : numOpts(ans, 4);
  return mk(qtext, ans, opts, qtext, shown);
}
