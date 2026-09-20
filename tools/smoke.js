/* ===================== tools/smoke.js · 无浏览器冒烟测试 =====================
 * 用法：node tools/smoke.js
 * 干什么：用 jsdom 把全部 BUILTIN 脚本按 boot.js 的顺序注入，逐个页面、逐个玩法
 *        跑一遍，报告渲染出的 HTML 里有没有 undefined、有没有抛异常。
 * 为什么要有：机顶盒 WebView 里报 JS 错误时没有控制台，肉眼只能看到「页面怪怪的」。
 *        这个脚本能在出包前把「知识圈全是 undefined」这类问题直接拦下来。
 * 注意：它跑的是仓库根 js/ 的源码，不含 boot.js（boot.js 在 APK 里且是冻结文件）。
 * ===================================================================== */
/* 无浏览器冒烟：逐个注入 Bootuild-in 顺序的 js，检查各页面是否出现 undefined */
const fs=require('fs'), path=require('path');
const {JSDOM}=require('jsdom');
const root=__dirname+'/..';
const BUILTIN=["js/cp.js","js/data-c1.js","js/data-c2.js","js/data-c3.js","js/data-c4.js","js/data-c5.js","js/data-c6.js","js/strokes.js","js/data-poem.js","js/data-word.js","js/tts.js","js/praise.js","js/pics.js","js/games.js","js/game-battle.js","js/app.js","js/tv-tune.js","js/tv.js","js/update.js"];
/* ↑ 顺序必须与 js/boot.js 的 BUILTIN 一致（boot.js 是冻结文件、不在本测试范围内，
   这里手抄一份）。tv-tune.js 必须在 tv.js 之前，否则 applyScale 读不到调参表。 */
const dom=new JSDOM(fs.readFileSync(root+'/index.html','utf8').replace('<script src="js/boot.js"></script>',''),{runScripts:'dangerously',pretendToBeVisual:true,url:'http://local.test/index.html'});
const w=dom.window;
// 模拟 TV + 无 speechSynthesis
Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 8.0; MiTV) AppleWebKit/537.36 Chrome/62',configurable:true});
w.__dev={tv:true,sw:1920,touch:false,mic:false,apk:6,native:true};
/* jsdom 不做布局：offsetParent 恒为 null，tv.js 里每一处「元素可见吗」的判断都会
   判成不可见，焦点逻辑等于没跑 —— 焦点相关的回归测试会变成假通过。
   这里补一个近似实现：处于 .hidden 子树里的元素仍返回 null（跟真机一致），
   其余返回父节点。只为让焦点回归有效，不追求布局精度。 */
Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{configurable:true,get:function(){
  if(this===w.document.body||this===w.document.documentElement) return null;
  var p=this.parentNode;
  while(p&&p.nodeType===1){
    if(String(p.className||'').indexOf('hidden')>=0) return null;
    p=p.parentNode;
  }
  return (this.parentNode&&this.parentNode.nodeType===1)?this.parentNode:w.document.body;
}});
const errs=[];
w.addEventListener('error',e=>errs.push('window error: '+e.message));
for(const f of BUILTIN){
  try{ const s=w.document.createElement('script'); s.textContent=fs.readFileSync(root+'/'+f,'utf8'); w.document.body.appendChild(s); }
  catch(e){ console.log('EVAL FAIL '+f+': '+e.message); errs.push(f+': '+e.message); }
}
function chk(tag){
  const app=w.document.getElementById('app');
  const h=app?app.innerHTML:'';
  const n=(h.match(/undefined/g)||[]).length;
  console.log(tag.padEnd(22)+' len='+h.length+'  undefined×'+n);
  if(n){ h.split('\n').forEach(l=>{ if(/undefined/.test(l)) console.log('   > '+l.trim().slice(0,180)); }); }
  return h;
}
try{ w.render&&w.render(); }catch(e){ console.log('render fail: '+e.message+'\n'+e.stack.split('\n').slice(0,3).join('\n')); }
chk('home');
try{ w.state.view='grades'; w.render(); }catch(e){ console.log('grades fail '+e.message); }
chk('grades');
try{ w.state.gi=0; w.state.bi=0; w.state.ui=0; w.state.view='units'; w.render(); }catch(e){ console.log('units fail '+e.message); }
chk('units');
try{ w.state.view='modes'; w.render(); }catch(e){ console.log('modes fail '+e.message); }
const modesHtml=chk('modes');
console.log('   GAMES='+(w.GAMES||[]).map(g=>g.id).join(','));
// 逐个玩法启动
const list=(w.GAMES&&w.GAMES.length)?w.GAMES:[];
for(const g of list){
  try{
    w.state.mode=g.id; w.state.view='game';
    g.start();
    chk('game:'+g.id);
  }catch(e){ console.log('game '+g.id+' THROW: '+e.message); }
}
console.log('--- errors ---'); console.log(errs.slice(0,10).join('\n')||'(none)');

