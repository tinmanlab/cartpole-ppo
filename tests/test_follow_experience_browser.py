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
        p.locator('#followExperience > summary').click()
        p.wait_for_timeout(100)


def close_guide(p):
    if is_open(p):
        p.locator('#followExperience > summary').click()
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


def sign_of(x):
    return 'pos' if x > 0 else 'neg' if x < 0 else 'zero'


SIGN_SUFFIX = {'pos': 'Pos', 'neg': 'Neg', 'zero': 'Zero'}


def expected_sign_text(p, base, sign, value):
    """The real localized text for a given raw/normalized-advantage sign,
    fetched from the same tr()/NUM() the app itself calls -- an oracle, not a
    keyword guess, so a correct caveat (which may legitimately contain words
    like 'critic' or 'guarantee' in a negated sentence) is never mistaken for
    the bug it is negating."""
    key = f'follow.{base}{SIGN_SUFFIX[sign]}'
    if sign == 'zero':
        return p.evaluate("(key) => tr(key)", key)
    return p.evaluate("({k, v}) => tr(k, NUM(Math.abs(v)))", {'k': key, 'v': value})


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

    # Layout: the single #followExperience lives on the lesson side of
    # .main-grid (adjacent to the world on desktop, immediately after the
    # world card in DOM/narrow order), not above .main-grid in .sourcebar.
    check('#followExperience is inside .lesson-card, not .sourcebar',
          p.eval_on_selector('#followExperience', "e => !!e.closest('.lesson-card') && !e.closest('.sourcebar')"))
    check('#followExperience is the lesson-card\'s first child (adjacent/early, before the chapter explanation)',
          p.eval_on_selector('#followExperience', "e => e.parentElement.firstElementChild === e"))

    # Default (guide closed): the chapter explanation and support material are
    # NOT disclosures -- no visible summary affordance, fully open/normal.
    check('Lesson explanation disclosure is open by default (normal exploration)', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Support disclosure is open by default (normal exploration)', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    check('Lesson disclosure summary is hidden by default (looks like plain content, not a second lesson toggle)',
          not p.locator('#lessonDisclosure > summary').is_visible())
    check('Support disclosure summary is hidden by default', not p.locator('#supportDisclosure > summary').is_visible())
    check('Guide is closed by default so it never starts as a second simultaneously-expanded lesson', not is_open(p))

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
    check('Guide area names the sibling PPO/Transformer/DiffusionPolicy apps compactly, without a new large header',
          all(name in p.locator('.follow-panel').inner_text() for name in ('PPO', 'Transformer', 'DiffusionPolicy')) and p.locator('.follow-panel h1, .follow-panel h2').count() == 0)

    # Opening the guide folds the chapter explanation and support reading
    # material into explicit, closed-by-default named disclosures, so the
    # guide is never a second simultaneously-expanded lesson.
    check('Opening the guide marks the body as guide-active', p.evaluate("document.body.classList.contains('guide-active')"))
    check('Opening the guide collapses the lesson-explanation disclosure (named, closed by default)',
          not p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Opening the guide collapses the support disclosure (named, closed by default)',
          not p.locator('#supportDisclosure').evaluate('e=>e.open'))
    check('Lesson-explanation disclosure summary becomes visible while the guide is open', p.locator('#lessonDisclosure > summary').is_visible())
    check('Support disclosure summary becomes visible while the guide is open', p.locator('#supportDisclosure > summary').is_visible())
    check('Collapsed lesson disclosure hides its chapter body content (no duplicated simultaneous lesson)',
          not p.locator('#lessonBody').is_visible())
    check('Collapsed support disclosure hides its content', not p.locator('#support').is_visible())

    # F1 (coordinator finding): the new disclosure summaries must meet the same
    # readability/touch-target floor as the rest of the guide, and keep a
    # visible native disclosure marker (not just plain text with no affordance).
    for sel in ('#lessonDisclosure > summary', '#supportDisclosure > summary'):
        box = p.locator(sel).bounding_box()
        font_size = p.eval_on_selector(sel, 'e=>parseFloat(getComputedStyle(e).fontSize)')
        display = p.eval_on_selector(sel, 'e=>getComputedStyle(e).display')
        check(f'{sel}: text is >=14px', font_size >= 14, font_size)
        check(f'{sel}: touch target is >=44px tall', box['height'] >= 44, box)
        check(f'{sel}: keeps a visible native disclosure marker (list-item display)', display == 'list-item', display)

    # Native <details> activation: click and keyboard (Enter/Space on the
    # focused summary) both open the disclosure, and it stays a static shell
    # (no reparenting/duplicate IDs) while toggling.
    p.locator('#lessonDisclosure > summary').click()
    p.wait_for_timeout(30)
    check('Clicking the lesson-explanation summary expands it', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Expanding the lesson disclosure does not duplicate #lessonBody', p.locator('#lessonBody').count() == 1)
    p.locator('#lessonDisclosure > summary').click()
    p.wait_for_timeout(30)
    check('Re-clicking the summary collapses it again', not p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    p.locator('#lessonDisclosure > summary').focus()
    p.keyboard.press('Enter')
    p.wait_for_timeout(30)
    check('Keyboard Enter on the summary expands the lesson-explanation disclosure', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    p.keyboard.press('Enter')
    p.wait_for_timeout(30)
    check('Keyboard Enter again collapses it back to the default closed state', not p.locator('#lessonDisclosure').evaluate('e=>e.open'))

    # 4 real stage-nav buttons, current stage marked, EN labels present.
    nav_buttons = p.locator('[data-follow-stage-nav]')
    check('Exactly 4 stage-nav buttons', nav_buttons.count() == 4)
    heights = [nav_buttons.nth(i).bounding_box()['height'] for i in range(4)]
    check('All 4 stage-nav buttons are >=44px tall', all(h >= 44 for h in heights), heights)
    sizes = p.eval_on_selector_all('[data-follow-stage-nav]', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
    check('Stage-nav labels are >=14px', all(s >= 14 for s in sizes), sizes)
    check('Stage 0 (input) starts as the current stage', p.locator('[data-follow-stage-nav="0"]').get_attribute('aria-current') == 'step')

    # F4: each tab is a real tab associated with its own tabpanel.
    active_tab = p.locator('[data-follow-stage-nav="0"]')
    check('Active tab has aria-controls pointing at a real, visible tabpanel',
          p.eval_on_selector('#followTab-0', "e => { const panel = document.getElementById(e.getAttribute('aria-controls')); return !!panel && panel.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === 'followTab-0'; }"))

    # F1: Input stage explicitly marks features as normalized/dimensionless.
    input_text = p.locator('[data-follow-stage="input"]').inner_text()
    check('Input stage explicitly says the five features are normalized/dimensionless, not physical units',
          'normaliz' in input_text.lower() and 'dimensionless' in input_text.lower())

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

    # F2 (coordinator finding): raw and normalized advantage are DIFFERENT
    # quantities that can have opposite signs after rollout mean-centering/
    # scaling -- the guide must never label the normalized sign as "this
    # experience did better/worse than the Critic expected" (that claim only
    # holds for the GAE value target V_old+A_raw vs V_old). Compared against
    # the real localized text (an oracle), not a keyword blacklist -- a
    # correct caveat legitimately says "not a ... Critic-error claim" and
    # "does not guarantee", and forbidding those words would reject the fix.
    raw_el = p.locator('[data-follow-stage="calculation"] [data-follow-sign="raw"]')
    norm_el = p.locator('[data-follow-stage="calculation"] [data-follow-sign="normalized"]')
    raw_sign, norm_sign = sign_of(gae['raw']), sign_of(gae['normalized'])
    expected_raw_text = expected_sign_text(p, 'calcRaw', raw_sign, gae['raw'])
    expected_norm_text = expected_sign_text(p, 'calcNorm', norm_sign, gae['normalized'])
    check('Raw-advantage sign indicator matches the real sign of A_raw', raw_el.get_attribute('data-follow-sign-value') == raw_sign, (gae['raw'],))
    check('Normalized-advantage sign indicator matches the real sign of A (can differ from A_raw)', norm_el.get_attribute('data-follow-sign-value') == norm_sign, (gae['normalized'],))
    check('Raw-advantage line matches its exact localized text for this real sign', raw_el.inner_text() == expected_raw_text, (raw_el.inner_text(), expected_raw_text))
    check('Normalized-advantage line matches its exact localized text for this real sign', norm_el.inner_text() == expected_norm_text, (norm_el.inner_text(), expected_norm_text))
    check('Raw and normalized advantage lines are worded distinctly, not one claim duplicated', expected_raw_text != expected_norm_text)
    check('Raw-advantage line frames the sign against the GAE value target (V_old + A_raw), not raw vs V_old directly',
          'target' in raw_el.inner_text().lower() and 'v_old' in raw_el.inner_text().lower())
    if norm_sign != 'zero':
        check('Normalized-advantage line explains rollout mean-centering/scaling (not a raw Critic-error claim)',
              'rollout' in norm_el.inner_text().lower())
    check('Calculation caveat explicitly negates a guaranteed probability increase (correct negation, not the bug it negates)',
          'does not guarantee' in calc_text.lower())

    # New arithmetic connection: current-step delta chains into the accumulated
    # raw advantage (delta + future TD-residual sum = A_raw), and that raw
    # advantage chains into the stored GAE value target (V_old + A_raw =
    # target). Both read straight off the real Lesson.gae() object -- no
    # second GAE/normalization is computed here.
    chain_el = p.locator('[data-follow-stage="calculation"] [data-follow-chain]')
    target_el = p.locator('[data-follow-stage="calculation"] [data-follow-target]')
    check('Delta-to-advantage chain equation is visible in the calculation stage', chain_el.count() == 1)
    check('Value-target equation is visible in the calculation stage', target_el.count() == 1)
    chain_nums = [float(x) for x in re.findall(r'-?\d+\.\d+(?:e[+-]?\d+)?', chain_el.inner_text())]
    target_nums = [float(x) for x in re.findall(r'-?\d+\.\d+(?:e[+-]?\d+)?', target_el.inner_text())]
    check('Chain equation shows delta, future and A_raw matching Lesson.gae exactly (NUM: 6dp)',
          len(chain_nums) == 3 and abs(chain_nums[0] - gae['delta']) < 5e-6 and abs(chain_nums[1] - gae['future']) < 5e-6 and abs(chain_nums[2] - gae['raw']) < 5e-6,
          (chain_nums, gae))
    check('Chain equation actually sums: delta + future == A_raw at display precision',
          abs((chain_nums[0] + chain_nums[1]) - chain_nums[2]) < 5e-6, chain_nums)
    check('Target equation shows V_old and A_raw matching the frozen record, summing to Lesson.gae.target (NUM: 6dp)',
          len(target_nums) == 3 and abs(target_nums[0] - calc_before['q']['oldV']) < 5e-6 and abs(target_nums[1] - gae['raw']) < 5e-6 and abs(target_nums[2] - gae['target']) < 5e-6,
          (target_nums, gae))
    check('Target equation actually sums: V_old + A_raw == target at display precision',
          # All three operands are now shown at consistent NUM() 6dp precision.
          abs((target_nums[0] + target_nums[1]) - target_nums[2]) < 5e-6, target_nums)
    check('"future" is explicitly distinguished from a future reward (not fabricated reward language)',
          'not a future reward' in calc_text.lower())
    check('"future" TD-residual sum is scoped to this rollout\'s own episode segment, not every future step',
          'episode segment' in calc_text.lower() and 'done boundary' in calc_text.lower())
    check('Target equation discloses its operands are rounded for display', 'rounded for display' in calc_text.lower())

    # The chain's fuller explanation lives in a closed-by-default <details> --
    # tested both closed (visible summary only) and explicitly opened (deep
    # copy actually present), never asserted while implicitly open.
    chain_details = p.locator('[data-follow-stage="calculation"] details[data-follow-chain-details]')
    check('Chain details element exists and is closed by default', chain_details.count() == 1 and not chain_details.evaluate('e=>e.open'))
    summary_text = chain_details.locator('summary').inner_text()
    check('Closed details shows only its summary text, not the deep copy', chain_details.inner_text() == summary_text)
    chain_details.evaluate('e=>e.open=true')
    p.wait_for_timeout(30)
    opened_text = chain_details.inner_text()
    check('Opened details reveals the deeper GAE walk-back explanation', 'γλ' in opened_text or 'gae' in opened_text.lower())
    chain_details.evaluate('e=>e.open=false')

    click_stage(p, 'action')
    action_text = p.locator('[data-follow-stage="action"]').inner_text()
    check('Action stage distinguishes the recorded physical choice from the learning evaluation',
          'recorded physical choice' in action_text.lower() and 'learning evaluation' in action_text.lower())
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

    # F3: signed probability change in percentage points, correct unit and sign.
    expected_dp_pp = (calc_before['afterP'][action] - calc_before['pa'][action]) * 100
    delta_text = p.locator('[data-follow-stage="result"] [data-follow-delta]').inner_text()
    check('Result shows the unit "pp" for the probability delta', 'pp' in delta_text, delta_text)
    delta_shown_pp = float(re.search(r'(-?\+?[\d.]+)\s*pp', delta_text.replace('+', '')).group(1))
    check('Signed probability-change delta (pp) matches after-before at display precision',
          abs(delta_shown_pp - expected_dp_pp) < 5e-3, (delta_shown_pp, expected_dp_pp))
    check('Positive probability delta is shown with an explicit + sign',
          (expected_dp_pp >= 0) == ('+' in delta_text))
    check('Result explains "pp" as percentage points, not a relative percent change',
          'percentage point' in result_text.lower())

    # F3: one accessible, real recorded optimizer-weight witness (Lesson.weight),
    # matching the stored optimizer state exactly -- not a live/applied update.
    weight_el = p.locator('[data-follow-stage="result"] [data-follow-weight]')
    weight_kind, weight_index = weight_el.get_attribute('data-follow-weight-kind'), int(weight_el.get_attribute('data-follow-weight-index'))
    expected_weight = p.evaluate(f"Lesson.weight(calculation(), '{weight_kind}', {weight_index})")
    weight_text = weight_el.inner_text()
    check('Weight witness label identifies the exact recorded weight', expected_weight['label'] in weight_text, (expected_weight['label'], weight_text))
    nums = [float(x) for x in re.findall(r'-?\d+\.\d+(?:e[+-]?\d+)?', weight_text)]
    check('Weight witness before/after match the stored Lesson.weight at display precision (NUM: 6dp)',
          len(nums) >= 3 and abs(nums[0] - expected_weight['before']) < 5e-6 and abs(nums[1] - expected_weight['after']) < 5e-6,
          (nums, expected_weight))

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

    # F4: real ArrowLeft/Right/Home/End tablist keyboard navigation, with focus
    # returned to the newly active tab after the stage rerender.
    p.locator('[data-follow-stage-nav="0"]').focus()
    p.keyboard.press('ArrowRight')
    p.wait_for_timeout(60)
    check('ArrowRight moves from input to calculation', p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage') == 'calculation')
    check('Focus returns to the newly active tab after ArrowRight', p.evaluate("document.activeElement && document.activeElement.dataset.followStageNav === '1'"))
    p.keyboard.press('ArrowLeft')
    p.wait_for_timeout(60)
    check('ArrowLeft moves back from calculation to input', p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage') == 'input')
    p.keyboard.press('End')
    p.wait_for_timeout(60)
    check('End jumps to the result stage', p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage') == 'result')
    p.keyboard.press('Home')
    p.wait_for_timeout(60)
    check('Home jumps back to the input stage', p.eval_on_selector('.follow-panel', 'e=>e.dataset.followCurrentStage') == 'input')
    check('Active tab keeps tabindex=0 and inactive tabs tabindex=-1 (roving tabindex)',
          p.eval_on_selector_all('[data-follow-stage-nav]', "es => es.every(e => e.tabIndex === (e.dataset.followStageNav === '0' ? 0 : -1))"))

    # Disclosure folding happens only on guide entry/exit, never on every
    # render: a manual expand of the lesson-explanation/support disclosures
    # while the guide stays open must survive stage nav, language switching
    # and idle re-render ticks (updateHardwareReadout fires ~every 130ms).
    p.locator('#lessonDisclosure > summary').click()
    p.locator('#supportDisclosure > summary').click()
    p.wait_for_timeout(30)
    check('Manually expanding the lesson disclosure while the guide is open opens it', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Manually expanding the support disclosure while the guide is open opens it', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    click_stage(p, 'calculation')
    check('Manual lesson-disclosure expansion survives a stage-nav render', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Manual support-disclosure expansion survives a stage-nav render', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    p.select_option('#language', 'ko')
    p.wait_for_timeout(120)
    check('Manual lesson-disclosure expansion survives a language switch', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Manual support-disclosure expansion survives a language switch', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    p.select_option('#language', 'en')
    p.wait_for_timeout(400)
    check('Manual lesson-disclosure expansion survives idle render ticks', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Manual support-disclosure expansion survives idle render ticks', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    click_stage(p, 'input')
    # Exiting the guide still restores the plain default regardless of the
    # manual override -- folding only reacts to entry/exit, but exit always
    # wins back to the normal, always-open state.
    close_guide(p)
    check('Closing the guide restores the lesson disclosure to open even after a manual override', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Closing the guide restores the support disclosure to open even after a manual override', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    check('Closing the guide hides the disclosure summaries again after a manual override', not p.locator('#lessonDisclosure > summary').is_visible() and not p.locator('#supportDisclosure > summary').is_visible())
    open_guide(p)

    # Changing the record invalidates the captured guide.
    p.select_option('#recordSource', 'robust')
    p.wait_for_timeout(150)
    check('Changing source invalidates the guide (explicit stale + recapture, not silent refresh)', p.locator('#followRecapture').count() == 1)
    # Stale state must not blank either disclosure path: the lesson-explanation
    # and support disclosures stay reachable (collapsed, summary visible), not
    # removed/emptied, while the guide body shows the stale/recapture message.
    check('Stale guide still folds the lesson disclosure (collapsed, not blanked)',
          not p.locator('#lessonDisclosure').evaluate('e=>e.open') and p.locator('#lessonDisclosure > summary').is_visible())
    check('Stale guide still folds the support disclosure (collapsed, not blanked)',
          not p.locator('#supportDisclosure').evaluate('e=>e.open') and p.locator('#supportDisclosure > summary').is_visible())
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

    # F2 regression (coordinator finding): a REAL stored record (example I.1,
    # sample 0) where A_raw and normalized A have opposite signs, proving the
    # guide cannot share one "better/worse than the Critic expected" claim
    # between the two. Checked in both languages, then the original record
    # selection is restored.
    original_record = p.eval_on_selector('#recordSelect', 'e => e.value')
    p.select_option('#recordSelect', '1')
    p.evaluate('selectSample(0)')
    fixture_q = p.evaluate('PPOStep.calculation().q')
    check('Fixture record (I.1, sample 0) has real opposite-sign raw/normalized advantage',
          fixture_q['rawAdv'] * fixture_q['adv'] < 0, (fixture_q['rawAdv'], fixture_q['adv']))
    open_guide(p)
    click_stage(p, 'calculation')
    fixture_raw_sign, fixture_norm_sign = sign_of(fixture_q['rawAdv']), sign_of(fixture_q['adv'])
    for lang in ('en', 'ko'):
        if lang == 'ko':
            p.select_option('#language', 'ko')
            p.wait_for_timeout(100)
        raw_el = p.locator('[data-follow-stage="calculation"] [data-follow-sign="raw"]')
        norm_el = p.locator('[data-follow-stage="calculation"] [data-follow-sign="normalized"]')
        expected_raw = expected_sign_text(p, 'calcRaw', fixture_raw_sign, fixture_q['rawAdv'])
        expected_norm = expected_sign_text(p, 'calcNorm', fixture_norm_sign, fixture_q['adv'])
        check(f'{lang}: opposite-sign fixture raw indicator matches real A_raw sign', raw_el.get_attribute('data-follow-sign-value') == fixture_raw_sign, fixture_q['rawAdv'])
        check(f'{lang}: opposite-sign fixture normalized indicator matches real A sign (differs from raw)', norm_el.get_attribute('data-follow-sign-value') == fixture_norm_sign, fixture_q['adv'])
        check(f'{lang}: opposite-sign fixture raw line matches its exact localized text', raw_el.inner_text() == expected_raw, (raw_el.inner_text(), expected_raw))
        check(f'{lang}: opposite-sign fixture normalized line matches its exact localized text', norm_el.inner_text() == expected_norm, (norm_el.inner_text(), expected_norm))
        check(f'{lang}: raw and normalized wording differ for this real opposite-sign fixture', expected_raw != expected_norm)
    p.select_option('#language', 'en')
    close_guide(p)
    p.select_option('#recordSelect', original_record)
    p.wait_for_timeout(80)

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
            if stage == 'calculation':
                # Screenshot-found defect: at narrow 2-column widths the raw
                # numeric tokens (e.g. "gamma*V(next)=97.811277") wrapped mid-digits
                # inside their .term box, splitting a correct value across two
                # lines. A DOM Range over each value's own text content -- not
                # just the box's own client rect -- is the precise way to detect
                # a forced mid-token line break.
                calc_cols = p.evaluate("getComputedStyle(document.querySelector('.follow-calc-grid')).gridTemplateColumns.split(' ').length")
                check(f'{w}px calculation: term grid collapses to a single column at narrow widths', calc_cols == 1, calc_cols) if w <= 600 else \
                    check(f'{w}px calculation: term grid renders at least one column that actually fits the lesson column', calc_cols >= 1, calc_cols)
                value_line_counts = p.eval_on_selector_all(
                    '[data-follow-stage="calculation"] .follow-calc-grid .term b',
                    "es => es.map(e => { const r = document.createRange(); r.selectNodeContents(e); return r.getClientRects().length; })")
                check(f'{w}px calculation: every numeric value stays on one DOM Range line (no mid-number wrap)',
                      len(value_line_counts) == 6 and all(n == 1 for n in value_line_counts), value_line_counts)
                calc_value_sizes = p.eval_on_selector_all('[data-follow-stage="calculation"] .follow-calc-grid .term b', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
                check(f'{w}px calculation: numeric values are >=14px, not shrunk to fit', all(s >= 14 for s in calc_value_sizes), calc_value_sizes)
                # F2 (coordinator finding): the guide now renders inside the narrower
                # lesson column (not the old full-width sourcebar), so a fixed
                # 4-column grid could let a long numeric token overflow past its
                # own .term cell's right/left edge even while it stays on one
                # line and the page itself never scrolls horizontally. Check each
                # value's own rendered Range rect against its own cell's rect,
                # not just page scrollWidth or line count.
                cell_bounds = p.eval_on_selector_all(
                    '[data-follow-stage="calculation"] .follow-calc-grid .term',
                    "es => es.map(e => { const b = e.querySelector('b'); const r = document.createRange(); r.selectNodeContents(b); "
                    "const v = r.getBoundingClientRect(), c = e.getBoundingClientRect(); "
                    "return { valueLeft: v.left, valueRight: v.right, cellLeft: c.left, cellRight: c.right }; })")
                check(f'{w}px calculation: every numeric value stays within its own .term cell bounds (no cross-cell overflow)',
                      len(cell_bounds) == 6 and all(c['valueLeft'] >= c['cellLeft'] - 0.5 and c['valueRight'] <= c['cellRight'] + 0.5 for c in cell_bounds),
                      cell_bounds)
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

    # Closing the guide restores normal chapter exploration exactly as before
    # opening: both disclosures fully open again, summaries hidden, no leftover
    # guide-active chrome, and the plant/source picker are still present.
    check('Closing the guide restores the lesson-explanation disclosure to open (normal exploration)', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Closing the guide restores the support disclosure to open', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    check('Closing the guide removes guide-active chrome', not p.evaluate("document.body.classList.contains('guide-active')"))
    check('Closing the guide hides the disclosure summaries again', not p.locator('#lessonDisclosure > summary').is_visible() and not p.locator('#supportDisclosure > summary').is_visible())
    check('Lesson explanation is directly visible again after closing the guide', p.locator('#lessonBody').is_visible())
    check('Support material is directly visible again after closing the guide', p.locator('#support').is_visible())
    check('Recorded plant/world card is still present after closing the guide', p.locator('.world-card').count() == 1)
    check('Recorded-policy source picker is still present after closing the guide', p.locator('#recordPicker').count() == 1)

    # Chapter change is also an exit path (setChapter collapses the guide): it
    # must restore the original lesson exactly like an explicit close, even
    # from a manually-expanded disclosure state.
    p.click('[data-chapter="3"]')
    p.wait_for_timeout(80)
    open_guide(p)
    p.locator('#lessonDisclosure > summary').click()
    p.wait_for_timeout(30)
    check('Chapter-change setup: guide open and lesson disclosure manually expanded', is_open(p) and p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    p.click('[data-chapter="1"]')
    p.wait_for_timeout(80)
    check('Chapter change closes the guide', not is_open(p))
    check('Chapter change restores the lesson-explanation disclosure to open (normal exploration)', p.locator('#lessonDisclosure').evaluate('e=>e.open'))
    check('Chapter change restores the support disclosure to open', p.locator('#supportDisclosure').evaluate('e=>e.open'))
    check('Chapter change removes guide-active chrome', not p.evaluate("document.body.classList.contains('guide-active')"))
    p.click('[data-chapter="3"]')
    p.wait_for_timeout(80)

    # F3 (coordinator finding): .main-grid must not stretch the world card to
    # match a long open guide's height -- the plant/controls keep their own
    # natural height, top-aligned next to the guide, while the guide is open.
    world_before = p.eval_on_selector('.world-card', 'e=>e.getBoundingClientRect().toJSON()')
    open_guide(p)
    for stage in STAGES:
        click_stage(p, stage)
    world_after = p.eval_on_selector('.world-card', 'e=>e.getBoundingClientRect().toJSON()')
    guide_rect = p.eval_on_selector('#followExperience', 'e=>e.getBoundingClientRect().toJSON()')
    check('Opening a long guide does not stretch the world card taller than its own content',
          world_after['height'] <= world_before['height'] + 2, {'before': world_before, 'after': world_after})
    check('World card top stays adjacent to the guide (top-aligned, not stretched below it)',
          abs(world_after['top'] - guide_rect['top']) < 3, {'world': world_after, 'guide': guide_rect})
    close_guide(p)

    check('No uncaught JavaScript errors', not report['errors'], report['errors'])


if __name__ == '__main__':
    run()
