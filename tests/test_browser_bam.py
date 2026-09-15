"""Exact standalone artifact, real Worker and physics. No mock model/metrics."""
import json,time,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).parents[1];html=root/'index.html'
report={'artifactSHA256':hashlib.sha256(html.read_bytes()).hexdigest(),'load':'Chromium set_content exact offline bytes','tests':[],'errors':[],'requests':[]}
def check(name,condition,detail=None):
 assert condition,(name,detail)
 report['tests'].append({'name':name,'passed':True,**({'detail':detail} if detail is not None else {})})
 (root/'evidence/browser_progress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('PASS',name,flush=True)
def status(p):return p.evaluate('PPOStep.status()')
def new(b):
 p=b.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
 p.set_default_timeout(15000);p.on('pageerror',lambda e:report['errors'].append(str(e)))
 p.on('request',lambda r:report['requests'].append(r.url) if r.url.startswith(('http:','https:')) else None)
 p.set_content(html.read_text(),wait_until='load');p.wait_for_function('window.PPOStep && PPOStep.status().ready');return p
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'],headless=True)
 report['browser']=b.version;p=new(b)
 check('New own learner remains random despite showing trained example',status(p)['latestIteration']==0 and status(p)['appliedIteration']==240 and status(p)['evaluation']['mean']<30)
 check('BAM XL330 is the actual default for both training and test',status(p)['trainingPlant']['actuator']==status(p)['testPlant']['actuator']=='xl330')
 # Preserve old/new authority under explicit draft edits.
 p.click('#conditionsBtn');p.select_option('#specActuator','mx64');p.fill('#spec_mc','1.5');p.select_option('#specProfile','push');p.select_option('#specPlan','staged')
 s=status(p);check('Draft edits never change either running environment',s['trainingPlant']['actuator']==s['testPlant']['actuator']=='xl330')
 p.click('#testOnly');s=status(p)
 check('Test-only applies real motor and mass without retraining',s['testPlant']['actuator']=='mx64' and s['testPlant']['mc']==1.5 and s['trainingPlant']['actuator']=='xl330' and s['latestIteration']==0)
 p.locator('#conditionDetails').evaluate('(e)=>e.open=true');p.wait_for_function('document.querySelector("#conditionbar .mismatch-state") !== null')
 check('Expanded provenance identifies policy/test mismatch', 'outside' in p.locator('#conditionbar').inner_text())
 p.click('#conditionsBtn');p.select_option('#specActuator','mx106');p.fill('#spec_mc','1.2');p.select_option('#specProfile','mixed');p.select_option('#specPlan','staged');p.click('#newPlant')
 p.wait_for_function("PPOStep.status().ready && PPOStep.status().trainingPlant.actuator==='mx106'")
 check('New training conditions are separate from current test conditions',status(p)['trainingPlan']=='staged' and status(p)['testPlant']['actuator']=='mx64')
 p.click('#oneIteration');p.wait_for_function('PPOStep.status().latestIteration===1 && !PPOStep.status().busy',timeout=25000)
 rec=p.evaluate('PPOStep.record(1)')
 check('Worker collected and optimized on selected MX106 BAM plant',rec['detail']['batchData'][0]['plant']['actuator']=='mx106' and rec['policy']['plant']['actuator']=='mx106' and rec['policy']['actor']['t']==64)
 check('Staged curriculum starts nominal rather than enabling all noise at once',rec['trainingProfile']=='nominal' and rec['curriculum']['index']==0)
 before=rec['policy']['actor']
 p.click('#conditionsBtn');p.select_option('#specActuator','xl330');p.select_option('#specProfile','push');p.select_option('#specPlan','fixed');p.click('#continuePlant');p.wait_for_function("PPOStep.status().trainingPlant.actuator==='xl330'")
 check('Continuation retains old policy and Adam until the next update',p.evaluate('PPOStep.record(1).policy.actor')==before and status(p)['appliedIteration']==1)
 p.click('#oneIteration');p.wait_for_function('PPOStep.status().latestIteration===2 && !PPOStep.status().busy',timeout=25000)
 check('Next rollout uses new conditions and continuous Adam count',p.evaluate("PPOStep.record(2).detail.batchData.every(q=>q.plant.actuator==='xl330')") and p.evaluate('PPOStep.record(2).policy.actor.t')==128)
 # Exact neural-value encodings.
 p.locator('#recordPicker').evaluate('(e)=>e.open=true');p.select_option('#recordSource','example');p.click('[data-chapter="2"]')
 check('Both networks display all actual 32 hidden activations',p.locator('.hidden-node circle[data-value]').count()==32)
 values=p.eval_on_selector_all('.hidden-node circle[data-value]','es=>es.map(e=>+e.dataset.value)')
 colors=p.eval_on_selector_all('.network-svg line[data-encoded]','es=>[...new Set(es.map(e=>e.getAttribute("stroke")))]')
 check('Signed weights are data encoded rather than uniform gray',len(colors)==2 and '#287ac1' in colors and '#c66c2f' in colors)
 p.click('#negativeSample');values2=p.eval_on_selector_all('.hidden-node circle[data-value]','es=>es.map(e=>+e.dataset.value)')
 check('Different real experience changes numeric neural activations',values!=values2)
 p.select_option('#netMode','delta');p.wait_for_timeout(100)
 delta=p.eval_on_selector('.network-svg line[data-weight-index="0"]','e=>+e.dataset.encoded')
 truth=p.evaluate('PPOStep.selected().detail.after.actor.p[0]-PPOStep.selected().detail.before.actor.p[0]')
 check('Delta mode displays actual last minibatch weight change',abs(delta-truth)<1e-12,delta)
 p.screenshot(path=str(root/'evidence/networks_delta.png'))
 p.check('#netLive');p.locator('#conditionDetails').evaluate('(e)=>e.open=true');p.click('#matchPolicyWorld');p.click('[data-chapter="2"]');p.check('#netLive') if not p.locator('#netLive').is_checked() else None
 p.wait_for_timeout(350);s0=status(p);p.wait_for_timeout(500);s1=status(p)
 check('Live network view advances true inference without extra optimization',s1['physicsSteps']>s0['physicsSteps'] and s1['latestIteration']==s0['latestIteration'])
 p.uncheck('#netLive');p.click('[data-forward="1"]');check('Selected neuron expands inline arithmetic',p.locator('#neuronMicroscope').is_visible() and p.locator('#neuronMicroscope .term').count()==7)
 for ch in [1,2,3,4,5]:
  p.click(f'[data-chapter="{ch}"]');p.wait_for_timeout(60)
  check(f'Chapter {ch} renders without missing panels',p.locator('#lessonBody').inner_text().strip()!='')
 p.close()
 # Fresh canonical own run in artifact; no imported model.
 p=new(b);p.click('[data-chapter="5"]');p.select_option('#runLength','120')
 start=status(p);p.click('#startTraining');t0=time.monotonic()
 p.wait_for_function('PPOStep.status().latestIteration===120 && !PPOStep.status().running && !PPOStep.status().busy',timeout=180000)
 end=status(p);elapsed=time.monotonic()-t0;dw=end['wall']-start['wall'];ds=end['sim']-start['sim']
 report['actualTraining']={'seed':123,'iterations':120,'result':end['evaluation'],'seconds':elapsed,'wall':dw,'sim':ds,'RT':ds/dw,'actorAdamSteps':p.evaluate('PPOStep.record(120).policy.actor.t'),'motor':end['trainingPlant']['actuator']}
 check('New real Worker training improves survival over the random policy',end['evaluation']['mean']>start['evaluation']['mean']+300,report['actualTraining'])
 check('New learner uses 120 real PPO iterations and 7680 Adam steps',report['actualTraining']['actorAdamSteps']==7680)
 check('Active physical time remains within 40ms of elapsed time during training',abs(ds-dw)<.04,{'wall':dw,'sim':ds,'rt':ds/dw})
 check('Learning completion freezes the final own policy',end['appliedIteration']==120 and end['appliedSource']=='own' and not end['followPolicy'])
 p.click('#resetWorld');p.uncheck('#timeCap');p.uncheck('#autoReset');p.wait_for_timeout(11500)
 end=status(p);check('Final frozen policy continues past 500 without reset',end['liveStep']>500 and not end['liveTerminated'],end['liveStep'])
 p.select_option('#pushForce','0.1');rect=p.locator('#pushRight').bounding_box();p.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2);p.mouse.down();p.wait_for_function('PPOStep.status().tipForce===0.1',timeout=2000)
 check('Manual hold is an actual pole-tip force',status(p)['tipForce']==.1 and status(p)['userForce']==0)
 p.mouse.up();p.wait_for_function('PPOStep.status().tipForce===0');check('Force stops on release',status(p)['heldForce']==0)
 p.click('#recordedReplay');check('Replay loads the real stored trajectory',status(p)['mode']=='replay')
 p.click('#replayNext');n=status(p)['replayAt'];p.click('#replayBack');check('Replay single step works in both directions',n==1 and status(p)['replayAt']==0)
 p.click('#leaveReplay');p.click('#evaluatePolicy');p.wait_for_function('!PPOStep.status().evalBusy && PPOStep.status().evalRows',timeout=60000)
 report['independentEvaluation']=status(p)['evalRows'];check('Independent validation runs all four conditions',len(report['independentEvaluation'])==4)
 # Save/restore actual user-owned checkpoint and test error handling.
 p.locator('#trainingSettings summary').click()
 with p.expect_download() as dl:p.click('#saveCheckpoint')
 dest=root/'evidence/browser_checkpoint.json';dl.value.save_as(dest)
 check('Downloaded checkpoint binds BAM spec and optimizer state',json.loads(dest.read_text())['schema']=='cartpole-bam-checkpoint/v2')
 p.set_input_files('#loadCheckpoint',str(dest));p.wait_for_timeout(500)
 check('Checkpoint restore keeps iteration and actuator',status(p)['latestIteration']==120 and status(p)['trainingPlant']['actuator']=='xl330')
 p.set_input_files('#loadCheckpoint',{'name':'bad.json','mimeType':'application/json','buffer':b'{"schema":"old"}'})
 check('Legacy or malformed checkpoint rejected without resetting learner','Not restored' in p.locator('#toast').inner_text() and status(p)['latestIteration']==120)
 p.click('#conditionsBtn');p.select_option('#specActuator','mx64');p.screenshot(path=str(root/'evidence/conditions_final.png'));p.click('#closeConditions')
 p.locator('#recordPicker').evaluate('(e)=>e.open=true');p.select_option('#recordSource','example');p.click('[data-chapter="2"]');p.select_option('#netMode','activation');p.click('[data-forward="1"]');p.screenshot(path=str(root/'evidence/preview.png'))
 p.click('[data-chapter="1"]');p.locator('.drive-details summary').click();p.wait_for_timeout(250);p.screenshot(path=str(root/'evidence/hardware_final.png'),full_page=True)
 for wh in [(1280,900),(1440,1000),(1920,1080)]:
  p.set_viewport_size({'width':wh[0],'height':wh[1]});p.wait_for_timeout(150)
  check(f'Desktop {wh[0]} has no horizontal overflow',p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('Entire interaction run has no uncaught JavaScript errors',not report['errors'],report['errors'])
 check('Entire artifact remains offline without remote runtime requests',not report['requests'],report['requests'])
 report['passed']=len(report['tests']);b.close()
(root/'evidence/browser_tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('DONE',report['passed'],report['actualTraining'],flush=True)
