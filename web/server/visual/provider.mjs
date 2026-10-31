/**
 * 第 3–4 步的 **provider 边界**：这里是「文字规范 ↔ 出图片」两种做法的唯一切换点。
 *
 * 契约留了一个歧义（`用户链路契约-五步-2026-10-31.md` 的歧义 A）：
 * 第 3–4 步的产物到底是「文字风格规范」还是「图片」？
 * 本实现**先按成本最低的做**（结构化文字，0 张图/次），并把改成出图片的能力
 * 收在同一个函数边界里，切换只动一个环境变量：
 *
 *   GIFTWISE_STYLE_DIRECTION_CHANNEL = rules | llm_text | image     （默认 llm_text，无凭证时 rules）
 *
 * ── 三条通道各自是什么 ───────────────────────────────────────────────────
 * `rules`     纯确定性推导，**不发任何请求**。硬测试与离线回归用这条。
 * `llm_text`  （默认）确定性推导仍然**权威**（主色/辅色/材质/禁项全部由它锁定），
 *             只额外调用一次文本模型做**措辞润色**（关键词与视觉基调的一句话）。
 *             润色结果要过同一套校验：命中禁项、超长、结构不符一律**丢弃**
 *             并如实记账（`model_polish.applied=false`），绝不覆盖用户偏好。
 *             ⚠️ 这是对契约「由生图模型决定」的**文字替身**，响应里会带
 *             `channel_note` 明说这件事，不冒充生图模型的产物。
 * `image`     真去调用生图模型出一张**风格看板图**（包装风格 + 色彩方向的视觉呈现）。
 *             结构化方向仍然由 rules 核心产出（这样第 5 步与测试仍可断言、可追溯），
 *             图片作为**附加产物**随响应返回（`style_board`）。
 *             ⚠️ 默认关闭：开一次 = 每次运行多 1 张图。切换只需把上面那个变量设成 `image`。
 *
 * ── 无论哪条通道都不变的三件事 ───────────────────────────────────────────
 * 1. 主色/辅色/材质/视觉基调/禁项**只**来自 `deriveDirectionCore()`；
 * 2. 被禁的词绝不进入方向对象（`validateDirection()` 会拦住）；
 * 3. 第 5 步的生图 prompt 只读这份方向（`directionPromptText()`）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VISUAL_DIRECTION_VERSION,
  deriveDirectionCore,
  directionPromptText,
  extractSignals,
  validateDirection,
} from './direction.mjs';
import { conceptById, matchConcepts } from './lexicon.mjs';
import { hasLlmConfig, llmConfig, STYLE_DIRECTION_CONFIG } from '../config.mjs';

export const STYLE_DIRECTION_CHANNELS = Object.freeze(['rules', 'llm_text', 'image']);

export const CHANNEL_NOTES = Object.freeze({
  rules: '第 3–4 步由服务端规则确定性推导（未调用任何模型）；主色、辅色、材质与视觉基调全部可指回 intake 字段。',
  llm_text:
    '第 3–4 步的**结构**由服务端规则确定性推导，文本模型只做措辞润色（契约里「由生图模型决定」在此以文字替身实现，未出图）。' +
    '润色若命中用户禁忌或结构不符会被丢弃，主色、辅色、材质、禁项永远以规则结果为准。',
  image:
    '第 3–4 步额外调用了一次生图模型，产出**风格看板图**；结构化方向仍由服务端规则产出，' +
    '以保证每个要素都能指回 intake 字段（图片本身无法被断言）。',
});

export const STYLE_BOARD_DIR = fileURLToPath(new URL('../../../.tmp/style-boards/', import.meta.url));

function hash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 润色结果的结构与安全校验（只允许改措辞，不允许改数值）。 */
export function checkModelPolish(polish, direction) {
  if (!polish || typeof polish !== 'object' || Array.isArray(polish)) return { ok: false, code: 'POLISH_STRUCTURE' };
  const bannedWords = (direction.prohibitions ?? [])
    .flatMap((entry) => {
      const concept = conceptById(entry.concept_id);
      return concept ? [concept.zh, ...concept.aliases] : [];
    })
    .filter((word) => typeof word === 'string' && word.length > 1);
  const texts = [];
  if (polish.keywords !== undefined) {
    if (!Array.isArray(polish.keywords) || polish.keywords.length > 8 || polish.keywords.some((item) => typeof item !== 'string' || !item.trim() || [...item].length > 40)) {
      return { ok: false, code: 'POLISH_KEYWORDS' };
    }
    texts.push(...polish.keywords);
  }
  if (polish.visual_tone !== undefined) {
    const tone = polish.visual_tone;
    const zh = tone && typeof tone === 'object' ? tone.zh : tone;
    if (typeof zh !== 'string' || !zh.trim() || [...zh].length > 200) return { ok: false, code: 'POLISH_TONE' };
    texts.push(zh);
  }
  if (polish.materials !== undefined) {
    if (!Array.isArray(polish.materials) || polish.materials.length > 6 || polish.materials.some((item) => typeof item !== 'string' || !item.trim() || [...item].length > 60)) {
      return { ok: false, code: 'POLISH_MATERIALS' };
    }
    texts.push(...polish.materials);
  }
  if (texts.length === 0) return { ok: false, code: 'POLISH_EMPTY' };
  for (const text of texts) {
    for (const word of bannedWords) {
      if (text.includes(word)) return { ok: false, code: 'POLISH_HITS_PROHIBITION', word: conceptById(word) ? word : word };
    }
  }
  return { ok: true };
}

