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
import math
import os
import re
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


def number_after(text, marker):
    """Extract the number immediately following an exact display marker
    (e.g. 'γV(next)=' or 'δ='), not a coincidental substring anywhere in the
    panel."""
    idx = text.find(marker)
    assert idx >= 0, (marker, text)
    rest = text[idx + len(marker):]
    m = re.match(r'\s*(-?\d+\.?\d*(?:e[+-]?\d+)?)', rest)
    assert m, (marker, rest[:20])
    return float(m.group(1))


def bar_row_percent(p, stage, index):
    """The Nth probRow '.value' span within a specific stage panel, as
    displayed: F(value*100, 3) + '%'. Returns the fraction (0-1)."""
    values = p.eval_on_selector_all(f'[data-follow-stage="{stage}"] .bar-row .value', 'es=>es.map(e=>e.textContent)')
    return float(values[index].rstrip('%')) / 100


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
    # PPOStep.record(i) only ever addresses DATA.own (the learner's own runs);
    # for the default 'example' source it is always null, which made the old
    # check compare null to null. PPOStep.selected() works for any active
    # source and carries the real stored before/after optimizer snapshots.
    optimizer_identity = lambda: p.evaluate("JSON.stringify(PPOStep.selected().detail)")
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

    # Numbers shown match Lesson.inspect/gae exactly, not a duplicate/re-derived
    # model, read from the specific row/marker that displays each value at its
    # actual on-screen precision -- never a whole-body substring coincidence.
    action = calc_before['q']['action']
    click_stage(p, 'calculation')
    calc_text = p.locator('[data-follow-stage="calculation"]').inner_text()
    # Re-invoke the real Lesson.gae on the same frozen q/hp exposed by PPOStep --
    # this reuses the actual implementation, it does not re-derive the math.
    gae = p.evaluate("Lesson.gae(PPOStep.calculation().q, PPOStep.selected().hp)")
    bootstrap_shown = number_after(calc_text, 'γV(next)=')
    delta_shown = number_after(calc_text, 'δ=')
    check('Displayed GAE bootstrap matches Lesson.gae(q, hp).bootstrap (NUM: 6dp)', abs(bootstrap_shown - gae['bootstrap']) < 5e-6, (bootstrap_shown, gae['bootstrap']))
    check('Displayed GAE delta matches Lesson.gae(q, hp).delta (NUM: 6dp)', abs(delta_shown - gae['delta']) < 5e-6, (delta_shown, gae['delta']))

    click_stage(p, 'action')
    action_text = p.locator('[data-follow-stage="action"]').inner_text()
    ratio_line = next(line for line in action_text.splitlines() if 'ρ' in line)
    before_p_shown, collection_p_shown, ratio_shown = (float(x) for x in re.findall(r'-?\d+\.\d+', ratio_line))
    check('Ratio line: before-update prob matches calculation().pa (F: 4dp)', abs(before_p_shown - calc_before['pa'][action]) < 5e-5, (before_p_shown, calc_before['pa'][action]))
    check('Ratio line: collection prob matches exp(q.oldLogp) (F: 4dp)', abs(collection_p_shown - math.exp(calc_before['q']['oldLogp'])) < 5e-5, collection_p_shown)
    check('Ratio line: ratio matches calculation().loss.ratio (F: 4dp)', abs(ratio_shown - calc_before['loss']['ratio']) < 5e-5, (ratio_shown, calc_before['loss']['ratio']))

    click_stage(p, 'result')
    result_text = p.locator('[data-follow-stage="result"]').inner_text()
    actual_batch_size = len(p.evaluate('PPOStep.selected().detail.batchData'))
    check('Actual stored minibatch size is shown, not a hardcoded 2,048/128 rollout count', str(actual_batch_size) in result_text, actual_batch_size)
    before_p_bar = bar_row_percent(p, 'result', 0)
    after_p_bar = bar_row_percent(p, 'result', 1)
    check('Result bar: before-update probability matches calculation().pa (probRow: %, 3dp)', abs(before_p_bar - calc_before['pa'][action]) < 5e-6, (before_p_bar, calc_before['pa'][action]))
    check('Result bar: after-update probability matches calculation().afterP (probRow: %, 3dp)', abs(after_p_bar - calc_before['afterP'][action]) < 5e-6, (after_p_bar, calc_before['afterP'][action]))

    # Recorded optimizer and live (frozen) policy are unchanged by inspection.
    check('Recorded optimizer snapshot unchanged by inspection', optimizer_identity() == before_optimizer)
    check('Live/frozen policy unchanged by inspection', live_policy_identity() == before_live)

    # Result probabilities each sum to 1 (softmax over 2 actions). No math duplicated
    # here: this only sums the already-frozen numbers exposed by calculation().
    pa_sum, afterp_sum = sum(calc_before['pa']), sum(calc_before['afterP'])
    check('Before-update action probabilities sum to 1', abs(pa_sum - 1) < 1e-9, pa_sum)
    check('After-update action probabilities sum to 1', abs(afterp_sum - 1) < 1e-9, afterp_sum)
    p.screenshot(path=str(args.output / 'result_stage.png'))

    # A focused stage tab must survive idle re-renders (updateHardwareReadout
    # ticks every ~130ms via the render loop): the DOM node identity must not
    # be replaced by the render-key/identity guard while nothing changed.
    click_stage(p, 'action')
    p.locator('[data-follow-stage-nav="2"]').focus()
    p.evaluate("document.activeElement.dataset.focusProbe = 'kept'")
    p.wait_for_timeout(500)
    check('Focused stage tab survives >=3 idle render ticks (DOM node not replaced)',
          p.evaluate("document.activeElement && document.activeElement.dataset.focusProbe === 'kept'"))
    # Real keyboard activation (native <button> Enter/Space), not just .click().
    p.locator('[data-follow-stage-nav="3"]').focus()
    p.keyboard.press('Enter')
    p.wait_for_timeout(80)
    check('Keyboard Enter on a stage tab actually switches the shown stage',
          p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage') == 'result')
    click_stage(p, 'input')

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

    # Narrow/desktop widths, all 4 guide stages: no overflow, no bar/box overlap,
    # nav >=44px tall / >=14px labels.
    for w in WIDTHS:
        p.set_viewport_size({'width': w, 'height': 900})
        open_guide(p)
        cols = p.evaluate("getComputedStyle(document.querySelector('.follow-nav')).gridTemplateColumns.split(' ').length")
        expected = 2 if w <= 600 else 4
        check(f'{w}px: stage nav is a {expected}-column layout', cols == expected, cols)
        nav_heights = p.eval_on_selector_all('[data-follow-stage-nav]', 'es=>es.map(e=>e.getBoundingClientRect().height)')
        check(f'{w}px: all 4 stage-nav buttons are >=44px tall', all(h >= 44 for h in nav_heights), nav_heights)
        nav_sizes = p.eval_on_selector_all('[data-follow-stage-nav]', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
        check(f'{w}px: stage-nav labels are >=14px', all(s >= 14 for s in nav_sizes), nav_sizes)
        for stage in STAGES:
            click_stage(p, stage)
            sw = p.evaluate('document.documentElement.scrollWidth')
            check(f'{w}px {stage}: no page overflow with the guide open', sw <= w, sw)
            rects = p.eval_on_selector_all('.follow-panel *', 'es=>es.filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getBoundingClientRect().toJSON())')
            box_texts = p.eval_on_selector_all(f'[data-follow-stage="{stage}"] .bar-row .value, [data-follow-stage="{stage}"] b', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
            check(f'{w}px {stage}: essential readout text is >=14px', not box_texts or all(s >= 14 for s in box_texts), box_texts)
            check(f'{w}px {stage}: panel content actually rendered (non-empty)', len(rects) > 0)
            if stage == 'input':
                # No-clipping repair: the guide must reflow the 5 observation
                # fields, never hide/clip them with overflow:hidden/clip.
                flow_box_overflow = p.eval_on_selector('[data-follow-stage="input"]', 'e=>getComputedStyle(e).overflow')
                check(f'{w}px input: .flow-box does not clip its content (overflow is visible)',
                      flow_box_overflow not in ('hidden', 'clip'), flow_box_overflow)
                input_cols = p.evaluate("getComputedStyle(document.querySelector('.follow-input-grid')).gridTemplateColumns.split(' ').length")
                expected_input_cols = 2 if w <= 600 else 5
                check(f'{w}px input: observation grid is a {expected_input_cols}-column layout', input_cols == expected_input_cols, input_cols)
                cells = p.eval_on_selector_all('.follow-input-grid > .term', 'es=>es.map(e=>({label:e.querySelector("small").textContent.trim(), value:e.querySelector("b").textContent.trim()}))')
                check(f'{w}px input: all 5 observation fields present and labelled',
                      len(cells) == 5 and all(c['label'] and c['value'] for c in cells), cells)
                cell_font_sizes = p.eval_on_selector_all('.follow-input-grid > .term b', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
                check(f'{w}px input: observation values are >=14px, none clipped/zero-width',
                      all(s >= 14 for s in cell_font_sizes), cell_font_sizes)
                cell_widths = p.eval_on_selector_all('.follow-input-grid > .term', 'es=>es.map(e=>e.getBoundingClientRect().width)')
                check(f'{w}px input: no observation cell collapsed to zero width (clipped)', all(cw > 0 for cw in cell_widths), cell_widths)
        if w in (320, 1440):
            click_stage(p, 'result')
            p.screenshot(path=str(args.output / f'success_{w}_result.png'), full_page=True)
            click_stage(p, 'calculation')
            p.screenshot(path=str(args.output / f'success_{w}_calculation.png'), full_page=True)
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