/* ---- 深挖知识圈：连玩 40 题，记录含 undefined 的题面 ---- */
console.log('\n=== battle deep ===');
try{
  let bad=0;
  for(let round=0; round<12; round++){
    try{ w.startGame('battle'); }catch(e){ console.log('start battle fail: '+e.message); break; }
    for(let i=0;i<12;i++){
      const before=w.document.getElementById('app').innerHTML;
      try{ w.battleAnswer(i%4); }catch(e){ console.log('answer ERR '+e.message); }
      const h=w.document.getElementById('app').innerHTML;
      if(/undefined/.test(h)){ bad++; const m=h.match(/.{0,80}undefined.{0,60}/); console.log('  undefined >> '+String(m&&m[0]).replace(/\s+/g,' ').slice(0,160)); }
      if(/再来一局/.test(h)) break;
    }
  }
  console.log('bad rounds='+bad);
}catch(e){ console.log('deep fail: '+e.message); }

/* ---- 回归：退出知识圈后，计时器不许再抢回界面 ----
 * 真机 bug：点了返回 → 回到玩法列表 → 倒计时一到，渲染又把界面刷回知识圈。
 * 根因是玩法自己的 setInterval 没被清掉。这里等 3 秒（大于题目的 1.7s 推进间隔 +
 * 15s 倒计时的一部分）确认界面一直停在玩法列表。 */