/** 把通过校验的润色合并进方向：`based_on` 一律保留核心推导给的出处。 */
export function mergePolish(direction, polish) {
  const merged = structuredClone(direction);
  const anchor = merged.keywords?.[0]?.based_on ?? merged.visual_tone?.based_on ?? { field: 'request.recipient_relation', value: '未提供' };
  if (Array.isArray(polish.keywords) && polish.keywords.length) {
    const existing = new Set(merged.keywords.map((item) => item.text));
    for (const text of polish.keywords) {
      if (existing.has(text)) continue;
      merged.keywords.push({ text, concept_id: null, based_on: { field: anchor.field, value: anchor.value }, source: 'model_polish' });
    }
    merged.keywords = merged.keywords.slice(0, 12);
  }
  if (polish.materials !== undefined && Array.isArray(polish.materials) && polish.materials.length) {
    const existing = new Set(merged.materials.map((item) => item.zh));
    for (const zh of polish.materials) {
      if (existing.has(zh)) continue;
      merged.materials.push({ zh, concept_id: null, based_on: { field: anchor.field, value: anchor.value }, source: 'model_polish' });
    }
    merged.materials = merged.materials.slice(0, 8);
  }
  if (polish.visual_tone !== undefined) {
    const zh = typeof polish.visual_tone === 'object' ? polish.visual_tone.zh : polish.visual_tone;
    if (typeof zh === 'string' && zh.trim()) merged.visual_tone = { ...merged.visual_tone, zh, source: 'model_polish' };
  }
  return merged;
}

export class VisualDirectionProvider {
  /**
   * @param {{
   *   llm?: {invoke: Function}|null,
   *   imageTransport?: {generate: Function, available?: Function}|null,
   *   storeBoard?: Function|null,
   *   config?: Function,
   * }} deps
   */
  constructor(deps = {}) {
    this.llm = deps.llm ?? null;
    this.imageTransport = deps.imageTransport ?? null;
    this.storeBoard = deps.storeBoard ?? saveStyleBoard;
    this.config = deps.config ?? STYLE_DIRECTION_CONFIG;
  }

