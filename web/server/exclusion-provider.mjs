/** 提供者适配；不读密钥、不联网、不重试，不参与用户确认或业务修订。 */
import { MOCK_DISLIKES, MOCK_AI_JSON } from '../tests/fixtures/exclusions/mock.mjs';

/**
 * provider: async ({dislikes}) => 原始严格 JSON 字符串；只调用一次。
 * mode 必填 mock/dify；mock 只支持标注的固定虚构原文。
 * 空白原文返回 ok=true/ai_json=null 与显式跳过码，接入层无需确认。
 * ok 仅表示获取到字符串；接入层必须另调用 checkAiExclusions 后才能展示确认。
 */
export async function recognizeExclusions({dislikes = '', mode, provider} = {}) {
  const result = (ok, ai_json, errors = []) => ({ok, mode, ai_json, errors});
  const fail = (code, message, path = 'provider') => result(false, null, [{code, path, message}]);
  if (!['mock', 'dify'].includes(mode)) return fail('AI_OUTPUT_INVALID', '识别模式须明确为 mock 或 dify', 'mode');
  if (typeof dislikes !== 'string') return fail('AI_OUTPUT_INVALID', '不喜欢的东西须为文字', 'dislikes');
  if ([...dislikes].length > 1000) return fail('AI_OUTPUT_LIMIT', '原文最多 1000 码点', 'dislikes');
  if (!dislikes.trim()) return result(true, null, [{code: 'EXCLUSION_RECOGNITION_SKIPPED', path: 'dislikes', message: '原文为空，已跳过识别，无需确认'}]);
  if (mode === 'mock') {
    if (dislikes !== MOCK_DISLIKES) return fail('INTAKE_CLARIFICATION_REQUIRED', '模拟模式仅支持标注的虚构固定夹具，请修改输入或配置真实提供者', 'dislikes');
    return result(true, MOCK_AI_JSON);
  }
  if (typeof provider !== 'function') return fail('EXCLUSION_PROVIDER_NOT_CONFIGURED', '尚未配置真实识别能力');
  try {
    const raw = await provider({dislikes});
    if (typeof raw !== 'string') return fail('AI_OUTPUT_INVALID', '提供者须返回原始 JSON 字符串');
    if (Buffer.byteLength(raw, 'utf8') > 32768) return fail('AI_OUTPUT_LIMIT', '识别结果最多 32768 UTF-8 字节', 'ai_json');
    return result(true, raw);
  } catch {
    // 不公开异常原文，避免第三方错误夹带用户文字或凭证。
    return fail('EXCLUSION_PROVIDER_FAILED', '识别提供者调用失败，请检查配置后手动重试');
  }
}
