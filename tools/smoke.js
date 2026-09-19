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