  /**
   * 推导第 3–4 步的包装风格与色彩视觉方向。
   * @returns {Promise<{ok:true, direction:object, channel:string, notices:string[], model_polish:object, style_board:object|null}>}
   */
  async derive({ intake = {}, request = {}, candidates = [], runId = null } = {}) {
    const cfg = typeof this.config === 'function' ? this.config() : this.config;
    let channel = cfg.channel;
    if (channel === 'llm_text' && !(cfg.llmEnabled && hasLlmConfig() && this.llm)) channel = 'rules';
    if (channel === 'image' && !(cfg.imageEnabled && this.imageTransport?.available?.() === true)) channel = 'rules';

    const notices = [CHANNEL_NOTES[channel]];
    /* 只有**真的发生了降级**才提示：`requestedChannel` 为空表示"未指定"，
       此时按默认偏好（有凭证走 llm_text）执行，不是降级 —— 早期版本在这里误报
       「本次没有发起对应的真实调用」，与账本里真实存在的 style_direction 记录矛盾。 */
    const preferredChannel = cfg.requestedChannel ?? (hasLlmConfig() && cfg.llmEnabled && this.llm ? 'llm_text' : 'rules');
    if (preferredChannel !== channel) {
      notices.push(
        `⚠ 第 3–4 步请求的通道是 ${cfg.requestedChannel}，但当前服务端不满足该通道的条件（缺少模型凭证或生图开关未开），已如实降级为 ${channel}；本次没有发起对应的真实调用。`,
      );
    }

    let direction = deriveDirectionCore({ intake, request, candidates, channel });
    let model_polish = { applied: false, code: null, attempts: 0 };
    let style_board = null;

    if (channel === 'llm_text') {
      const signals = extractSignals({ intake, request });
      const polish = await this.#polish({ direction, signals, runId });
      model_polish = polish;
      if (polish.applied) {
        const candidateDirection = mergePolish(direction, polish.value);
        const checked = validateDirection(candidateDirection);
        if (checked.ok) {
          direction = candidateDirection;
          direction.model_polish = { applied: true, source: 'llm_text', note: '仅措辞润色；主色/辅色/材质/禁项仍由规则锁定' };
        } else {
          model_polish = { ...polish, applied: false, code: 'DIRECTION_INVALID_AFTER_POLISH' };
        }
      }
      if (!model_polish.applied) {
        notices.push(
          `⚠ 第 3–4 步的文本润色未被采用（${model_polish.code ?? 'unknown'}）；方向仍按服务端规则输出，未用任何模拟内容顶替，主色与禁项不受影响。`,
        );
      }
    }

    if (channel === 'image') {
      const board = await this.#styleBoard({ direction, runId });
      style_board = board;
      if (board.status === 'ready') {
        notices.push(`第 3–4 步的风格看板图已生成（1 张，见 style_board.url）；结构化方向仍以规则结果为准。`);
      } else {
        notices.push(`⚠ 第 3–4 步的风格看板图未生成（${board.error_code}），已如实降级为纯文字方向，没有用占位图顶替。`);
      }
    }

    direction.channel = channel;
    direction.model_polish = model_polish.applied
      ? direction.model_polish ?? { applied: true, source: 'llm_text' }
      : { applied: false, code: model_polish.code ?? null, attempts: model_polish.attempts ?? 0 };
    direction.style_board = style_board;
    return { ok: true, direction, channel, notices, model_polish, style_board };
  }

