"""Restore a verified GiftWise archive downloaded from the private GitHub release."""
from pathlib import Path,PureWindowsPath
import argparse,json,gzip,zipfile,hashlib,os
p=argparse.ArgumentParser();p.add_argument('--assets',default='.');p.add_argument('--destination',required=True);p.add_argument('--verify-only',action='store_true');p.add_argument('--select',help='Optional relative original-home prefix, e.g. Desktop/gw-live');a=p.parse_args()
assets=Path(a.assets);dest=Path(a.destination).resolve();m=json.loads(gzip.decompress((assets/'manifest.json.gz').read_bytes()))
for part in m['parts']:
 q=assets/part['name'];assert hashlib.sha256(q.read_bytes()).hexdigest()==part['sha256'],q
zips=[zipfile.ZipFile(assets/x['name']) for x in m['parts']];lookup={}
for z in zips:
 assert z.testzip() is None
 for n in z.namelist():lookup[n.split('/')[-1]]=(z,n)
home=PureWindowsPath(m['original_home']);count=0
for row in m['files']:
 relative=PureWindowsPath(row['path']).relative_to(home);target=dest.joinpath(*relative.parts)
 if a.select and not relative.as_posix().lower().startswith(a.select.replace('\\','/').rstrip('/').lower()+'/'):continue
 assert target.is_relative_to(dest)
 if not a.verify_only:target.parent.mkdir(parents=True,exist_ok=True)
 h=hashlib.sha256();size=0;f=None if a.verify_only else target.open('wb')
 try:
  for digest in row['blocks']:
   z,n=lookup[digest];b=z.read(n);assert hashlib.sha256(b).hexdigest()==digest
   h.update(b);size+=len(b)
   if f:f.write(b)
 finally:
  if f:f.close()
 assert size==row['bytes'] and h.hexdigest()==row['sha256'],row['path'];count+=1
 if count%5000==0:print('verified/restored',count,flush=True)
if not a.verify_only:
 old=str(home);new=str(dest)
 for row in m['files']:
  rel=PureWindowsPath(row['path']).relative_to(home);q=dest.joinpath(*rel.parts)
  if not q.exists():continue
  # Repair worktree pointers and Git alternate object paths after relocation.
  if q.name in ['.git','gitdir','alternates'] and q.is_file() and q.stat().st_size<65536:
   try:
    text=q.read_text(encoding='utf-8');changed=text.replace(old,new).replace(old.replace('\\','/'),new.replace('\\','/'))
    if changed!=text:q.write_text(changed,encoding='utf-8')
   except UnicodeError:pass
 for q in dest.rglob('HEAD'):
  g=q.parent
  if (g/'objects').is_dir() and not (g/'config').exists():
   (g/'config').write_text('[core]\n repositoryformatversion = 0\n filemode = false\n bare = false\n logallrefupdates = true\n[remote "origin"]\n url = https://github.com/sunnyyang0822-stack/GiftWise-AI.git\n fetch = +refs/heads/*:refs/remotes/origin/*\n',encoding='utf-8')
 (dest/'RESTORE-NOTES.json').write_text(json.dumps({'restored_files':count,'excluded_sensitive':m['excluded_sensitive'],'excluded_rebuildable':m['excluded_rebuildable'],'junctions_not_automatically_recreated':m['links']},ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS files=',count,'verify_only=',a.verify_only)
