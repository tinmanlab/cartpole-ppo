"""Test actual HTTP-hosted bytes and browser interaction; never mock a route.

Use --base-url from actions/deploy-pages output, not a guessed repository URL.
The same test can run against a local HTTP server at a repository subpath.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import time
import traceback
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORT = {'checks': [], 'http': [], 'pageErrors': []}


def check(name, condition, detail=None):
    if not condition:
        raise AssertionError((name, detail))
    REPORT['checks'].append({'name': name, 'passed': True, 'detail': detail})
    print('PASS', name, flush=True)


def fetch(url):
    request = Request(url, headers={'User-Agent': 'CartPole-Pages-Verification/1.0', 'Accept-Encoding': 'identity'})
    with urlopen(request, timeout=60) as response:
        body = response.read()
        REPORT['http'].append({'url': url, 'status': response.status, 'contentType': response.headers.get('Content-Type'), 'bytes': len(body)})
        return body


def run(base, revision, output, wait_seconds):
    base = base.rstrip('/') + '/'
    if urlparse(base).scheme not in ('http', 'https'):
        raise ValueError('A complete HTTP(S) Pages URL is required.')
    REPORT.update(baseUrl=base, expectedRevision=revision)
    # Pages can report deployment success before every edge has the new bytes.
    # Wait for this exact revision, not any successful HTTP response.
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            manifest = json.loads(fetch(urljoin(base, 'deployment.json') + '?revision=' + revision))
            if manifest.get('revision') != revision:
                raise ValueError('An older deployment is still being served.')
            body = fetch(base)
            if hashlib.sha256(body).hexdigest() != manifest['files']['index.html']['sha256']:
                raise ValueError('Root HTML is not yet from the expected deployment.')
            break
        except Exception as exc:
            if time.monotonic() >= deadline:
                raise
            print('Waiting for exact Pages revision:', str(exc), flush=True)
            time.sleep(5)
    check('Public root serves this exact deployed viewer', True, {'revision': revision, 'sha256': hashlib.sha256(body).hexdigest()})
    for name in ('index.html', 'viewer.ko.html', 'docs/demo.html', 'docs/media/hero.png', 'docs/media/demo.gif', 'docs/media/walkthrough.mp4', 'archive/ko/bam-studio.original.html'):
        data = body if name == 'index.html' else fetch(urljoin(base, name))
        check('HTTP bytes match manifest: ' + name, hashlib.sha256(data).hexdigest() == manifest['files'][name]['sha256'])

    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.values = []
        def handle_starttag(self, tag, attrs):
            for key, value in attrs:
                if key in ('href', 'src', 'poster') and value:
                    self.values.append(value)
    parser = Links()
    parser.feed(fetch(urljoin(base, 'docs/demo.html')).decode())
    for href in sorted(set(parser.values)):
        full = urljoin(urljoin(base, 'docs/demo.html'), href)
        if urlparse(full).netloc == urlparse(base).netloc:
            check('Walkthrough local link resolves: ' + href, len(fetch(full)) > 0)

    with sync_playwright() as pw:
        channel = os.environ.get('BROWSER_CHANNEL')
        executable = os.environ.get('CHROMIUM_PATH') if not channel else None
        if not channel and not executable and Path('/usr/bin/chromium').exists():
            executable = '/usr/bin/chromium'
        # The existing walkthrough is H.264. Bundled Chromium and branded
        # Chrome have different licensed codec sets; record that distinction.
        codec = '(document.createElement("video")).canPlayType(\'video/mp4; codecs="avc1.640028"\')'
        if channel == 'chrome':
            probe = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            REPORT['bundledChromiumH264'] = probe.new_page().evaluate(codec)
            probe.close()
        browser = pw.chromium.launch(channel=channel, executable_path=executable, headless=True, args=['--no-sandbox'])
        REPORT['browser'] = {'channel': channel or 'chromium', 'version': browser.version}
        context = browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(30000)
        REPORT['selectedBrowserH264'] = page.evaluate(codec)
        print('CODEC', json.dumps({k: REPORT.get(k) for k in ('browser', 'bundledChromiumH264', 'selectedBrowserH264')}), flush=True)
        check('Test browser supports the supplied H.264 video', bool(REPORT['selectedBrowserH264']))
        page.on('pageerror', lambda e: REPORT['pageErrors'].append(str(e)))
        response = page.goto(base, wait_until='load', timeout=90000)
        check('Browser opens the public URL, not set_content', response.status == 200, page.url)
        page.wait_for_function('window.PPOStep && PPOStep.status().ready')
        status = lambda: page.evaluate('PPOStep.status()')
        check('Fresh visit defaults to English', status()['language'] == 'en')
        check('Own learner starts random while an example runs', status()['latestIteration'] == 0 and status()['appliedSource'] == 'example')
        page.click('#dismissGuide')
        page.wait_for_timeout(1200)
        check('Real physics advances in the hosted page', status()['physicsSteps'] > 10)
        if not status()['paused']:
            page.click('#playWorld')
        identity = "JSON.stringify({actor:S.actor.snapshot(),critic:S.critic.snapshot(),state:S.env.s,clock:S.clock,sample:S.sample,record:S.selected,learner:S.latest.policy})"
        before = page.evaluate(identity)
        page.select_option('#language', 'ko')
        check('Korean translation preserves numerical state', status()['language'] == 'ko' and page.evaluate(identity) == before)
        page.select_option('#language', 'en')
        check('English round-trip preserves numerical state', status()['language'] == 'en' and page.evaluate(identity) == before)
        old_steps = status()['physicsSteps']
        page.click('#singleStep')
        check('One-step control performs one physical step', status()['physicsSteps'] == old_steps + 1)
        page.eval_on_selector('#target', '(e)=>{e.value="0.4";e.dispatchEvent(new Event("input",{bubbles:true}));}')
        check('Target control reaches the real environment', status()['liveGoal'] == 0.4)
        page.click('#targetZero')
        page.click('#resetWorld')
        page.select_option('#pushForce', '4')
        page.select_option('#pushDuration', '0.2')
        page.click('#playWorld')
        page.click('#pushRight')
        page.wait_for_function('PPOStep.status().userForce === 4')
        check('Manual push is applied to live physics', status()['userForce'] == 4)
        page.wait_for_function('PPOStep.status().pulseSteps === 0')
        if not status()['paused']:
            page.click('#playWorld')
        page.screenshot(path=str(output / 'live.png'))

        sample_id = None
        for chapter in (2, 3, 4):
            page.click(f'[data-chapter="{chapter}"]')
            current = status()['sampleID']
            check(f'Chapter {chapter} uses a real recorded sample', current is not None)
            if sample_id is not None:
                check(f'Chapter {chapter} preserves the selected experience', current == sample_id)
            sample_id = current
        page.click('[data-chapter="2"]')
        page.select_option('#netMode', 'delta')
        check('Network update view contains actual signed deltas', page.locator('line[data-encoded]').evaluate_all('(xs)=>xs.some(x=>Math.abs(Number(x.dataset.encoded))>0)'))
        page.screenshot(path=str(output / 'network.png'))
        page.click('[data-chapter="5"]')
        page.click('#oneIteration')
        page.wait_for_function('PPOStep.status().latestIteration === 1 && !PPOStep.status().busy', timeout=90000)
        update = page.evaluate('(()=>{const r=PPOStep.record(1);return {samples:r.envSteps,adam:r.policy.actor.t,changed:r.policy.actor.p.some((v,i)=>v!==r.before.actor.p[i]),grad:r.stats.actorGrad};})()')
        check('Hosted Worker collects 2048 experiences and performs 64 real Adam updates', update['samples'] == 2048 and update['adam'] == 64 and update['changed'] and update['grad'] > 0, update)
        page.click('#recordedReplay')
        page.click('#replayNext')
        check('Recorded replay moves forward', status()['replayAt'] == 1)
        page.click('#replayBack')
        check('Recorded replay moves backward', status()['replayAt'] == 0)
        page.click('#leaveReplay')
        check('Live mode can be restored after replay', status()['mode'] == 'live')
        REPORT['runtime'] = {k: status()[k] for k in ('latestIteration', 'physicsSteps', 'rt', 'wall', 'sim', 'language')}

        for route, expected in (('index.html?lang=ko', 'ko'), ('viewer.ko.html', 'ko'), ('?lang=en', 'en')):
            page.goto(urljoin(base, route), wait_until='load', timeout=90000)
            page.wait_for_function('window.PPOStep && PPOStep.status().ready')
            check('Language entry loads: ' + route, status()['language'] == expected)
        page.goto(urljoin(base, 'docs/demo.html'), wait_until='load', timeout=90000)
        page.wait_for_function('document.querySelector("video").readyState >= 1 || document.querySelector("video").error !== null')
        video_state = page.locator('video').evaluate('(v)=>({readyState:v.readyState,networkState:v.networkState,src:v.currentSrc,error:v.error?{code:v.error.code,message:v.error.message}:null})')
        REPORT['videoState'] = video_state
        check('Video decoder reports metadata without an error', video_state['readyState'] >= 1 and video_state['error'] is None, video_state)
        duration = page.locator('video').evaluate('(v)=>v.duration')
        check('Walkthrough metadata decodes in the browser', duration > 45, duration)
        page.locator('video').evaluate('(v)=>{v.muted=true;return v.play();}')
        page.wait_for_function('document.querySelector("video").currentTime > 0.3')
        check('Walkthrough video actually plays', page.locator('video').evaluate('(v)=>!v.paused && v.currentTime > 0.3'))
        page.locator('video').evaluate('(v)=>v.pause()')
        page.screenshot(path=str(output / 'walkthrough.png'))
        page.click('a.action')
        page.wait_for_function('window.PPOStep && PPOStep.status().ready')
        check('Video-page call to action opens the running simulation', status()['ready'] and urlparse(page.url).path.endswith('/index.html'))
        check('No browser JavaScript errors', not REPORT['pageErrors'], REPORT['pageErrors'])
        context.close()
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--expected-revision', required=True)
    parser.add_argument('--wait-seconds', type=int, default=240)
    parser.add_argument('--output', type=Path, default=ROOT / 'evidence/pages')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        run(args.base_url, args.expected_revision, args.output, args.wait_seconds)
        REPORT['passed'] = True
    except Exception:
        REPORT['passed'] = False
        REPORT['error'] = traceback.format_exc()
        raise
    finally:
        (args.output / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'passed': REPORT['passed'], 'checks': len(REPORT['checks']), 'baseUrl': REPORT.get('baseUrl')}, indent=2), flush=True)
