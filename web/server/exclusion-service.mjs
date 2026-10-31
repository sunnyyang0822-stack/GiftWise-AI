/** 排除项语义接续；原话/回答绑定服务端分析，语气限制不写成字面禁词。 */
import { createHash } from 'node:crypto';
import { adaptIntakeObject } from './intake.mjs';
import { recognizeExclusions } from './exclusion-provider.mjs';
import { checkAiExclusions } from './exclusion-checker.mjs';
import { createAnalysis, getAnalysis } from './exclusion-store.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const exclusionIntakeFingerprint = intake => createHash('sha256').update(JSON.stringify(canonical(intake))).digest('hex');
const sameIntake = (left, right) => exclusionIntakeFingerprint(left) === exclusionIntakeFingerprint(right);
const issue = (code, message, path='continuation') => ({code,path,message});
const originalText = intake => typeof intake?.dislikes === 'string' ? intake.dislikes : '';
const view = analysis => ({status:analysis.status,mode:analysis.mode,analysis_id:analysis.id,candidates:structuredClone(analysis.candidates),semantic_constraints:structuredClone(analysis.semantic_constraints),clarification_questions:structuredClone(analysis.clarification_questions),unmapped_notes:structuredClone(analysis.unmapped_notes),confirmation_required:analysis.status==='needs_confirmation'&&analysis.candidates.length>0,errors:structuredClone(analysis.errors),intake_fingerprint:exclusionIntakeFingerprint(analysis.intake)});

export async function analyzeExclusionIntake({intake,mode,owner,continuation,provider}={}) {
  const basic=adaptIntakeObject(intake);
  if(basic.status!=='ready') return {status:'needs_input',mode,analysis_id:null,candidates:[],semantic_constraints:[],clarification_questions:[],confirmation_required:false,errors:basic.errors};
  let prior=null;
  let clarifications=[];
  if(continuation!==undefined) {
    prior=getAnalysis(continuation?.analysis_id);
    if(!prior||prior.owner_scope!==owner||!sameIntake(prior.intake,intake)) return {status:'error',mode,analysis_id:null,candidates:[],semantic_constraints:[],clarification_questions:[],confirmation_required:false,errors:[issue('EXCLUSION_ANALYSIS_STALE','当前需求已变化或对话已过期，请继续当前需求。')]};
    const fail=message=>({...view(prior),status:'error',confirmation_required:false,errors:[issue('EXCLUSION_CONTINUATION_INVALID',message)]});
    if(prior.status!=='needs_input'||!prior.clarification_questions.length) return fail('当前没有等待回答的问题。');
    if(typeof continuation.answer!=='string'||!continuation.answer.trim()) return fail('直接回答上面的问题就好。');
    clarifications=[...prior.clarifications,{questions:prior.clarification_questions.map(item=>item.question),answer:continuation.answer.trim()}];
    if(clarifications.length>10||[...continuation.answer].length>1000) return fail('这段回答超过当前对话长度限制，之前的信息已保留。');
  }
  const recognized=await recognizeExclusions({dislikes:originalText(intake),clarifications,mode,provider});
  if(!recognized.ok) {
    if(prior) return {...view(prior),status:'error',confirmation_required:false,errors:recognized.errors};
    const id=createAnalysis({intake,mode,candidates:[],status:'error',errors:recognized.errors});
    const stored=getAnalysis(id); stored.owner_scope=owner;
    return view(stored);
  }
  const checked=recognized.ai_json===null ? {status:'ready',candidates:[],semantic_constraints:[],clarification_questions:[],unmapped_notes:[],errors:[]} : checkAiExclusions(recognized.ai_json,originalText(intake),{clarificationAnswers:clarifications.map(item=>item.answer)});
  // 输出协议错误不清空上一轮有效问题、候选或原话；本次回答由客户端保留并可重试。
  if(prior&&checked.errors.some(error=>error.code.startsWith('AI_OUTPUT_'))) return {...view(prior),status:'error',confirmation_required:false,errors:checked.errors};
  const id=createAnalysis({intake,mode,candidates:checked.candidates,status:checked.status,errors:checked.errors,semantic_constraints:checked.semantic_constraints,clarification_questions:checked.clarification_questions,unmapped_notes:checked.unmapped_notes,clarifications});
  const stored=getAnalysis(id); stored.owner_scope=owner;
  return view(stored);
}

/** 只准备已绑定的语义上下文，具体禁品确认仍交原pipeline完整检查。 */
export function prepareExclusionRecommendation({intake,analysis,confirmation,owner}={}) {
  if(!analysis) return {ok:true,intake,analysis,confirmation};
  const fail=(code,message)=>({ok:false,errors:[issue(code,message,'exclusion_confirmation')]});
  if(analysis.owner_scope!==owner||!sameIntake(analysis.intake,intake)) return fail('EXCLUSION_ANALYSIS_STALE','当前需求与已理解的内容不一致，请继续当前需求。');
  if(!['ready','needs_confirmation'].includes(analysis.status)) return {...fail('INTAKE_CLARIFICATION_REQUIRED','请回答当前的澄清问题。'),clarification_questions:analysis.clarification_questions};
  if (confirmation?.analysis_id !== analysis.id) return fail('EXCLUSION_ANALYSIS_STALE','当前分析引用不一致。');
  const ids=confirmation?.confirmed_ids;
  const expected=analysis.candidates.map(item=>item.id);
  if(!Array.isArray(ids)||ids.length!==expected.length||new Set(ids).size!==ids.length||expected.some(id=>!ids.includes(id))) return fail('INTAKE_CLARIFICATION_REQUIRED','请确认已识别的具体避开项。');
  // 原始intake不改写；完整原话、解释与多轮回答由服务端请求作用域派生到冻结request。
  const prepared={...analysis,intake:structuredClone(intake),status:'needs_confirmation',semantic_only:expected.length===0};
  return {ok:true,intake,analysis:prepared,confirmation};
}
