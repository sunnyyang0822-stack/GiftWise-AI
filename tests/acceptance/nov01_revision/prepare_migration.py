"""只迁移并自检 QA 夹具；不导入或执行业务实现，不修改指纹。"""
import ast
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(path):
    spec = importlib.util.spec_from_file_location('qa_fixture_source', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    stage = ROOT / 'tests/acceptance/stage_b'
    path = stage / 'cases.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    old = {case['id']: case for case in data['cases']}
    new_cases = load(stage / 'build_cases.py').build()
    new = {case['id']: case for case in new_cases}
    assert len(new) == len(new_cases) and set(old) == set(new), '不允许删除/更换旧 case ID'
    expected_changes = {f'money_range_reject_request_{n}' for n in range(6)}
    changed = {key for key in old if old[key] != new[key]}
    assert changed <= expected_changes, changed
    for key in old:
        before, after = dict(old[key]), dict(new[key])
        before.pop('expected'); after.pop('expected')
        assert before == after, f'{key}: 只允许更改期望，不改原输入'
    for n in range(4):
        case = new[f'money_range_reject_request_{n}']
        assert case['expected']['status'] == 'passed'
        assert case['expected']['candidate_passed'] == [True]*3
    for n in (4, 5):
        case = new[f'money_range_reject_request_{n}']
        assert case['expected']['status'] == 'needs_input'
        assert case['expected']['errors'] == [{'code':'LIMIT_EXCEEDED','path':'request.budget_amount',
            'location':'top','message':'预算须在 0 至 10000 之间'}]
    data['cases'] = new_cases
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2)+'\n', encoding='utf-8')
    cases = {c['id']: c for c in load(Path(__file__).with_name('fixtures.py')).rule_cases()}
    for cid, code, field in [
        ('R-invalid-missing-min','INVALID_BUDGET_RANGE','request.budget_range.min'),
        ('R-invalid-missing-max','INVALID_BUDGET_RANGE','request.budget_range.max'),
        ('R-invalid-mismatch','BUDGET_RANGE_MISMATCH','request.budget_amount')]:
        assert (cases[cid]['code'], cases[cid]['path'], cases[cid]['status']) == (code,field,'needs_input')
    for source in [Path(__file__),Path(__file__).with_name('fixtures.py'),
        Path(__file__).with_name('test_revision_rules.py'),stage/'build_cases.py',
        ROOT/'tests/acceptance/boundary/test_boundary_ranges.py',
        ROOT/'tests/acceptance/boundary/test_error_composition.py']:
        ast.parse(source.read_text(encoding='utf-8'))
    print(json.dumps({'stage_b_cases':len(new),'changed_expectations':sorted(changed),
        'ids_and_inputs_preserved':True,'precise_paths_checked':3,'syntax_checked':6,
        'business_executed':False},ensure_ascii=False))


if __name__ == '__main__':
    main()
