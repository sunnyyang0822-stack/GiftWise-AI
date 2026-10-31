/** 虚构固定夹具；仅完整文本匹配，不能代表通用语义识别或大模型实测。 */
export const MOCK_DISLIKES = '不要香水';
export const MOCK_AI_JSON = JSON.stringify({
  ai_exclusion_candidates: [{id: 'xc1', kind: 'tag', tag: 'fragrance', term: null,
    source_span: MOCK_DISLIKES, confidence: 'high', why: '虚构模拟夹具：原文提到香水，仍需用户确认', evidence: 'user_text'}],
  ai_unmapped_notes: [],
});
