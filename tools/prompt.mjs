/* ===================== tools/prompt.mjs · 生字图提示词共享模块 =====================
 * gen-pics.mjs（Pollinations）和 gen-pics-zp.mjs（智谱 CogView-4）必须用同一套画风，
 * 否则两批图混在一个图库里会明显分裂成两种风格。所以模板只在这里写一份。
 *
 * 2026-09-19 重写：第一批图出来后反馈「有些画风成恐怖元素、背景太杂」。
 * 复盘根因是旧模板太软 —— 只说了 "cute flat cartoon" 和 "uncluttered"，
 * 模型一会儿滑向半写实动漫脸（死鱼眼、阴郁），一会儿塞进一整片风景当背景。
 * 所以现在把「画风 / 背景 / 安全」拆成三条硬约束，每条都写死反例。
 * ========================================================================== */

/* ① 画风：写死"扁平矢量卡通"，并把所有会跑偏的方向全部点名排除 */
export const STYLE =
  process.env.PIC_STYLE ||
  "flat vector cartoon illustration for young children, thick uniform dark outline, " +
    "simple rounded geometric shapes, solid flat colour fills, cute chibi proportions, " +
    "friendly simple face with round dot eyes and a gentle smile, " +
    "NOT realistic, NOT semi-realistic, NOT anime, NOT 3D render, NOT photo, " +
    "NO gradient shading, NO soft-focus, NO painterly texture";

/* ② 背景：纯色、全空。旧的 "uncluttered" 太软，模型会塞进天空/草地/房间当背景 */
export const BG =
  "plain single soft pastel-colour background, completely empty, " +
    "NO scenery, NO landscape, NO room, NO furniture, NO props, NO extra objects, " +
    "NO texture, NO pattern, NO gradient, NO vignette, NO frame";

/* ③ 安全：给 6 岁孩子看的，恐怖元素零容忍 */
export const SAFE =
  "cheerful, warm, safe and reassuring for a six-year-old, " +
    "absolutely NOT scary, creepy, eerie, gloomy, moody, uncanny or unsettling, " +
    "no blood, no injury, no monster, no ghost, no skeleton, no sharp teeth, " +
    "no dramatic shadows, no dark or nightmarish atmosphere";

/* ④ 构图：单个主体居中，四周留白 */
export const COMP =
  "exactly ONE single subject, centred, filling about 70 percent of the frame, " +
    "generous empty margin around it, nothing else in the picture";

/* ⑤ 一如既往：图里不许出现任何文字（带汉字 = 把答案画在题干上） */
export const BAN =
  "absolutely no text, no chinese characters, no pinyin, no letters, no numbers, " +
    "no watermark, no caption, no speech bubble";

/* ⑥ 高风险字定点改写：情绪/氛围字最容易跑成半写实阴森脸（「悲」实测连废 4 张）。
   办法不是加更多"别吓人"——而是**别画脸**，改画一个具体的、一眼能认出情绪的可爱场景。
   只有字卡式的字才必须写真图，所以这份表只覆盖那些逃不掉的字。 */
export const OVERRIDES = {
  悲: 'a cute cartoon rain cloud dropping tiny blue drops onto one small wilting flower in a pot',
  忧: 'a cute cartoon child looking at a small cracked flower pot with a mild concerned look, still cute and calm',
  怕: 'a cute cartoon child hiding behind a big soft pillow with only the eyes peeking out, mild surprised look, not frightening',
  怒: 'a cute cartoon child with puffed cheeks and crossed arms, sulking comically, not scary',
  暗: 'a deep blue night sky with a smiling crescent moon and a few friendly stars',
  险: 'a cute cartoon child carefully balancing on a wobbly log bridge over a small stream, arms out for balance',
  艰: 'a cute cartoon child climbing a small grassy hill with effort and a determined smile',
  哭: 'a cute cartoon child with two big shiny cartoon teardrops and a comical wailing mouth, still cute',
  黑: 'a cute fluffy black cartoon cat with big friendly round eyes',
};

/* 真正生效的画风后缀 —— buildPrompt() 用它。
   ⚠️ 2026-09-19 修：以前 STYLE/BG/SAFE/COMP/BAN 五个常量全是死代码、从未被引用，
      gen-pics.mjs 注释里宣称的 PIC_STYLE="..." node tools/gen-pics.mjs 设了根本没用。
      现在把 PIC_STYLE 修活，以后调画风不用改代码：PIC_STYLE="..." 即可 A/B。
   ⚠️ 整段控制在 ~300 字符：实测超长会被模型截断/稀释，画风词就白写了。 */
export const STYLE_TAIL =
  process.env.PIC_STYLE ||
  'Flat vector cartoon for young children. Thick even dark outline, solid flat colour fills, ' +
    'no gradient no shading. Plain empty pastel background, no scenery no props. ' +
    'One simple centred subject filling most of frame. Cute cheerful, not scary, ' +
    'not realistic, not anime, not 3D, no text no letters no numbers.';

export function buildPrompt(subject, z) {
  const s = (z && OVERRIDES[z]) || subject;
  /* ⚠️ 顺序是生死线：Subject 必须放最前面。
     第一版把画风写在前、主体写在后，结果「悲」明明改写成「雨云浇蔫花」，
     出来的还是同一张写实少女脸 —— prompt 太长时后面的主体词根本没送到模型那里。
     整段压到 300 字符左右，太长会被截断/稀释。 */
  return `${s}. ${STYLE_TAIL}`;
}

/* 教材图那条路不需要画风，只要「别带字」这一条 —— 用于裁完图后的文字泄露闸门 */
export const HAS_TEXT_QUESTION =
  '这张图里有没有清晰可读的汉字、词语或汉语拼音？只回答 YES 或 NO，不要任何解释。';

/* 画风闸门不在这里 —— 已独立成 tools/style-gate.mjs（生成即时判 + 存量复查共用一套）。
   2026-09-19：原来的三合一复合题被证明不可用（免费模型答不了，165 张判废 156 张，
   理由全是「没有穿鞋」「没用中文字体」这类幻觉，还放行了带汉字的「写」），
   已拆成 4 道二元题。要改判据请改 style-gate.mjs 的 GATE_ITEMS。 */
