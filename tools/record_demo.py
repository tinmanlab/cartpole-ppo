"""Reproduce the HISTORICAL body-pulse walkthrough from its archived viewer.

Only an editorial caption is overlaid. Physics, policies, metrics, clocks and
Web Workers are unmodified. This is a feature walkthrough, not a benchmark.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import hashlib,json,os,subprocess,time

ROOT=Path(__file__).resolve().parents[1]
MEDIA=ROOT/'docs/media';RAW=ROOT/'evidence/video_raw'
MEDIA.mkdir(parents=True,exist_ok=True);RAW.mkdir(parents=True,exist_ok=True)
segments=[];errors=[];requests=[]

def run(*args):
 subprocess.run(args,check=True)

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1600,'height':1000},record_video_dir=str(RAW),record_video_size={'width':1600,'height':1000})
 page=context.new_page();page.set_default_timeout(15000)
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda q:requests.append(q.url) if q.url.startswith(('http:','https:')) else None)
 page.set_content((ROOT/'archive/en/body-pulse.v2.html').read_text(),wait_until='load');page.wait_for_function('PPOStep.status().ready')
 page.click('#dismissGuide')
 world_box=page.locator('.world-card').bounding_box()
 page.evaluate("""()=>{const e=document.createElement('div');e.id='recordingCaption';e.style.cssText='position:fixed;bottom:14px;left:50%;transform:translateX(-50%);max-width:94%;background:#14283dee;color:white;border-radius:8px;padding:12px 24px;font:600 19px system-ui;z-index:100;pointer-events:none;text-align:center;box-shadow:none';document.body.append(e);} """)
 # Trim startup through the first recorded caption. Offset is measured against
 # the recorded browser clock, not assumed from a synthetic frame count.
 start=time.monotonic()
 def caption(text):
  segments.append({'start':round(time.monotonic()-start,3),'text':text})
  page.locator('#recordingCaption').evaluate('(e,t)=>e.textContent=t',text)
 def wait(seconds):page.wait_for_timeout(round(seconds*1000))
 def target(x):page.eval_on_selector('#target','(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));}',str(x))
 caption('A trained example is running. Your own learner is still random.')
 target(-.6);wait(6)
 caption('Move the target. The network commands the BAM drive—not the cart position.')
 target(.6);wait(6)
 caption('A real 4 N × 0.20 s push. Test exposure does not train the policy.')
 page.select_option('#pushForce','4');page.select_option('#pushDuration','0.2');page.click('#pushRight');wait(5)
 page.screenshot(path=str(MEDIA/'hero.png'))
 caption('English and Korean share one engine. Switching language keeps state.')
 page.select_option('#language','ko');wait(2);page.select_option('#language','en');wait(2)
 page.click('[data-chapter="2"]');caption('Freeze one recorded experience. Click a neuron and see its actual arithmetic.')
 page.click('[data-forward="1"]');wait(4)
 page.locator('#neuronMicroscope').scroll_into_view_if_needed();wait(2)
 page.screenshot(path=str(MEDIA/'network.png'))
 page.click('[data-forward="2"]');caption('Products + bias → tanh. Changing an input is not the same as learning.');wait(3)
 page.select_option('#netMode','delta');caption('Δw / Δh shows the saved minibatch update, not an animation of improvement.');wait(4)
 page.click('[data-chapter="3"]');page.evaluate('scrollTo(0,0)');caption('Reward scores the task. GAE estimates a learning signal—not the true future.');wait(4)
 page.click('[data-chapter="4"]');page.click('[data-update="2"]');caption('Backpropagation: which weights contributed to this sample’s loss?');wait(3)
 page.click('[data-update="3"]');caption('128 gradients are averaged. Adam uses their history to change each weight.');wait(4)
 page.screenshot(path=str(MEDIA/'adam.png'))
 page.click('[data-update="4"]');caption('Keep the input fixed. Read the actual action-probability change.');wait(3)
 page.click('#conditionsBtn');caption('Change a cost or physical condition—then choose where it applies.');wait(2)
 page.locator('#spec_rewardPosition').scroll_into_view_if_needed();page.fill('#spec_rewardPosition','1.25');wait(3)
 # Leave the draft unapplied. It must not change either the learner or the scene.
 page.click('#closeConditions');page.click('[data-chapter="5"]');page.evaluate('scrollTo(0,0)')
 caption('Now train a separate, random policy. Progress comes from real PPO updates.')
 page.select_option('#runLength','20');page.click('#startTraining')
 page.wait_for_function('PPOStep.status().latestIteration>=20 && !PPOStep.status().running',timeout=30000)
 caption('This short run is complete. Freeze the weights and test—do not infer success from loss.');wait(3)
 page.screenshot(path=str(MEDIA/'training.png'))
 # Explicitly select the original trained example for the final held-out suite.
 page.select_option('#recordSource','example');page.select_option('#recordSelect','240');page.click('#applySelected')
 page.click('#evaluatePolicy');caption('Held-out tests freeze this example policy. Count exposure and invalid-model stops.')
 page.wait_for_function('!PPOStep.status().evalBusy && PPOStep.status().evalRows!==null',timeout=40000)
 page.locator('#evaluationRows').scroll_into_view_if_needed();wait(5)
 page.screenshot(path=str(MEDIA/'evaluation.png'))
 caption('No hidden PID. No invented learning curve. One local lab, two languages.');wait(3)
 end=time.monotonic()-start
 state=page.evaluate('PPOStep.status()')
 raw=page.video.path()
 # Save the exact viewport recording before encoding; do not alter its timing.
 context.close();browser.close()

if errors or requests:raise RuntimeError({'pageErrors':errors,'unexpectedNetwork':requests})
# H.264/yuv420p is portable to GitHub/browser video players. No time acceleration.
run('ffmpeg','-y','-i',str(raw),'-an','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(MEDIA/'walkthrough.mp4'))
# Crop the real simulation card, not its state/metrics, for a readable README preview.
roi=[int(world_box['width'])//2*2,int(world_box['height'])//2*2,int(world_box['x']),int(world_box['y'])]
crop='crop='+':'.join(map(str,roi))
# A short, genuine excerpt is the README's embedded preview, linked to the MP4.
run('ffmpeg','-y','-ss','4','-t','14','-i',str(MEDIA/'walkthrough.mp4'),'-filter_complex',crop+',fps=10,scale=800:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',str(MEDIA/'demo.gif'))
info=json.loads(subprocess.check_output(['ffprobe','-v','quiet','-show_streams','-show_format','-of','json',str(MEDIA/'walkthrough.mp4')]))
report={'sourceHTML_SHA256':hashlib.sha256((ROOT/'archive/en/body-pulse.v2.html').read_bytes()).hexdigest(),'capture':'Real Chromium viewport recording; set_content loaded exact standalone HTML bytes. Editorial captions only. No metric mocks, physics speed changes or hidden control law.','chapterCaptions':segments,'previewCrop':world_box,'scriptRunSeconds':end,'pageErrors':errors,'remoteRequests':requests,'lastState':state,'media':{'duration':float(info['format']['duration']),'codec':info['streams'][0]['codec_name'],'width':info['streams'][0]['width'],'height':info['streams'][0]['height'],'bytes':(MEDIA/'walkthrough.mp4').stat().st_size}}
(ROOT/'evidence/media_recording.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report['media'],indent=2))
