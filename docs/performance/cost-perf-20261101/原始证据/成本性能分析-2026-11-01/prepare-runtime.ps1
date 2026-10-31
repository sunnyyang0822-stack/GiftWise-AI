$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$sourceSha = '15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879'
$evidenceSha = '147e45a60f7a7fc9f2cc8c7e9d8146af3dc5f405'
foreach ($entry in @(@('source', $sourceSha), @('handoff', $evidenceSha))) {
  $archiveName = $entry[0] + '.zip'
  if (-not (Test-Path -LiteralPath $archiveName)) {
    Invoke-WebRequest -Uri ('https://codeload.github.com/sunnyyang0822-stack/GiftWise-AI/zip/' + $entry[1]) -OutFile $archiveName -TimeoutSec 120
  }
}
@'
import pathlib,zipfile,json,hashlib
p=pathlib.Path('.')
provenance=json.loads((p/'provenance.json').read_text(encoding='utf8'))
for name in ['source.zip','handoff.zip']:
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==provenance['sha256'][name],name+' hash mismatch; keep file and inspect instead of trusting it'
z=zipfile.ZipFile(p/'source.zip')
for entry in z.infolist():
 parts=pathlib.PurePosixPath(entry.filename).parts[1:]
 if parts and parts[0] in ['web','validator','workflow','tests'] and not entry.is_dir():
  assert '..' not in parts
  dest=p/'runtime'/pathlib.Path(*parts)
  if dest.exists():
   assert dest.read_bytes()==z.read(entry),'existing runtime differs: '+str(dest)
  else:
   dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(entry))
print('Pinned public input archives verified; runtime prepared without credentials or model calls.')
'@ | python -
if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed; inspect the output.' }
