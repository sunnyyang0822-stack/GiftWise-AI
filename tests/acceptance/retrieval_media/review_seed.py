"""PR64静态资料独立复核，不重新访问商家/下载图片。"""
import datetime as dt
from decimal import Decimal
import json
import os
from pathlib import Path
from urllib.parse import urlparse

root=Path(os.environ['QA_SEED_ROOT'])
catalog=json.loads((root/'research/seed-catalog/catalog.json').read_text(encoding='utf-8'))
evidence=json.loads((root/'docs/research/seed-catalog/evidence.json').read_text(encoding='utf-8'))
records={r['evidence_id']:r for r in evidence['records']}
rows=[]
for p in catalog['products']:
    checks={}
    checks['identity']=bool(p['product_id'] and p['name'] and p['variant'] and type(p['quantity']) is int and p['quantity']>0)
    checks['price']=p['price_amount'] is None or (isinstance(p['price_amount'],str) and Decimal(p['price_amount']).is_finite() and Decimal(p['price_amount'])>=0)
    checks['conditions']=isinstance(p['price_conditions'],list) and all(isinstance(x,str) for x in p['price_conditions']) and bool(p['price_conditions_status'])
    checks['date']=dt.datetime.fromisoformat(p['observed_at'].replace('Z','+00:00'))<=dt.datetime.fromisoformat(catalog['created_at'].replace('Z','+00:00'))
    ref=p['evidence_ref'].split('#')[-1]
    checks['evidence_link']=ref in records and records[ref]['source_url']==p['source_url'] and urlparse(p['source_url']).scheme=='https'
    checks['non_realtime']=p['price_source']=='seed' and p['non_realtime'] is True and p['business_data_verification']=='not_verified'
    image=p['image']
    checks['image_rights_not_assumed']=p['image_id'] is None and image['asset_url'] is None and image['rights_status']=='unverified' and image['project_download_allowed'] is False and image['project_display_allowed'] is False and bool(image['use_basis'])
    checks['unknowns_preserved']=p['shipping_status']=='unknown' and p['stock_status']=='unknown' and p['preparation_days'] is None and p['shipping_amount'] is None and bool(p['unverified_items'])
    rows.append(dict(id=p['product_id'],checks=checks,status='PASS' if all(checks.values()) else 'FAIL',price=p['price_amount'],date=p['observed_at'],conditions=p['price_conditions'],raw_evidence=records.get(ref)))
counts={status:sum(r['status']==status for r in rows) for status in ['PASS','FAIL']}
report=dict(sha=os.environ['QA_SEED_SHA'],scope='offline_record_audit_not_live_source_or_image_permission',counts=counts,
    records=len(rows),known_prices=sum(p['price_amount'] is not None for p in catalog['products']),unknown_prices=sum(p['price_amount'] is None for p in catalog['products']),
    authorized_images=sum(p['image']['project_display_allowed'] is True for p in catalog['products']),rows=rows,
    limitation='仅核对资料内部结构和证据片段/引用；未实时读取页面，不确认售价、权利授权、视觉、库存和送达。')
Path(os.environ['QA_RESULTS']).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False,indent=2))
raise SystemExit(1 if counts['FAIL'] else 0)