  /** 只做措辞润色的一次真实调用；任何失败都不影响方向的可用性。 */
  async #polish({ direction, signals, runId }) {
    const cfg = typeof this.config === 'function' ? this.config() : this.config;
    const messages = [
      {
        role: 'system',
        content: [
          '你在为「礼物包装」确定措辞层的关键词与一句话视觉基调。',
          '服务端已经锁定了主色、辅色、材质与禁用项，你**不得**修改、不得新增颜色、不得提到任何被禁概念。',
          '只输出一个严格 JSON 对象：{"keywords":["…"],"visual_tone":{"zh":"…"},"materials":["…"]}；不要围栏、不要解释。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: 'style_direction_polish',
          locked: directionPromptText(direction),
          intake_signals: {
            interests: signals.interests.map((entry) => entry.zh),
            gift_styles: signals.gift_styles.map((entry) => entry.zh),
            relation: signals.relation.zh,
            occasion: signals.occasion.zh,
          },
          forbidden_concept_ids: signals.prohibitions.map((entry) => entry.concept_id),
        }),
      },
    ];
    let reply = null;
    let attempts = 0;
    try {
      reply = await this.llm.invoke({ kind: 'style_direction', messages, maxTokens: cfg.maxTokens });
      attempts = reply?.attempts ?? 1;
    } catch (error) {
      return { applied: false, code: 'POLISH_CALL_FAILED', attempts, value: null };
    }
    if (!reply?.ok) return { applied: false, code: reply?.code ?? 'POLISH_CALL_FAILED', attempts, value: null };
    let parsed;
    try {
      const text = String(reply.text ?? '');
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) return { applied: false, code: 'POLISH_NOT_JSON', attempts, value: null };
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { applied: false, code: 'POLISH_NOT_JSON', attempts, value: null };
    }
    const checked = checkModelPolish(parsed, direction);
    if (!checked.ok) return { applied: false, code: checked.code, attempts, value: parsed };
    return { applied: true, code: null, attempts, value: parsed };
  }

  /** 出风格看板图。默认通道不是 image，因此生产路径上默认不会走到这里。 */
  async #styleBoard({ direction, runId }) {
    const prompt = [
      '生成一张「礼物包装风格看板」示意图，横向 4:3：画面中央是同一份礼物包装的三件套（盒/纸袋、缎带、卡片）平铺展示，',
      '只体现下面给定的风格与色彩方向，不要出现商品本体、不要出现品牌标识、不要出现文字或水印之外的任何说明文字。',
      directionPromptText(direction),
      '这是风格参考看板，不是可生产图纸；尺寸与比例未核实。',
    ].join('\n');
    try {
      const result = await this.imageTransport.generate({ prompt, references: [], product: null });
      const stored = await this.storeBoard(result.bytes, result.extension);
      return {
        status: 'ready',
        url: `/api/style-boards/${stored.file}`,
        sha256: stored.sha256,
        width: result.width,
        height: result.height,
        actual_model: result.actual_model ?? null,
        elapsed_ms: result.elapsed_ms ?? null,
        usage: result.usage ?? null,
        reference_count: result.reference_count ?? 0,
        run_id: runId,
      };
    } catch (error) {
      return {
        status: 'failed',
        url: null,
        error_code: typeof error?.code === 'string' && /^IMAGE_[A-Z_]+$/.test(error.code) ? error.code : 'IMAGE_STYLE_BOARD_FAILED',
        execution: error?.execution ?? 'unknown',
        run_id: runId,
      };
    }
  }
}

/** 落盘风格看板（只允许 png/jpg；用内容哈希命名，天然幂等）。 */
export async function saveStyleBoard(bytes, extension) {
  if (!['png', 'jpg'].includes(extension)) throw Object.assign(new Error('IMAGE_TYPE_INVALID'), { code: 'IMAGE_TYPE_INVALID' });
  const sha256 = hash(bytes);
  const file = `${sha256}.${extension}`;
  await mkdir(STYLE_BOARD_DIR, { recursive: true });
  await writeFile(join(STYLE_BOARD_DIR, file), bytes, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return { sha256, file };
}

/** 供 pipeline 直接使用的适配包装（保持函数式调用形状，便于注入假实现做测试）。 */
export async function deriveVisualDirection({ intake, request, candidates, runId, provider = null } = {}) {
  const target = provider ?? defaultProvider();
  return target.derive({ intake, request, candidates, runId });
}

let singleton = null;
/** 进程内单例。llm 与生图 transport 在 pipeline 里惰性注入，避免循环导入。 */
export function defaultProvider(deps = {}) {
  if (!singleton || Object.keys(deps).length) {
    singleton = new VisualDirectionProvider(deps);
  }
  return singleton;
}

export function resetDefaultProvider() {
  singleton = null;
}

export { VISUAL_DIRECTION_VERSION, deriveDirectionCore, directionPromptText, validateDirection, matchConcepts, hasLlmConfig, llmConfig };
