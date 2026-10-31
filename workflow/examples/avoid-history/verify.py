"""验证字段和固定未映射信封；不实现/声称自然语言风险识别。"""
import copy
import json
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from workflow.intake import adapt_intake,dump
from workflow.runtime import check,report

def run():
    fixture=json.loads((Path(__file__).parent/'cases.json').read_text(encoding='utf-8'))
    base=json.loads((ROOT/'workflow/examples/intake.json').read_text(encoding='utf-8'))
    base.pop('budget_amount')
    base.update(contract_version='giftwise-20261031-v2',budget_mode='other',budget_range={'min':'100','max':'300'},dislikes='')
    results=[]
    def expect(name,ok):
        assert ok,name
        results.append({'name':name,'passed':True})
    def adapt(**kwargs):
        return adapt_intake(dump(dict(base,**kwargs)))
    original=json.loads(adapt()['request_json'])
    for args in ({},{'previous_gifts':'','dislikes':''},{'previous_gifts':' \t\n','dislikes':' \t\n'}):
        r=adapt(**args)
        expect('缺省/空值/空白：'+str(len(results)),r['status']=='ready' and json.loads(r['request_json'])['previous_gifts']=='' and json.loads(r['request_json'])['dislikes']=='')
    for text in (fixture['history'], '  '+fixture['history']+'  ',fixture['explicit_history'],fixture['injection']):
        r=adapt(previous_gifts=text)
        q=json.loads(r['request_json'])
        expect('历史原意保留：'+str(len(results)),q['previous_gifts']==text)
        expect('不自动拼入避免项事实或硬约束：'+str(len(results)),all(q[k]==original[k] for k in ('dislikes','forbidden_tags','forbidden_terms','facts','preference_inferences','budget_amount','budget_range','available_days')))
    for value,code in ((None,'INVALID_TYPE'),(False,'INVALID_TYPE'),(12,'INVALID_TYPE'),([], 'INVALID_TYPE'),('字'*1001,'LIMIT_EXCEEDED')):
        r=adapt(previous_gifts=value)
        expect('历史类型长度拒绝：'+str(len(results)),r['status']=='needs_input' and r['request_json'] is None and any(e['path']=='intake.previous_gifts' and e['code']==code for e in r['errors']))
    expect('历史1000码点允许',adapt(previous_gifts='字'*1000)['status']=='ready')
    # 基础适配不会理解语义。只用显式未映射固定信封实测现有checker阻塞，不把fixture冒充模型。
    js="import {checkAiExclusions} from './web/server/exclusion-checker.mjs';const d=JSON.parse(process.argv[1]);console.log(JSON.stringify(checkAiExclusions(d.raw,d.text)));"
    for case in fixture['unmapped']:
        envelope={'ai_exclusion_candidates':[],'ai_unmapped_notes':[case['why']]}
        p=subprocess.run(['node','--input-type=module','-e',js,dump({'raw':dump(envelope),'text':case['dislikes']})],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
        assert p.returncode==0,p.stderr
        out=json.loads(p.stdout)
        expect('未映射风险信封阻止推荐：'+case['dislikes'],out['status']=='needs_input' and not out['candidates'])
        r=adapt(dislikes=case['dislikes'])
        expect('风险原文不被编造标签尺码：'+case['dislikes'],json.loads(r['request_json'])['dislikes']==case['dislikes'] and json.loads(r['request_json'])['forbidden_tags']==original['forbidden_tags'])
    batch=json.loads((ROOT/'workflow/examples/nov01/cases.json').read_text(encoding='utf-8'))['candidates']
    state=check(adapt(previous_gifts=fixture['history'])['request_json'],dump(batch))
    expect('普通送礼历史仍为软上下文',state['validation']['all_passed'] and state['repair_count']==0)
    out=report(state)
    expect('用户选择与未知信息保留',out['selected_candidate_id'] is None and out['request']['previous_gifts']==fixture['history'] and all(c['unknowns'] for c in out['candidates']))
    expect('不要求预算确认框',adapt()['status']=='ready' and 'budget_confirmed' not in original)
    print(json.dumps({'passed':len(results),'results':results,'model_calls':0,'semantic_model_validation':'未执行','history_explicit_exclusion_gate':'BLOCKED：待PM接入来源绑定确认','new_JS_parity':'BLOCKED：待接入同步'},ensure_ascii=False,indent=2))
if __name__=='__main__':
    run()
