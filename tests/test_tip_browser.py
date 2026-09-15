"""Held pole-tip interaction on the real viewer; no physics/policy mocks.
Can verify the deployed Pages origin with --base-url.
"""
import argparse,json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--base-url');parser.add_argument('--output',type=Path,default=ROOT/'evidence/tip-browser');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
report={'checks':[],'errors':[],'origin':args.base_url or 'exact built HTML via set_content'}
def check(name,ok,detail=None):
 if not ok:raise AssertionError((name,detail))
 report['checks'].append({'name':name,'passed':True,'detail':detail});print('PASS',name,flush=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL') or None,executable_path=None if os.environ.get('BROWSER_CHANNEL') else os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 p=b.new_page(viewport={'width':1600,'height':1050});p.on('pageerror',lambda e:report['errors'].append(str(e)))
 try:
  if args.base_url:p.goto(args.base_url,wait_until='load',timeout=90000)
  else:p.set_content((ROOT/'index.html').read_text(),wait_until='load')
  p.wait_for_function('PPOStep.status().ready');status=lambda:p.evaluate('PPOStep.status()')
  def reset():
   p.click('[data-chapter="1"]');p.click('#resetWorld')
   if status()['paused']:p.click('#playWorld')
  def hold(force='.1',button='pushRight'):
   # Set via real select widget, not learner/plant state mutation.
   p.select_option('#pushForce',format(float(force), 'g'));r=p.locator('#'+button).bounding_box();p.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);p.mouse.down()
  check('Single scene; detail panels closed in the live chapter',p.locator('#world').count()==1 and not p.locator('#recordPicker').evaluate('(e)=>e.open') and not p.locator('#conditionDetails').evaluate('(e)=>e.open'))
  reset();initial=status();weights=p.evaluate('JSON.stringify(S.actor.snapshot())');hold();p.wait_for_timeout(360);during=status()
  check('Force begins during pointerdown and lasts longer than the old 0.20 s pulse',during['tipForce']==.1 and during['holdSeconds']>=.28,during)
  check('Actor continues at every physical control step while force is held',during['policyCalls']-initial['policyCalls']>=12 and during['policyCalls']-initial['policyCalls']==during['physicsSteps']-initial['physicsSteps'])
  check('Tip and cart forces remain distinct',during['userForce']==0 and during['drive']['tipForce']==.1)
  check('Force duration and signed impulse count actual integration time',abs(during['holdImpulse']-.1*during['holdSeconds'])<1e-10)
  check('Frozen inference does not update policy weights',p.evaluate('JSON.stringify(S.actor.snapshot())')==weights)
  p.screenshot(path=str(args.output/'holding.png'))
  p.mouse.up();p.wait_for_timeout(60);check('Release stops force on the next control tick; no release-triggered pulse',status()['heldForce']==0 and status()['tipForce']==0)
  reset();hold(button='pushLeft');p.wait_for_timeout(80);check('Opposite button sends a negative tip force',status()['tipForce']==-.1)
  p.mouse.move(15,15);p.mouse.up();p.wait_for_timeout(60);check('Release outside the button cannot leave force stuck',status()['heldForce']==0 and status()['tipForce']==0)
  for event in ['pointercancel','lostpointercapture']:
   reset();hold();p.dispatch_event('#pushRight',event,{'pointerId':1});p.mouse.up();p.wait_for_timeout(40);check(event+' clears held ownership',status()['heldForce']==0)
  for event in ['blur','visibilitychange']:
   reset();hold();p.evaluate("(event)=>{(event==='blur'?window:document).dispatchEvent(new Event(event))}",event);p.mouse.up();p.wait_for_timeout(40);check(event+' clears force without touching learned parameters',status()['heldForce']==0)
  reset();p.locator('#chapterTitle').click();p.keyboard.down('ArrowRight');p.wait_for_timeout(100);check('Arrow key maintains force while pressed',status()['heldForce']==.1 and status()['tipForce']==.1)
  p.keyboard.down('ArrowLeft');p.wait_for_timeout(40);check('Opposite held keys cancel without accumulating force',status()['heldForce']==0)
  p.keyboard.up('ArrowLeft');p.wait_for_timeout(40);check('Releasing one key restores the other held direction',status()['heldForce']==.1)
  p.keyboard.up('ArrowRight');p.wait_for_timeout(40);check('Key release stops force',status()['heldForce']==0)
  reset();p.locator('#pushRight').focus();p.keyboard.down('Space');p.wait_for_timeout(80);check('Focused button supports accessible Space hold',status()['tipForce']==.1);p.keyboard.up('Space');check('Accessible release clears input',status()['heldForce']==0)
  reset();hold();p.keyboard.press('Escape');p.mouse.up();check('Escape cancels held force',status()['heldForce']==0)
  reset();p.locator('#chapterTitle').click();p.keyboard.down('ArrowRight');p.click('#playWorld');p.keyboard.up('ArrowRight');n=status()['policyCalls'];p.wait_for_timeout(80);check('Pausing releases force and stops counted inference',status()['heldForce']==0 and status()['policyCalls']==n)
  reset();p.locator('#chapterTitle').click();p.keyboard.down('ArrowRight');p.click('#conditionsBtn');p.keyboard.up('ArrowRight');check('Opening conditions cancels held force',status()['heldForce']==0);p.click('#closeConditions')
  reset();p.locator('#chapterTitle').click();p.keyboard.down('ArrowRight');p.click('[data-chapter="3"]');p.keyboard.up('ArrowRight');check('Entering recorded calculations cancels force',status()['mode']=='sample' and status()['heldForce']==0)
  reset();p.wait_for_timeout(100);p.click('#inspectLiveDecision');s=status();p.wait_for_timeout(80);check('Inspect button freezes an actual forward decision, not a different rollout sample',s['chapter']==2 and s['netLive'] and s['paused'] and s['policyCalls']==status()['policyCalls'])
  identity=p.evaluate('JSON.stringify({p:S.actor.p,s:S.env.s,c:S.clock})');p.select_option('#language','ko');check('Language switch preserves numeric state',p.evaluate('JSON.stringify({p:S.actor.p,s:S.env.s,c:S.clock})')==identity)
  p.select_option('#language','en');p.click('[data-chapter="1"]');check('Returned first chapter remains translated','Push the pole' in p.locator('#chapterTitle').inner_text())
  reset();p.click('#playWorld');p.select_option('#pushForce','12');p.click('#playWorld');hold('12');p.wait_for_function('PPOStep.status().liveTerminated',timeout=5000);p.mouse.up();s=status();p.wait_for_timeout(150)
  check('Large tip load produces an explicit physical/model stop and releases force',s['failureReason'] in ['pole_angle','track_limit','no_slip_model_limit'] and s['heldForce']==0,s['failureReason'])
  check('Stopped physics cannot accumulate fake policy/clock steps',status()['policyCalls']==s['policyCalls'] and status()['clockSteps']==s['clockSteps'])
  check('Stop reason is visible without expanding details','STOP' in p.locator('#controlStatus').inner_text())
  p.screenshot(path=str(args.output/'stopped.png'))
  p.click('#resetWorld');p.click('[data-chapter="5"]');p.click('#oneIteration');p.wait_for_function('PPOStep.status().latestIteration===1 && !PPOStep.status().busy',timeout=90000)
  u=p.evaluate('(()=>{const r=PPOStep.record(1);return [r.envSteps,r.policy.actor.t,r.stats.actorGrad]})()');check('Real PPO still collects 2048 experiences and takes 64 Adam steps',u[0]==2048 and u[1]==64 and u[2]>0,u)
  check('Independent evaluations clearly retain the cart-body pulse contract','CART-BODY' in p.locator('#pulseDescription').inner_text())
  check('No page errors',not report['errors'],report['errors']);report['passed']=True
 except Exception as e:
  report['passed']=False;report['error']=str(e);p.screenshot(path=str(args.output/'failure.png'));raise
 finally:
  (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));b.close()
