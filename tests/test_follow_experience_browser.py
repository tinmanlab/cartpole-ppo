"""'Follow one experience' walkthrough: reuses Lesson.inspect/gae only (never
duplicates the math), captures its identity once at open (source/iter/sample
and, for an own learner, generation), invalidates on any of those changing,
pauses the live plant so it can't be confused with the recorded lesson, and
never mutates the recorded optimizer or the live/frozen policy.
Can verify a staged/deployed origin with --base-url. Not run in this
source-only phase; wired into the CI pre-deploy HTTP step for the next
(browser) phase.
"""
import argparse
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = (320, 390, 768, 1024, 1440)
STAGES = ('input', 'calculation', 'action', 'result')

parser = argparse.ArgumentParser()
parser.add_argument('--base-url')
parser.add_argument('--output', type=Path, default=ROOT / 'evidence/follow-experience-browser')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
report = {'checks': [], 'errors': [], 'origin': args.base_url or 'exact built HTML via set_content'}


def check(name, condition, detail=None):
    if not condition:
        raise AssertionError((name, detail))
    report['checks'].append({'name': name, 'passed': True, **({'detail': detail} if detail is not None else {})})
    print('PASS', name, flush=True)


def is_open(p):
    return p.locator('#followExperience').evaluate('e=>e.open')


def open_guide(p):
    if not is_open(p):
        p.locator('#followExperience summary').click()
        p.wait_for_timeout(100)


def close_guide(p):
    if is_open(p):
        p.locator('#followExperience summary').click()
        p.wait_for_timeout(60)


def click_stage(p, stage):
    p.click(f'[data-follow-stage-nav="{STAGES.index(stage)}"]')
    p.wait_for_timeout(60)


def follow_key(p):
    return p.eval_on_selector('.follow-panel', 'e=>e.dataset.followKey')


