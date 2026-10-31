import { randomUUID } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
const LIMIT = 200;
const analyses = new Map();

function prune() {
  const now = Date.now();
  for (const [id, item] of analyses) if (now - item.createdAt > TTL_MS) analyses.delete(id);
  if (analyses.size > LIMIT) {
    const ids = [...analyses.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, analyses.size - LIMIT).map(x => x.id);
    ids.forEach(id => analyses.delete(id));
  }
}
export function createAnalysis({ intake, mode, candidates, status, errors = [], semantic_constraints = [], clarification_questions = [], clarifications = [], unmapped_notes = [] }) {
  prune();
  const id = `xa-${randomUUID()}`;
  analyses.set(id, { id, createdAt: Date.now(), intake: structuredClone(intake), mode, candidates: structuredClone(candidates), status, errors: structuredClone(errors), semantic_constraints: structuredClone(semantic_constraints), clarification_questions: structuredClone(clarification_questions), clarifications: structuredClone(clarifications), unmapped_notes: structuredClone(unmapped_notes) });
  prune();
  return id;
}
export function getAnalysis(id) {
  prune();
  if (typeof id !== 'string' || !analyses.has(id)) return null;
  return analyses.get(id);
}
export function analysisCount() { prune(); return analyses.size; }
