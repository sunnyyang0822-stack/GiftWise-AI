"""仅资产自检和列出待执行项；不导入业务、不联网、不产生业务PASS。"""
import argparse
from collections import Counter
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from decimal import Decimal

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sys.path.insert(0,str(HERE))
from build_assets import CASES,assets

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True,help='仅可写入docs/test-reports/retrieval-media下新目录')
    args=parser.parse_args()
    out=args.out.resolve()
    allowed=(ROOT/'docs/test-reports/retrieval-media').resolve()
    if not out.is_relative_to(allowed) or out.exists():
        parser.error('证据目录须位于本轮报告目录，且不能已存在')
    matrix=json.loads((HERE/'matrix.json').read_text(encoding='utf-8'))
    data=json.loads((HERE/'fixtures.json').read_text(encoding='utf-8'))
    assert matrix==CASES and data==assets(), '生成物与独立设计源不同'
    assert len({c['id'] for c in matrix})==len(matrix)
    assert all(c['status']=='BLOCKED' and c['scenario'] and c['expected'] and c['prerequisite'] for c in matrix)
    assert {c['group'] for c in matrix}=={'R','P','M','F'}
    ids={p['product_id']:p for p in data['products']}
    assert len(ids)==3
    assert len({x['candidate_id'] for x in data['media']['candidates']})==3
    for item in data['media']['candidates']:
        assert ids[item['product_id']]['image_id']==item['image']['id']
        assert item['image']['kind']=='demo' and '.example.invalid/' in item['image']['url']
    assert data['prices']['no_price']['price_amount'] is None
    assert Decimal(data['prices']['ordinary']['price_amount'])==Decimal('200.00')
    assert Decimal(data['prices']['one_cent_over']['price_amount'])-Decimal('200.00')==Decimal('0.01')
    assert Decimal(data['prices']['cross_range']['price_range']['min'])<Decimal('200.00')<Decimal(data['prices']['cross_range']['price_range']['max'])
    for item in data['valid_annotations']:
        for point in ['target','label']:
            assert all(type(v) in (int,float) and 0<=v<=1 for v in item[point].values())
    now=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()
    source_files=['AGENTS.md','docs/test-plan.md','docs/product-requirements.md','docs/development-process.md']
    hashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_files}
    record=dict(scope='TEST_PREPARATION_ONLY',time=now,command=sys.argv,
        preparation_sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),
        initial_status=subprocess.check_output(['git','status','--short'],cwd=ROOT).decode(),
        asset_self_check='PASS',business_counts=dict(PASS=0,FAIL=0,SKIP=0,BLOCKED=len(matrix)),
        groups=dict(Counter(c['group'] for c in matrix)),layers=dict(Counter(c['layer'] for c in matrix)),
        source_hashes=hashes,asset_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/'matrix.json',HERE/'fixtures.json']},
        note='未运行产品测试；无HTTP/浏览器/真实检索/图像服务/模型调用。')
    out.mkdir(parents=True,exist_ok=False)
    (out/'preparation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'pending-results.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(record,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
