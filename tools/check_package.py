"""Check bilingual assets, historical bytes, local documentation links and media.
No network or third-party Python package is required.
"""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[1]
checks=0

def require(condition,message):
 global checks
 if not condition:raise SystemExit(message)
 checks+=1

for name in ['index.html','viewer.ko.html','docs/media/walkthrough.mp4','docs/media/demo.gif','docs/demo.html','LICENSE','licenses/Apache-2.0.txt']:
 require((ROOT/name).is_file(),f'Missing distributable: {name}')
a=(ROOT/'index.html').read_bytes();b=(ROOT/'viewer.ko.html').read_bytes()
require(a.replace(b'data-default-lang="en"',b'data-default-lang="ko"')==b,'Current EN/KO builds have diverged')
manifest=json.loads((ROOT/'archive/ko/manifest.json').read_text())
require(hashlib.sha256((ROOT/'archive/ko'/manifest['file']).read_bytes()).hexdigest()==manifest['sha256'],'Historical Korean viewer changed')
for path in [ROOT/'README.md',ROOT/'README.ko.md',ROOT/'CONTRIBUTING.md',ROOT/'THIRD_PARTY.md',*(ROOT/'docs').glob('*.md')]:
 for link in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if re.match(r'^(https?:|mailto:|#)',link):continue
  clean=link.split('#')[0]
  require((path.parent/clean).exists(),f'Broken local documentation link in {path.name}: {link}')
report=json.loads((ROOT/'evidence/media_recording.json').read_text())
require(report['sourceHTML_SHA256']==hashlib.sha256(a).hexdigest(),'Walkthrough does not match this viewer build; recapture after source changes')
require(report['media']['codec']=='h264','Walkthrough must use browser-compatible H.264')
require(report['media']['duration']>45,'Walkthrough is too short for the documented actual workflow')
require(not report['pageErrors'] and not report['remoteRequests'],'Capture had errors or external runtime requests')
require((ROOT/'docs/media/demo.gif').stat().st_size<8*1024*1024,'GIF is needlessly large for a README')
print(f'{checks} package checks passed.')
