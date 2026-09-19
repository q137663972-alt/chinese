/* ===================== 内容包加载器（Content Pack Loader） =====================
 * S1 阶段：只做「幂等挂载」。零网络、零副作用 —— 装上和没装行为完全一致。
 * S4 阶段会整体替换为本文件的完整版（补 apply / ok / start / IndexedDB 缓存）。
 *
 * 两个铁律：
 *   1. 本文件必须在 data-*.js 之前加载，否则 CP is undefined → 数据文件走兜底。
 *   2. 年级列表由本加载器独占持有（_list），不能依赖 window.GRADES ——
 *      因为 app.js 顶层的 `var GRADES` 会在脚本执行时把 window.GRADES 覆盖掉。
 * =========================================================================== */
(function(){
  "use strict";
  if (window.CP) return;                                  // 重复注入保护

  // 沿用已有数组（若存在），否则新建。之后只用 _list，不再读 window.GRADES。
  var _list = (window.GRADES &&
               Object.prototype.toString.call(window.GRADES) === "[object Array]")
              ? window.GRADES : [];
  window.GRADES = _list;                                  // 初次镜像，方便兜底路径

  window.CP = {
    version: 1,

    /* 年级列表的唯一来源。app.js 的 setGrades() 从这里取数据。 */
    list: function(){ return _list; },

    /* 按 g 原地替换，不存在才追加。
       远程分片重复注入同一年级时，不会出现两个同 g 的年级。 */
    setGrade: function(g){
      if (!g || typeof g.g === "undefined") return null;
      for (var i = 0; i < _list.length; i++){
        if (_list[i] && _list[i].g === g.g){ _list[i] = g; return g; }
      }
      _list.push(g);
      return g;
    },

    /* 以下为 S4 占位，当前均为安全空操作 */
    apply: function(){ return false; },   // 应用远程分片
    ok:    function(){ return false; },   // 哨兵校验
    start: function(){}                   // 拉 manifest
  };
})();
