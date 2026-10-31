/* 服务端识别引用：语义边界无需伪装成具体禁品；具体禁品继续使用真实确认 ID。 */
export function exclusionConfirmation(analysis, confirmedIds = []) {
  if (typeof analysis?.analysis_id !== "string" || !analysis.analysis_id.trim() || !Array.isArray(analysis.candidates)) return null;
  if (analysis.status === "ready") {
    if (analysis.confirmation_required !== false || analysis.candidates.length || analysis.clarification_questions?.length) return null;
    return { analysis_id: analysis.analysis_id, confirmed_ids: [] };
  }
  if (analysis.status !== "needs_confirmation" || !analysis.candidates.length || analysis.clarification_questions?.length) return null;
  const ids = analysis.candidates.map(item => item.id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length
    || !Array.isArray(confirmedIds) || confirmedIds.length !== ids.length || !ids.every(id => confirmedIds.includes(id))) return null;
  return { analysis_id: analysis.analysis_id, confirmed_ids: [...ids] };
}

export function exclusionQuestions(analysis) {
  return (Array.isArray(analysis?.clarification_questions) ? analysis.clarification_questions : [])
    .map(item => typeof item?.question === "string" ? item.question.trim() : "").filter(Boolean);
}
