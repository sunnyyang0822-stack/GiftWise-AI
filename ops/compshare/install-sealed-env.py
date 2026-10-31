#!/usr/bin/env python3
"""一次性导入 RSA-OAEP-SHA256 密封配置；终端只传密文，不回显秘密。"""
import base64,json,os,subprocess,sys
from pathlib import Path
if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED')
private=Path('/etc/giftwise/bootstrap-private.pem')
sealed=Path(sys.argv[1])
try:
    envelope=json.loads(sealed.read_text(encoding='utf-8'))
    if envelope['algorithm']!='RSA-OAEP-SHA256' or not 1<=len(envelope['chunks'])<=32:raise ValueError()
    chunks=[]
    for chunk in envelope['chunks']:
        result=subprocess.run(['openssl','pkeyutl','-decrypt','-inkey',str(private),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256','-pkeyopt','rsa_mgf1_md:sha256'],input=base64.b64decode(chunk,validate=True),capture_output=True,check=True)
        chunks.append(result.stdout)
    values=json.loads(b''.join(chunks))
    required={'LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','IMAGE_API_KEY'}
    if set(values)!=required or any(not isinstance(v,str) or not v.strip() or '\n' in v or '\r' in v or len(v)>8192 for v in values.values()):raise ValueError()
    lines=['GW_MODE=llm','GIFTWISE_RETRIEVAL=domestic','GIFTWISE_INTAKE_PARSE=1','GIFTWISE_IMAGE_GENERATION=1']
    for key in sorted(required):
        value=values[key].replace('\\','\\\\').replace('"','\\"')
        lines.append(key+'="'+value+'"')
    target='/etc/giftwise/server.env'
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as stream:stream.write('\n'.join(lines)+'\n')
except Exception:
    raise SystemExit('SEALED_ENV_IMPORT_FAILED')
private.unlink()
Path('/var/www/html/giftwise-bootstrap-public.pem').unlink(missing_ok=True)
sealed.unlink()
print('SERVER_ENV_INSTALLED mode=llm secrets=4 permissions=0600 ephemeral_key_removed=true')