console.log('\n=== battle exit regression ===');
(async function () {
  const app = () => w.document.getElementById('app').innerHTML;
  try {
    w.startGame('battle');
    if (!/\.battle|b-opt/.test(app())) { console.log('  ❌ 知识圈没起来'); return; }
    /* 模拟遥控器返回 / 原生返回键：goBack() → __gameExit() */
    w.goBack();
    const afterBack = app();
    const left = /b-opt/.test(afterBack);
    console.log('  返回后仍在知识圈: ' + (left ? '❌ 是' : '✅ 否'));
    console.log('  state.view=' + w.state.view);
    await new Promise(r => setTimeout(r, 3000));
    const now = app();
    const back = /b-opt/.test(now);
    console.log('  3 秒后是否被抢回知识圈: ' + (back ? '❌ 是（计时器泄漏）' : '✅ 否'));
    console.log('  state.view=' + w.state.view + '   __gameExit=' + (typeof w.__gameExit));
  } catch (e) { console.log('  regression fail: ' + e.message); }

  /* ---- 回归：遥控器三件套（设置弹层 / 焦点复位 / 确认键去重） ---- */
  console.log('\n=== tv remote regression ===');
  const doc = w.document;
  const modal = doc.getElementById('settingsModal');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const act = () => doc.activeElement;
  const inModal = (el) => !!(el && modal && modal.contains(el));

  try {
    // ① 打开设置 → 焦点必须进弹层，且返回键关掉的是弹层而不是退页面
    w.state.view = 'modes'; w.render();
    await sleep(30);
    w.openSettings();
    await sleep(60);
    console.log('  设置打开后焦点在弹层内: ' + (inModal(act()) ? '✅ 是' : '❌ 否（会跑到背景页面）'));
    const viewBefore = w.state.view;
    w.goBack();          // 模拟遥控器返回
    await sleep(30);
    const closed = String(modal.className).indexOf('hidden') >= 0;
    console.log('  返回键关掉了设置: ' + (closed ? '✅ 是' : '❌ 否'));
    console.log('  页面没有被一起退回: ' + (w.state.view === viewBefore ? '✅ 是' : '❌ 否（' + viewBefore + '→' + w.state.view + '）'));

    // ② 视图切换后焦点不能停在顶栏的设置/返回按钮上
    //    覆盖两大类：菜单页（home/grades/units/modes）+ 玩法页（startGame 进的界面）。
    //    用户报的「有些界面」多半是玩法页 —— 只测菜单页会漏。
    const isTopbar = (el) => {
      let p = el, i = 0;
      while (p && p.nodeType === 1 && i < 5) {
        if (String(p.className || '').indexOf('topbar') >= 0) return true;
        p = p.parentNode; i++;
      }
      return false;
    };
    let onGear = 0, checked = 0;
    const checkView = async (label) => {
      await sleep(40);
      const a = act();
      checked++;
      if (a && (String(a.className || '').indexOf('gear') >= 0 || isTopbar(a))) {
        onGear++;
        console.log('    ❌ ' + label + ' 的焦点落在顶栏按钮上（' + (a.className || a.tagName) + '）');
      }
    };
    for (const v of ['home', 'grades', 'units', 'modes']) {
      w.state.view = v; w.render();
      await checkView(v);
    }
    // 玩法页：跳过 write（jsdom 没 canvas 会抛）
    for (const gid of ['listen', 'picture', 'pinyin', 'wordfill', 'stroke', 'poemfill', 'battle']) {
      try { w.startGame(gid); } catch (e) { continue; }
      await checkView('game:' + gid);
    }
    console.log('  各界面焦点落在顶栏按钮: ' + (onGear ? '❌ ' + onGear + '/' + checked : '✅ 0/' + checked));

    /* ②a-2 顶栏方向键可达性（2.4.1 修「遥控器点不到热更按钮」）：
       home 页从左到右应依次经过 ←(或占位) / 🛠️ 热更 / ⚙️ 设置；
       逐个按 → 必须能走到 🛠️，这是用户唯一能进的更新入口。
       原来 🛠️ 是 body 上的飘浮圆钮，这条断言会失败 —— 正是要防的回归。 */
    try {
      w.state.view = 'home'; w.render(); await sleep(60);
      const gears = [...doc.querySelectorAll('#app .topbar .gear')];
      const hot = doc.querySelector('#app .topbar .gear.hot');
      console.log('  顶栏按钮数（应为 2：🛠️ + ⚙️）: ' + gears.length);
      if (!hot) {
        console.log('  ❌ 顶栏没有 🛠️ 热更入口');
      } else {
        /* 两个方向都要能走到：① 从内容按「上」直接吸附顶栏；
           ② 到顶栏后按「←」在顶栏内部横向移动。 */
        const seen = [];
        let reach = false;
        const dump = (tag, a) => seen.push(tag + (a ? (a.className || a.tagName) : 'null'));
        /* jsdom 不做布局：getBoundingClientRect 全返回 0，方向键最近邻会退化成
           「挑第一个」，焦点回归会假通过（2.4.1 排查「遥控器点不到热更按钮」时踩过）。
           这里给三个关键角色铺一层最小可信的几何：顶栏横条在上、🛠️/⚙️ 在顶栏右侧、
           内容按钮在中部。只服务焦点测试，不追求真实布局精度。 */
        const _rect = w.Element.prototype.getBoundingClientRect;
        w.Element.prototype.getBoundingClientRect = function () {
          const cl = (this.classList && this.classList) || null;
          if (cl && cl.contains('topbar')) return { left: 0, top: 0, right: 1200, bottom: 60, width: 1200, height: 60, x: 0, y: 0 };
          if (cl && cl.contains('gear')) {
            const isHot = cl.contains('hot');
            return { left: isHot ? 1000 : 1080, top: 8, right: isHot ? 1080 : 1152, bottom: 52, width: 80, height: 44, x: 0, y: 0 };
          }
          if (this.tagName === 'BUTTON') return { left: 400, top: 300, right: 800, bottom: 360, width: 400, height: 60, x: 0, y: 0 };
          return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
        };
        req = (key) => ({
          dispatch: () => { w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })); },
        });        for (let i = 0; i < 3 && !reach; i++) {
          req('ArrowUp').dispatch();
          await sleep(30);
          const a = act(); dump('↑', a);
          if (a === hot) reach = true;
        }
        for (let i = 0; i < 4 && !reach; i++) {
          req('ArrowLeft').dispatch();
          await sleep(30);
          const a = act(); dump('←', a);
          if (a === hot) reach = true;
        }
        w.Element.prototype.getBoundingClientRect = _rect;
        console.log('  方向键走到 🛠️ 热更入口: ' + (reach ? '✅ 可以' : '❌ 走不到 → ' + seen.join(' / ')));
      }
    } catch (e) { console.log('  顶栏可达性检查异常: ' + e.message); }

    /* ②a-3 回归：TV 遥控器两大「困死」场景（2026-09-20 用户反馈）
       ① 打开设置后按返回关不掉，只能摸到「完成」按钮；
       ② 焦点进入语速滑块 / 备份文本框后出不来，只能杀进程重开。
       共同根因是 js/tv.js 里那句 `if (act.tagName === "INPUT") return;` ——
       一进表单控件，四个方向键全部放行，导航彻底停摆。
       现在规则是：左右键留给控件调值，上下键一律跳出；返回键全程优先。 */
    try {
      const modalEl = doc.getElementById('settingsModal');
      const isHidden = () => String(modalEl.className).indexOf('hidden') >= 0;
      const press = (key, type) => {
        w.document.dispatchEvent(new w.KeyboardEvent(type || 'keydown', { key, bubbles: true }));
      };
      const pressCode = (keyCode, type) => {
        const ev = new w.KeyboardEvent(type || 'keydown', { key: 'Unidentified', bubbles: true });
        Object.defineProperty(ev, 'keyCode', { get: () => keyCode, configurable: true });
        Object.defineProperty(ev, 'which', { get: () => keyCode, configurable: true });
        w.document.dispatchEvent(ev);
      };

      /* ① 弹层开着 + 焦点在输入框里 → 各种形态的返回键都能关掉它 */
      const range = doc.getElementById('rateRange');
      const backup = doc.getElementById('backupBox');
      const scenarios = [
        ['Escape 键', (type) => press('Escape', type)],
        ['GoBack 键', (type) => press('GoBack', type)],
        ['Backspace 键', (type) => press('Backspace', type)],
        ['keyCode 4', (type) => pressCode(4, type)],
        ['keyCode 461', (type) => pressCode(461, type)],
        ['keyCode 0 + Unidentified', (type) => pressCode(0, type)],
      ];
      let backOk = 0;
      const failed = [];
      for (const [label, fire] of scenarios) {
        for (const target of [range, backup]) {
          w.openSettings(); await sleep(40);
          if (isHidden()) { failed.push(label + '（弹层没打开）'); continue; }
          try { target.focus(); } catch (e) {}
          fire('keydown');
          await sleep(40);
          if (isHidden()) backOk++; else failed.push(label + '@' + (target.id || target.tagName));
        }
      }
      console.log('  设置弹层可被返回键关闭: ' + (failed.length ? '❌ ' + failed.join(', ')
        : '✅ ' + backOk + '/' + (scenarios.length * 2) + ' 种返回键形态全部可关'));

      /* ② keyup 兜底：固件只在抬键时把返回键交给 WebView 的情况。
         先等出去重窗口（350ms），模拟「用户独立地按了一次返回」而不是和上一步连在一起。
         真实连按路径走的始终是 keydown（tryBack 会先处理），去重窗口影响不到它。 */
      await sleep(400);
      w.openSettings(); await sleep(40);
      try { range.focus(); } catch (e) {}
      press('Escape', 'keyup');
      await sleep(40);
      console.log('  返回键仅在 keyup 派发时也能关闭: ' + (isHidden() ? '✅ 是' : '❌ 否'));

      /* ③ 焦点困死回归：滑块里按「下」必须能跳出去 */
      w.openSettings(); await sleep(60);
      try { range.focus(); } catch (e) {}
      let escaped = false;
      const before = act();
      for (let i = 0; i < 4 && !escaped; i++) {
        press('ArrowDown'); await sleep(40);
        const a = act();
        if (a !== before && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ''))) escaped = true;
      }
      console.log('  焦点能从滑块跳出来: ' + (escaped ? '✅ 是' : '❌ 否（会困死）'));
      /* ④ 导出备份不能把焦点抢进文本框（TV 上等于把遥控器锁死） */
      w.openSettings(); await sleep(40);
      try { w.exportProgress(); } catch (e) {}
      await sleep(40);
      const af = act();
      const trapped = af && /^(INPUT|TEXTAREA|SELECT)$/.test(af.tagName || '');
      console.log('  导出备份未把焦点锁进文本框: ' + (trapped ? '❌ 焦点的 still 在 ' + (af.id || af.tagName) : '✅ 是'));
      if (!isHidden()) w.closeSettings();

      /* ⑤ 一次按键只能退一层：keydown 关掉弹层后，紧接着的 keyup 不能再触发一次 doBack()。
         不打时间戳去重的话，表现为「按一下返回，设置关了连着又把背后的页面也退掉了」。 */
      w.openSettings(); await sleep(40);
      let tvBackCalls = 0;
      const origTvBack = w.tvBack;
      w.tvBack = function () { tvBackCalls++; return true; };
      try { range.focus(); } catch (e) {}
      press('Escape', 'keydown'); await sleep(30);
      press('Escape', 'keyup'); await sleep(30);
      try { w.tvBack = origTvBack; } catch (e) { delete w.tvBack; }
      console.log('  一次返回键只关一层（不连带退页）: '
        + (tvBackCalls === 0 ? '✅ 是' : '❌ 否，多退了 ' + tvBackCalls + ' 层'));
      if (!isHidden()) w.closeSettings();
    } catch (e) { console.log('  表单控件 / 返回键回归异常: ' + e.message); }

    // ②b 真实路径：在设置里改完 → 按返回关掉 → 再进下一个界面。
    //    旧 bug 就出在这条路上：关掉弹层后 activeElement 还留在弹层残留节点里，
    //    ensureFocus 一看「已经有焦点」就跳过，新页面的焦点永远设不上。
    w.state.view = 'modes'; w.render(); await sleep(30);
    w.openSettings(); await sleep(50);
    w.goBack(); await sleep(50);
    w.state.view = 'units'; w.render(); await sleep(50);
    const afterModal = act();
    const stuck = !afterModal || afterModal === doc.body || isTopbar(afterModal) ||
                  (modal && modal.contains(afterModal));
    console.log('  关掉设置后进入新界面，焦点已复位: ' + (stuck ? '❌ 否（还停在 ' + (afterModal ? (afterModal.className || afterModal.tagName) : 'null') + '）' : '✅ 是'));

    // ③ 确认键：一次按下只能点一次（连发 repeat 与补发都要被吃掉）
    w.state.view = 'modes'; w.render();
    await sleep(30);
    const card = doc.querySelector('.mode-card');
    if (card && card.focus) {
      card.focus();
      let hits = 0;
      const orig = card.onclick;
      card.onclick = function () { hits++; };
      const key = (rep) => {
        const e = new w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
        try { Object.defineProperty(e, 'repeat', { value: !!rep }); } catch (err) {}
        doc.dispatchEvent(e);
      };
      key(false);                    // 正常按一次
      const one = hits;
      await sleep(260);              // 过了防抖窗口
      key(false);                    // 再按一次（应生效）
      const two = hits;
      await sleep(260);
      key(true); key(true);          // 长按连发（应被 e.repeat 吃掉）
      const three = hits;
      console.log('  按一次触发 ' + one + ' 次（应为 1）: ' + (one === 1 ? '✅' : '❌'));
      console.log('  再按一次共 ' + two + ' 次（应为 2）: ' + (two === 2 ? '✅' : '❌'));
      console.log('  长按连发后 ' + three + ' 次（应仍为 2）: ' + (three === 2 ? '✅' : '❌'));
      card.onclick = orig;
    } else {
      console.log('  （找不到 .mode-card，跳过确认键去重检查）');
    }
  } catch (e) { console.log('  tv regression fail: ' + e.message + '\n' + String(e.stack).split('\n')[1]); }
  process.exit(0);
})();
