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
const BUILTIN=["js/cp.js","js/data-c1.js","js/data-c2.js","js/data-c3.js","js/data-c4.js","js/data-c5.js","js/data-c6.js","js/strokes.js","js/data-poem.js","js/data-word.js","js/tts.js","js/praise.js","js/pics.js","js/games.js","js/game-battle.js","js/app.js","js/tv.js","js/update.js"];
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
    let onGear = 0, checked = 0;
    for (const v of ['home', 'grades', 'units', 'modes']) {
      w.state.view = v; w.render();
      await sleep(30);
      const a = act();
      checked++;
      if (a && String(a.className || '').indexOf('gear') >= 0) { onGear++; console.log('    ❌ ' + v + ' 的焦点落在设置按钮上'); }
    }
    console.log('  各界面焦点落在设置按钮: ' + (onGear ? '❌ ' + onGear + '/' + checked : '✅ 0/' + checked));

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
