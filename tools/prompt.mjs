/* ===================== tools/prompt.mjs · 生字图提示词共享模块 =====================
 * gen-pics.mjs（Pollinations）和 gen-pics-zp.mjs（智谱 CogView-4）必须用同一套画风，
 * 否则两批图混在一个图库里会明显分裂成两种风格。所以模板只在这里写一份。
 *
 * 三段的来历：
 *   STYLE 用户已确认 v1「写实插画」；可用环境变量 PIC_STYLE 覆盖做画风试验
 *   COMP  解决「主体太小 / 背景太杂」—— 生字卡要一眼看清主体
 *   BAN   解决「图里带字」—— 带汉字或拼音的图等于把答案画在题干上，比字卡式 SVG 还糟
 * ========================================================================== */
export const STYLE =
  process.env.PIC_STYLE ||
  "children's primary school Chinese textbook illustration style, cute flat cartoon, simple lovely shapes, soft bright colors, flat with slight shading, clean light background";

export const COMP =
  'square composition, single clear subject centered, filling over 60 percent of the frame, uncluttered';

export const BAN =
  'absolutely no text, no chinese characters, no pinyin, no letters, no numbers, no watermark, no caption, no speech bubble';

/* 英文 subject + 画风模板。CogView-4 对中文 prompt 也吃得下，但 scenes.json 里的
   subject 本来就是英文，直接吃最稳 —— 少了翻译环节，也就少了「翻译歪了」的偏差。 */
export function buildPrompt(subject) {
  return `${STYLE}. Scene: ${subject}. ${COMP}. ${BAN}`;
}

/* 教材图那条路不需要画风，只要「别带字」这一条 —— 用于裁完图后的文字泄露闸门 */
export const HAS_TEXT_QUESTION =
  '这张图里有没有清晰可读的汉字、词语或汉语拼音？只回答 YES 或 NO，不要任何解释。';
