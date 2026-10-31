"""只读复核正式合入的重建内容；只在临时副本运行生成器，不改 workflow。"""
import ast
import contextlib
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]


def main():
    out = ROOT/'docs/test-reports/rev-qa-001/migration-20261031/rebuilt-content'
    out.mkdir(parents=True, exist_ok=False)
    def git(*args):
        return subprocess.check_output(['git',*args],cwd=ROOT)
    release = git('rev-parse','origin/release/2026-11-01-submission').decode().strip()
    assert release.startswith('3dfb186'), '本审查固定针对 PR #54 的正式合入版本'
    assert subprocess.run(['git','merge-base','--is-ancestor',release,'HEAD'],cwd=ROOT).returncode==0
    for name, paths in [('business',['validator/rules.py','tests/test_cases.json']),
                        ('generated',['workflow/generated'])]:
        (out/(name+'-content-diff.patch')).write_bytes(git('diff','ce5fd11' if name=='generated' else 'e4ba08f',release,'--',*paths))
    manifest = json.loads((ROOT/'workflow/generated/manifest.json').read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('qa_rebuild',ROOT/'workflow/build_code_node.py')
    builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    comparisons={}
    with tempfile.TemporaryDirectory(prefix='giftwise-qa-content-') as tmp:
        builder.ROOT=Path(tmp)
        for name in builder.SOURCES:
            target=builder.ROOT/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            _, rebuilt_manifest=builder.build()
        for name in manifest['artifacts_sha256']:
            current=(ROOT/'workflow/generated'/name).read_bytes().replace(b'\r\n',b'\n')
            reconstructed=(builder.ROOT/'workflow/generated'/name).read_bytes().replace(b'\r\n',b'\n')
            ast.parse(current.decode('utf-8'))
            comparisons[name]={'actual_content_matches_rebuild_after_lf':current==reconstructed}
            assert current==reconstructed,name
    # 先验证实际内容与语义，再计算/比对指纹。
    ns={'__name__':'qa_generated_module'}
    exec((ROOT/'workflow/generated/code_node.py').read_text(encoding='utf-8'),ns)
    case_spec=importlib.util.spec_from_file_location('qa_fixtures',Path(__file__).with_name('fixtures.py'))
    fixtures=importlib.util.module_from_spec(case_spec);case_spec.loader.exec_module(fixtures)
    semantic=[]
    for case in fixtures.rule_cases():
        result=ns['validate'](json.dumps(case['request'],ensure_ascii=False),json.dumps(case['candidates'],ensure_ascii=False))
        assert result['status']==case['status'],case['id']
        assert result['all_passed']==(case['status']=='passed'),case['id']
        errors=result['errors']+[e for c in result['candidate_results'] for e in c['errors']]
        if case['code']: assert (case['code'],case['path']) in [(e['code'],e['path']) for e in errors],case['id']
        if case['status']=='needs_input': assert not any(c['passed'] for c in result['candidate_results'])
        if case['status']=='passed':
            for c in result['candidate_results']:
                assert any(w['code']=='BELOW_BUDGET_RANGE' for w in c['warnings'])==case['warning']
        semantic.append({'case':case['id'],'status':'PASS'})
    source_hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in builder.SOURCES}
    # 源码 hash 必须实际匹配；生成物允许既有 stage C 契约的 LF 换行归一化。
    assert source_hashes==manifest['sources_sha256']
    assert rebuilt_manifest['artifacts_sha256']==manifest['artifacts_sha256']
    record={'release_sha':release,'qa_head':git('rev-parse','HEAD').decode().strip(),
        'time':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
        'content_first':True,'generated_comparisons':comparisons,'generated_semantics':semantic,
        'source_hashes':source_hashes,'rebuilt_artifact_hashes':rebuilt_manifest['artifacts_sha256'],
        'pin_update_performed':False,'workflow_changed_by_qa':False,'dify_calls':0}
    (out/'review.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PASS 5 个生成物内容重建比对；31 组生成物规则语义；4 源码/5 产物指纹匹配。未修改指纹基线。')


if __name__=='__main__':
    main()
