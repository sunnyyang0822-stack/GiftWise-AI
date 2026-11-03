"""Decrypt optional private-state attachments, then use restore.py on the decrypted assets."""
from pathlib import Path
import argparse,base64,getpass,hashlib,json,sys
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--output',required=True);p.add_argument('--key-file');a=p.parse_args()
assets=Path(a.assets);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
secret=Path(a.key_file).read_text(encoding='ascii').strip() if a.key_file else getpass.getpass('Recovery key (not stored in GitHub): ').strip()
key=base64.urlsafe_b64decode(secret);assert len(key)==32
index=json.loads((assets/'encrypted-index.json').read_text(encoding='utf-8'))
for row in index['files']:
 src=assets/row['name'];assert hashlib.sha256(src.read_bytes()).hexdigest()==row['sha256'],src
 dst=out/src.name.removesuffix('.enc');assert not dst.exists(),dst
 with src.open('rb') as f:
  header=f.read(19);assert header[:7]==b'GWENC01'
  f.seek(-16,2);tag=f.read(16);remaining=src.stat().st_size-35;f.seek(19)
  decryptor=Cipher(algorithms.AES(key),modes.GCM(header[7:],tag)).decryptor()
  try:
   with dst.open('wb') as result:
    while remaining:
     b=f.read(min(4*1024*1024,remaining));remaining-=len(b);result.write(decryptor.update(b))
    result.write(decryptor.finalize())
  except Exception:
   dst.unlink(missing_ok=True);raise
 print('DECRYPTED_AUTHENTICATED',src.name,flush=True)
print('Decryption complete. Use restore.py --assets <output> --destination <target> to restore these files.')
