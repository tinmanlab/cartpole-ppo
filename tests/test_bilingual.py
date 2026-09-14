"""Public viewer EN/KO equivalence, export diagnostics, and preserved drafts.
No learner, clock, chart value, or Worker is mocked.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,hashlib,os
root=Path(__file__).parents[1]
report={'tests':[],'errors':[],'requests':[],'artifactSHA256':hashlib.sha256((root/'index.html').read_bytes()).hexdigest()}
def check(name, condition, detail=None):
 assert condition,(name,detail)
 report['tests'].append({'name':name,'passed':True,**({'detail':detail} if detail is not None else {})})
 print('PASS',name,flush=True)
def status(p):return p.evaluate('PPOStep.status()')
def identity(p):return p.evaluate("JSON.stringify({snapshot:S.actor.snapshot(),critic:S.critic.snapshot(),env:S.env.s,envRng:S.env.rng.s,noiseRng:S.env.noiseRng.s,frame:S.lastFrame,sample:S.sample,record:S.selected,kind:S.kind,latest:S.latest?.policy,generation:S.generation,clock:S.clock})")
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
 p=b.new_page(viewport={'width':1600,'height':1000},accept_downloads=True)
 p.on('pageerror',lambda e:report['errors'].append(str(e)))
 p.on('request',lambda q:report['requests'].append(q.url) if q.url.startswith(('http:','https:')) else None)
 p.set_content((root/'index.html').read_text(),wait_until='load');p.wait_for_function('PPOStep.status().ready')
 check('Main entry starts in English',p.locator('html').get_attribute('lang')=='en')
 p.click('#playWorld');s0=status(p);check('Pause actually holds live physics',s0['paused'])
 p.wait_for_timeout(80);a=identity(p)
 p.select_option('#language','ko');p.wait_for_timeout(100)
 check('Korean switch preserves weights, physics, clocks, RNG and selected record',identity(p)==a)
 check('Korean interface renders Korean labels',p.locator('#chapterTitle').inner_text()==p.evaluate("tr('m0001')"))
 p.select_option('#language','en');p.wait_for_timeout(100);check('Round trip to English preserves all numerical state',identity(p)==a)
 for chapter in range(1,6):
  p.click(f'[data-chapter="{chapter}"]');p.wait_for_timeout(100)
  residual=p.evaluate("[...document.querySelectorAll('body *')].filter(e=>!e.children.length && e.getClientRects().length && /[가-힣]/.test(e.textContent)).map(e=>e.textContent)")
  check(f'Chapter {chapter}: no untranslated visible Korean in English',not residual,residual)
 check('One main CartPole canvas, no duplicate before/after simulation',p.locator('#world').count()==1)
 # Stored sample and its selected neuron persist through a language switch.
 p.click('[data-chapter="2"]');p.select_option('#netMode','delta');p.click('#negativeSample')
 p.click('[data-forward="1"]');q0=p.evaluate('PPOStep.calculation()');s0=status(p)
 p.select_option('#language','ko');p.select_option('#language','en');q1=p.evaluate('PPOStep.calculation()')
 check('Selected sample, neuron and recorded gradients survive translation',q0==q1 and status(p)['sampleID']==s0['sampleID'])
 # Modal language re-render is an explicit tested internal entry point. User
 # normally closes this modal to reach the header language selector.
 p.click('#conditionsBtn');p.select_option('#specProfile','nominal')
 check('Inactive disturbance fields are disabled; base physics remains editable',p.locator('#spec_push').is_disabled() and p.locator('#spec_mc').is_enabled())
 p.select_option('#specProfile','push');check('Selecting pushes enables only its factor fields',p.locator('#spec_push').is_enabled() and p.locator('#spec_noise').is_disabled())
 p.fill('#spec_mc','1.7');p.fill('#spec_rewardPosition','1.25')
 before=identity(p);p.evaluate("setInterfaceLanguage('ko')");p.evaluate("setInterfaceLanguage('en')")
 check('Locale refresh preserves unapplied physical and reward drafts',p.locator('#spec_mc').input_value()=='1.7' and p.locator('#spec_rewardPosition').input_value()=='1.25')
 check('Draft locale refresh does not apply draft to physics or learner',identity(p)==before and status(p)['testPlant']['mc']==1)
 p.click('#testOnly');check('Explicit test-only applies reward and physical fields, not training',status(p)['testPlant']['rewardPosition']==1.25 and status(p)['trainingPlant']['rewardPosition']==.5)
 # Restore matched scenario for an independent physical test.
 p.click('#matchPolicyWorld');p.click('[data-chapter="5"]')
 if not status(p)['paused']:p.click('#playWorld')
 before=p.evaluate('JSON.stringify(S.applied.policy)')
 p.click('#evaluatePolicy');p.wait_for_function('!PPOStep.status().evalBusy && PPOStep.status().evalRows!==null',timeout=45000)
 check('Held-out evaluation leaves the actual policy unchanged',p.evaluate('JSON.stringify(S.applied.policy)')==before)
 check('Evaluation renders exposure and model-invalid counts','full pulse' in p.locator('#evaluationRows').inner_text() and 'Model-invalid' in p.locator('#evaluationRows').inner_text())
 p.select_option('#language','ko');check('Evaluation labels translate from semantic keys','외란' in p.locator('#evaluationRows').inner_text())
 p.select_option('#language','en')
 with p.expect_download() as out:p.click('#exportEvaluation')
 dest=root/'evidence/public_evaluation.json';out.value.save_as(dest);data=json.loads(dest.read_text());row=data['rows'][2]
 check('JSON records actual requested/delivered impulse and pulse completion',all('deliveredImpulse' in t and 'pulseCompleted' in t and 'outcome' in t for t in row['trials']))
 check('Unreached pulses cannot report completed or recovered',all(t['pulseReached'] or (not t['pulseCompleted'] and t['recoveryTime'] is None) for t in row['trials']))
 report['heldOut']=status(p)['evalRows']
 # Real learning and an in-flight language switch. Deterministic engine record
 # must match a Node-produced expected record, not just an unchanged label.
 p.click('#oneIteration');p.select_option('#language','ko')
 p.wait_for_function('PPOStep.status().latestIteration===1 && !PPOStep.status().busy',timeout=20000)
 p.select_option('#language','en')
 actual=p.evaluate('PPOStep.record(1).policy')
 import subprocess
 expected=json.loads(subprocess.check_output(['node','-e',"let E=require('./src/core');let t=new E.Trainer(123);t.iteration();console.log(JSON.stringify(t.snapshot()));"],cwd=root))
 (root/'evidence/locale_node_difference.json').write_text(json.dumps({'actual':actual,'expected':expected},indent=2))
 diff=max(abs(x-y) for kind in ('actor','critic') for x,y in zip(actual[kind]['p'],expected[kind]['p']))
 check('PPO after in-flight translation agrees with Node within floating-point roundoff',diff<1e-12 and actual['plant']==expected['plant'],{'maxAbsoluteDifference':diff,'tolerance':1e-12})
 check('Learning still renders the experiment chapter after switching language',status(p)['chapter']==5)
 # Korean standalone entry is fully compatible, not a divergent source fork.
 ko=b.new_page(viewport={'width':1440,'height':1000})
 ko.set_content((root/'viewer.ko.html').read_text(),wait_until='load');ko.wait_for_function('PPOStep.status().ready')
 check('Korean entry initializes in Korean from the same engine',ko.locator('html').get_attribute('lang')=='ko' and ko.locator('#engine').text_content()==p.locator('#engine').text_content())
 ko.select_option('#language','en');check('Korean entry can switch back to English',ko.locator('html').get_attribute('lang')=='en')
 ko.close()
 for width,height in [(1280,900),(1440,900),(1920,1080)]:
  p.set_viewport_size({'width':width,'height':height});p.wait_for_timeout(100)
  check(f'English desktop {width}: no horizontal overflow',p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('No uncaught JavaScript exceptions',not report['errors'],report['errors'])
 check('No external runtime requests',not report['requests'],report['requests'])
 b.close()
report['passed']=len(report['tests']);(root/'evidence/bilingual_tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('DONE',report['passed'],flush=True)
