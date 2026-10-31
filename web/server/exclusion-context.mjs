import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage();
/** 仅在已校验owner/快照的推荐请求内派生，原始intake不接受此字段。 */
export function withExclusionContext(analysis, callback) {
  if (!analysis) return callback();
  return scope.run({original:analysis.intake.dislikes || '',semantic_constraints:structuredClone(analysis.semantic_constraints || []),clarifications:structuredClone(analysis.clarifications || [])}, callback);
}
export function currentExclusionContext() {
  const value=scope.getStore();
  return value ? structuredClone(value) : null;
}