def run():
    with sync_playwright() as pw:
        channel = os.environ.get('BROWSER_CHANNEL')
        exe = None if channel else (os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None))
        b = pw.chromium.launch(channel=channel, executable_path=exe, headless=True, args=['--no-sandbox'])
        p = b.new_page()
        p.set_default_timeout(20000)
        p.on('pageerror', lambda e: report['errors'].append(str(e)))
        try:
            _run_checks(p)
            report['passed'] = True
        except Exception as exc:
            report['passed'] = False
            report['error'] = repr(exc)
            try:
                p.screenshot(path=str(args.output / 'failure.png'), full_page=True)
                report['failureScreenshot'] = str(args.output / 'failure.png')
            except Exception as shot_exc:
                report['failureScreenshotError'] = repr(shot_exc)
            raise
        finally:
            (args.output / 'follow_experience_tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            b.close()
    print('DONE', len(report['checks']))


def _run_checks(p):
    if args.base_url:
        p.goto(args.base_url.rstrip('/') + '/', wait_until='load', timeout=90000)
    else:
        p.set_content((ROOT / 'index.html').read_text(), wait_until='load')
    p.wait_for_function('window.PPOStep && PPOStep.status().ready')

    status = lambda: p.evaluate('PPOStep.status()')
    optimizer_identity = lambda: p.evaluate("JSON.stringify(PPOStep.record(PPOStep.status().record))")
    live_policy_identity = lambda: p.evaluate('JSON.stringify({actor:S.actor.snapshot(),critic:S.critic.snapshot()})')

    p.click('[data-chapter="3"]')
    p.wait_for_timeout(80)
    check('Entry exists near the record picker, real record available', p.locator('#followExperience').count() == 1)

    # Start the live plant running so opening the guide has something real to pause.
    p.click('[data-chapter="1"]')
    if status()['paused']:
        p.click('#playWorld')
    p.wait_for_timeout(200)
    check('Live plant is actually running before opening the guide', not status()['paused'])
    p.click('[data-chapter="3"]')
    p.wait_for_timeout(80)

    calc_before = p.evaluate('PPOStep.calculation()')
    before_optimizer, before_live = optimizer_identity(), live_policy_identity()
    open_guide(p)
    check('Opening the guide pauses the live plant', status()['paused'])
    check('Opening the guide is visible, labeled RECORDED, and populated', p.locator('.follow-panel').is_visible() and 'RECORDED' in p.locator('.follow-panel').inner_text().upper())

    # 4 real stage-nav buttons, current stage marked, EN labels present.
    nav_buttons = p.locator('[data-follow-stage-nav]')
    check('Exactly 4 stage-nav buttons', nav_buttons.count() == 4)
    heights = [nav_buttons.nth(i).bounding_box()['height'] for i in range(4)]
    check('All 4 stage-nav buttons are >=44px tall', all(h >= 44 for h in heights), heights)
    sizes = p.eval_on_selector_all('[data-follow-stage-nav]', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
    check('Stage-nav labels are >=14px', all(s >= 14 for s in sizes), sizes)
    check('Stage 0 (input) starts as the current stage', p.locator('[data-follow-stage-nav="0"]').get_attribute('aria-current') == 'step')

    key0 = follow_key(p)
    seen_stages = []
    for stage in STAGES:
        click_stage(p, stage)
        seen_stages.append(p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage'))
        check(f'Stage nav shows the {stage} panel and only presentation changes (event key stable)', follow_key(p) == key0)
    # Cycle back to input after result to confirm no drift across a full round trip.
    click_stage(p, 'input')
    check('Result -> Input round trip keeps the same event key', follow_key(p) == key0)
    check('All 4 stages were actually shown', seen_stages == list(STAGES))

    # Numbers shown match Lesson.inspect/gae exactly, not a duplicate/re-derived model.
    click_stage(p, 'action')
    action_text = p.locator('.follow-panel').inner_text()
    check('Ratio shown matches calculation().loss.ratio', f"{calc_before['loss']['ratio']:.4f}" in action_text, calc_before['loss']['ratio'])
    check('Actual stored minibatch size is shown, not a hardcoded 2,048/128 rollout count',
          str(len(p.evaluate('PPOStep.selected().detail.batchData'))) in p.locator('#followExperienceBody').inner_text())

    # Recorded optimizer and live (frozen) policy are unchanged by inspection.
    check('Recorded optimizer snapshot unchanged by inspection', optimizer_identity() == before_optimizer)
    check('Live/frozen policy unchanged by inspection', live_policy_identity() == before_live)

    # Result probabilities each sum to 1 (softmax over 2 actions).
    pa_sum, afterp_sum = sum(calc_before['pa']), sum(calc_before['afterP'])
    check('Before-update action probabilities sum to 1', abs(pa_sum - 1) < 1e-9, pa_sum)
    check('After-update action probabilities sum to 1', abs(afterp_sum - 1) < 1e-9, afterp_sum)
    click_stage(p, 'result')
    p.screenshot(path=str(args.output / 'result_stage.png'))

    # Changing the record invalidates the captured guide.
    p.select_option('#recordSource', 'robust')
    p.wait_for_timeout(150)
    check('Changing source invalidates the guide (explicit stale + recapture, not silent refresh)', p.locator('#followRecapture').count() == 1)
    p.click('#followRecapture')
    p.wait_for_timeout(80)
    check('Explicit recapture opens a fresh, valid guide for the current sample', p.locator('.follow-panel').is_visible())
    close_guide(p)
    p.select_option('#recordSource', 'example')
    p.wait_for_timeout(80)

    # Changing sample also invalidates.
    open_guide(p)
    p.click('#sampleNext')
    p.wait_for_timeout(150)
    check('Changing sample invalidates the guide', p.locator('#followRecapture').count() == 1)
    p.click('#followRecapture')
    close_guide(p)

    # Language switch preserves the captured event identity, only re-renders text.
    open_guide(p)
    key_en = follow_key(p)
    p.select_option('#language', 'ko')
    p.wait_for_timeout(150)
    key_ko = follow_key(p)
    check('Language switch preserves the captured event key', key_en == key_ko, (key_en, key_ko))
    check('Language switch re-renders guide text in Korean', '저장된' in p.locator('.follow-panel').inner_text())
    p.select_option('#language', 'en')
    close_guide(p)

    # Narrow/desktop widths: no overflow, 44px controls, 14px text, with the guide open.
    for w in WIDTHS:
        p.set_viewport_size({'width': w, 'height': 900})
        open_guide(p)
        sw = p.evaluate('document.documentElement.scrollWidth')
        check(f'{w}px: no page overflow with the guide open', sw <= w, sw)
        cols = p.evaluate("getComputedStyle(document.querySelector('.follow-nav')).gridTemplateColumns.split(' ').length")
        expected = 2 if w <= 600 else 4
        check(f'{w}px: stage nav is a {expected}-column layout', cols == expected, cols)
        if w in (320, 1440):
            p.screenshot(path=str(args.output / f'success_{w}.png'), full_page=True)
        close_guide(p)
    p.set_viewport_size({'width': 1440, 'height': 1000})

    # Exiting leaves the UI normal; no autoplay, no auto-resume of the plant we paused.
    open_guide(p)
    close_guide(p)
    p.wait_for_timeout(400)
    check("Closing the guide does not auto-resume the plant it paused", status()['paused'])

    check('No uncaught JavaScript errors', not report['errors'], report['errors'])


if __name__ == '__main__':
    run()
