"""Narrow-viewport reflow contract: zero page overflow, readable essential text,
touch-sized primary controls, and single-column stacking for dense diagrams.
Real engine/build, no mocked DOM. Can verify a staged/deployed origin with --base-url.
"""
import argparse
import json
import math
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = (320, 390, 768, 1024, 1440)
NARROW = (320, 390)
VIEWPORT_HEIGHT = 900
PRIMARY_CONTROLS = ('#playWorld', '#singleStep', '#resetWorld', '#pushLeft', '#pushRight')

parser = argparse.ArgumentParser()
parser.add_argument('--base-url')
parser.add_argument('--output', type=Path, default=ROOT / 'evidence/responsive-browser')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
report = {'checks': [], 'errors': [], 'origin': args.base_url or 'exact built HTML via set_content'}


def check(name, condition, detail=None):
    if not condition:
        raise AssertionError((name, detail))
    report['checks'].append({'name': name, 'passed': True, **({'detail': detail} if detail is not None else {})})
    print('PASS', name, flush=True)


def rects_overlap(a, b, tolerance=0.5):
    return not (a['right'] <= b['left'] + tolerance or b['right'] <= a['left'] + tolerance
                or a['bottom'] <= b['top'] + tolerance or b['bottom'] <= a['top'] + tolerance)


def no_overlaps(rects):
    return all(not rects_overlap(rects[i], rects[j]) for i in range(len(rects)) for j in range(i + 1, len(rects)))


def stable_font_sizes(page, selector, retries=4):
    """getComputedStyle can transiently return '' mid-reflow under memory
    pressure; retry briefly rather than asserting on a mid-layout read.
    A JS NaN crosses the wire as Python None, not a float, so guard for
    that explicitly instead of relying on NaN's self-inequality."""
    sizes = []
    for attempt in range(retries):
        sizes = page.eval_on_selector_all(selector, 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
        if sizes and all(isinstance(s, (int, float)) and math.isfinite(s) for s in sizes):
            return sizes
        page.wait_for_timeout(150)
    return sizes


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
            (args.output / 'responsive_tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            b.close()
    print('DONE', len(report['checks']))


def _run_checks(p):
    if args.base_url:
        p.goto(args.base_url.rstrip('/') + '/', wait_until='load', timeout=90000)
    else:
        p.set_content((ROOT / 'index.html').read_text(), wait_until='load')
    p.wait_for_function('window.PPOStep && PPOStep.status().ready')

    for lang in ('en', 'ko'):
        if lang == 'ko':
            p.select_option('#language', 'ko')
        for w in WIDTHS:
            p.set_viewport_size({'width': w, 'height': VIEWPORT_HEIGHT})
            for ch in [1, 2, 3, 4, 5]:
                p.click(f'[data-chapter="{ch}"]')
                p.wait_for_timeout(60)
                sw = p.evaluate('document.documentElement.scrollWidth')
                check(f'{lang} {w}px chapter {ch}: no page overflow', sw <= w, sw)
            p.click('#conditionsBtn')
            p.wait_for_timeout(60)
            sw = p.evaluate('document.documentElement.scrollWidth')
            check(f'{lang} {w}px conditions dialog: no page overflow', sw <= w, sw)
            p.click('#closeConditions')
    p.select_option('#language', 'en')

    # #followExperience placement: adjacent to the world on desktop (shares the
    # lesson column, side by side with the plant), immediately after the world
    # card in narrow/stacked order -- never re-derives layout via JS, just the
    # static two-column vs. single-column grid. .main-grid is single-column up
    # to and including 1024px (src/style.css @media(max-width:1024px)), so
    # 320/390/768/1024 are all stacked; only above 1024px is it two-column.
    p.click('[data-chapter="1"]')
    p.wait_for_timeout(60)
    for w in (1440, 1200):
        p.set_viewport_size({'width': w, 'height': VIEWPORT_HEIGHT})
        world_rect = p.eval_on_selector('.world-card', 'e=>e.getBoundingClientRect().toJSON()')
        guide_rect = p.eval_on_selector('#followExperience', 'e=>e.getBoundingClientRect().toJSON()')
        check(f'{w}px desktop: #followExperience sits to the right of the plant, adjacent in the same row',
              guide_rect['left'] >= world_rect['right'] - 0.5 and guide_rect['top'] < world_rect['bottom'],
              {'world': world_rect, 'guide': guide_rect})
    for w in (320, 390, 768, 1024):
        p.set_viewport_size({'width': w, 'height': VIEWPORT_HEIGHT})
        world_rect = p.eval_on_selector('.world-card', 'e=>e.getBoundingClientRect().toJSON()')
        guide_rect = p.eval_on_selector('#followExperience', 'e=>e.getBoundingClientRect().toJSON()')
        check(f'{w}px narrow: #followExperience appears immediately after the plant (stacked single column)',
              guide_rect['top'] >= world_rect['bottom'] - 0.5, {'world': world_rect, 'guide': guide_rect})

    for w in NARROW:
        p.set_viewport_size({'width': w, 'height': VIEWPORT_HEIGHT})
        p.click('[data-chapter="1"]')
        p.wait_for_timeout(80)

        # Decision-chain stacks to one column, and the rotated arrow glyph is
        # confined to the gap between the two neighboring flow-box rectangles
        # (not stretched full-width, which would make it jump onto a box).
        cols = p.evaluate("getComputedStyle(document.querySelector('.decision-chain')).gridTemplateColumns.split(' ').length")
        check(f'{w}px decision-chain is a single column', cols == 1, cols)
        sizes = stable_font_sizes(p, '.decision-chain .flow-box small, .decision-chain .flow-box em, .decision-chain .flow-box strong')
        check(f'{w}px decision-chain flow text is >=14px', all(s >= 14 for s in sizes), sizes)
        # animate() (src/app.js) runs updateEnvironment() as a periodic UI refresh
        # gated by `timestamp - S.lastUI > 130` (~130ms), not on every rAF tick, and
        # this refresh keeps firing even while paused (only physics advance is
        # paused-gated). Each refresh replaces #decisionChain.innerHTML wholesale, so
        # two separate eval_on_selector_all round-trips (query-then-measure) can
        # straddle a replacement and measure a just-detached handle (isConnected=False,
        # zero rect) instead of the live element. Querying and measuring boxes+arrows
        # together in one page.evaluate() is a single synchronous JS turn, immune to
        # that race.
        measured = p.evaluate('''() => {
            const toRect = e => {
                const r = e.getBoundingClientRect();
                return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left,connected:e.isConnected};
            };
            return {
                boxes: Array.from(document.querySelectorAll('.decision-chain .flow-box')).map(toRect),
                arrows: Array.from(document.querySelectorAll('.decision-chain .flow-arrow')).map(toRect),
            };
        }''')
        box_rects, arrow_rects = measured['boxes'], measured['arrows']
        check(f'{w}px decision-chain has 3 flow boxes and 2 arrows', len(box_rects) == 3 and len(arrow_rects) == 2, (len(box_rects), len(arrow_rects)))
        # isConnected alone does not catch display:none (still connected, zero size),
        # so require a positive width AND height together with connectedness.
        check(f'{w}px decision-chain boxes and arrows are connected and have positive size',
              all(r['connected'] and r['width'] > 0 and r['height'] > 0 for r in box_rects + arrow_rects), measured)
        check(f'{w}px decision-chain arrows are confined (<=30px), not full-width', all(r['width'] <= 30 for r in arrow_rects), arrow_rects)
        for i, arrow in enumerate(arrow_rects):
            prev_box, next_box = box_rects[i], box_rects[i + 1]
            check(f'{w}px decision-chain arrow {i} sits in the gap, no overlap with either neighbor',
                  not rects_overlap(arrow, prev_box) and not rects_overlap(arrow, next_box)
                  and arrow['top'] >= prev_box['bottom'] - 0.5 and arrow['bottom'] <= next_box['top'] + 0.5,
                  {'arrow': arrow, 'prev': prev_box, 'next': next_box})

        # world-values collapses to at most 2 columns; 5 separately labeled,
        # non-overlapping readouts (labels, not numeric values, must be distinct
        # since two real physical quantities may legitimately read exactly 0).
        cols2 = p.evaluate("getComputedStyle(document.querySelector('.world-values')).gridTemplateColumns.split(' ').length")
        check(f'{w}px world-values has at most 2 columns', cols2 <= 2, cols2)
        wv_sizes = stable_font_sizes(p, '.world-values small, .world-values strong')
        check(f'{w}px world-values text is >=14px', all(s >= 14 for s in wv_sizes), wv_sizes)
        labels = p.eval_on_selector_all('.world-values small', 'es=>es.map(e=>e.textContent.trim())')
        check(f'{w}px world-values has 5 distinct readable labels', len(labels) == 5 and len(set(labels)) == 5, labels)
        cell_rects = p.eval_on_selector_all('.world-values > div', 'es=>es.map(e=>e.getBoundingClientRect().toJSON())')
        check(f'{w}px world-values cells do not overlap each other', len(cell_rects) == 5 and no_overlaps(cell_rects), cell_rects)

        # Force lane collapses to 2 columns under 600px (src/style.css
        # @media(max-width:600px)), label sits above its value in each cell,
        # cells never overlap, essential text stays >=14px, and the numeric
        # N-value renders as one unbroken token (white-space:nowrap).
        fl_cols = p.evaluate("getComputedStyle(document.querySelector('.force-lane')).gridTemplateColumns.split(' ').length")
        check(f'{w}px force-lane is a 2-column layout', fl_cols == 2, fl_cols)
        fl_sizes = stable_font_sizes(p, '.force-lane small, .force-lane strong')
        check(f'{w}px force-lane text is >=14px', all(s >= 14 for s in fl_sizes), fl_sizes)
        fl_measured = p.evaluate('''() => Array.from(document.querySelectorAll('.force-item')).map(cell => {
            const small = cell.querySelector('small').getBoundingClientRect();
            const strong = cell.querySelector('strong');
            const strongRect = strong.getBoundingClientRect();
            return {
                cell: cell.getBoundingClientRect().toJSON(),
                labelAboveValue: small.bottom <= strongRect.top + 0.5,
                nowrap: getComputedStyle(strong).whiteSpace === 'nowrap',
                text: strong.textContent.trim(),
            };
        })''')
        check(f'{w}px force-lane has 4 cells (commanded/delivered/external/tip)', len(fl_measured) == 4, fl_measured)
        check(f'{w}px force-lane label sits above its value in every cell', all(m['labelAboveValue'] for m in fl_measured), fl_measured)
        check(f'{w}px force-lane numeric value is a single unbroken token (nowrap)', all(m['nowrap'] for m in fl_measured), fl_measured)
        fl_cell_rects = [m['cell'] for m in fl_measured]
        check(f'{w}px force-lane cells do not overlap each other', no_overlaps(fl_cell_rects), fl_cell_rects)

        # Primary touch controls stay >=44px tall.
        heights = {sel: p.locator(sel).bounding_box()['height'] for sel in PRIMARY_CONTROLS}
        check(f'{w}px primary controls are >=44px tall', all(h >= 44 for h in heights.values()), heights)

        # Stepper is compact (2 columns) with titles retained, subtitles dropped.
        step_cols = p.evaluate("getComputedStyle(document.querySelector('.stepper')).gridTemplateColumns.split(' ').length")
        check(f'{w}px stepper is a compact 2-column layout', step_cols == 2, step_cols)
        titles = p.eval_on_selector_all('.stepper button b', 'es=>es.map(e=>e.textContent.trim())')
        check(f'{w}px all 5 chapter titles remain reachable', len(titles) == 5 and all(titles), titles)

        # World stage (the live simulation) appears within THIS test's own
        # 900px-tall viewport, measured from an explicit scroll-to-top so an
        # earlier click's auto-scroll cannot make the check pass by accident.
        p.evaluate('window.scrollTo(0,0)')
        top = p.eval_on_selector('.world-stage', 'e=>e.getBoundingClientRect().top')
        check(f'{w}x{VIEWPORT_HEIGHT} viewport: world stage top is within this viewport height after scrollTo(0,0)',
              0 <= top < VIEWPORT_HEIGHT, {'top': top, 'viewportHeight': VIEWPORT_HEIGHT})

        # Compact network-diagram text: effective on-screen size (accounting for
        # any nested SVG transforms via getScreenCTM) is a documented exception
        # to the >=14px rule, but only because clicking a neuron opens a real,
        # >=14px HTML companion inspector with the same numbers. Verify that
        # inspector actually exists, is visible, and matches the clicked neuron.
        p.click('[data-chapter="2"]')
        p.wait_for_timeout(80)
        hidden_node = p.locator('.hidden-node[data-kind="actor"]').first
        neuron_index = int(hidden_node.get_attribute('data-neuron'))
        info = p.evaluate('''() => {
            const svg = document.querySelector(".network-svg");
            const t = svg.querySelector(".hidden-node text") || svg.querySelector("text");
            const ctm = t.getScreenCTM();
            // Text sits on the vertical (font-size) axis, so its on-screen scale
            // is how the matrix maps the unit vector (0,1), i.e. hypot(c,d) -
            // not ctm.a, which is the horizontal-axis scale and ignores any
            // rotation/skew between the SVG's user space and the screen.
            const verticalScale = Math.hypot(ctm.c, ctm.d);
            return {effectivePx: verticalScale * parseFloat(t.getAttribute("font-size"))};
        }''')
        check(f'{w}px network SVG compact text has a nonzero effective size (diagram-only, has companion below)', info['effectivePx'] > 0, info)
        hidden_node.click()
        p.wait_for_timeout(80)
        micro = p.locator('#neuronMicroscope')
        check(f'{w}px clicking a neuron opens the HTML companion inspector, visible', micro.is_visible())
        micro_text = micro.inner_text()
        check(f'{w}px companion inspector identity matches the clicked neuron (h{neuron_index + 1}, actor)',
              f'h{neuron_index + 1}' in micro_text and 'Actor' in micro_text, micro_text[:120])
        # .term small is the compact "o1 x W1[..]" notation label (documented
        # exception); .term b is the actual numeric result, the key readout.
        term_font_sizes = stable_font_sizes(p, '#neuronMicroscope .term b')
        check(f'{w}px companion inspector key numeric readouts are >=14px', len(term_font_sizes) > 0 and all(s >= 14 for s in term_font_sizes), term_font_sizes)
        p.click('[data-chapter="1"]')

    _scene_force_provenance_checks(p)
    check('No uncaught JavaScript errors', not report['errors'], report['errors'])


# Public visual-scene contract constants (src/app.js SCENE) -- documented shared
# geometry, not a private implementation detail: replicated here to independently
# verify the renderer and the #world click-to-goal handler agree, instead of
# trusting the same source file to grade itself.
SCENE = {'refW': 640, 'refH': 320, 'worldScale': 110, 'centerX': 320}
OLD_ARROW_COLORS = [(0x32, 0x7d, 0xe0), (0xc5, 0x7b, 0x20), (0xb8, 0x92, 0x62), (0xdb, 0xb8, 0x86)]


def _canvas_has_color(p, selector, rgb, tolerance=2):
    return p.eval_on_selector(selector, '''(canvas, [r, g, b, tol]) => {
        const ctx = canvas.getContext('2d');
        const {width, height} = canvas;
        const data = ctx.getImageData(0, 0, width, height).data;
        for (let i = 0; i < data.length; i += 4) {
            if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol && data[i + 3] > 200)
                return true;
        }
        return false;
    }''', list(rgb) + [tolerance])


def _click_target_x(p, w, goal_x):
    """Click the track at a screen position corresponding to a known physical
    goal_x (inside +-1, the slider's real clip range), using the SAME public
    SCENE constants the renderer uses, and read back the real physics goal
    (PPOStep.status().liveGoal) that the click actually set -- not a UI label."""
    rect = p.eval_on_selector('#world', 'e=>e.getBoundingClientRect().toJSON()')
    k = min(rect['width'] / SCENE['refW'], rect['height'] / SCENE['refH'])
    ox = (rect['width'] - SCENE['refW'] * k) / 2
    ref_x = SCENE['centerX'] + goal_x * SCENE['worldScale']
    pos_x = ox + ref_x * k
    pos_y = rect['height'] * 0.8
    p.locator('#world').click(position={'x': pos_x, 'y': pos_y})
    p.wait_for_timeout(60)
    goal = p.evaluate('window.PPOStep.status().liveGoal')
    check(f'{w}px click-to-goal: clicking physical x={goal_x} m sets the real plant goal within one slider step',
          goal is not None and abs(goal - goal_x) <= 0.051, {'requested': goal_x, 'actualLiveGoal': goal, 'rect': rect, 'k': k})


def _scene_force_provenance_checks(p):
    p.set_viewport_size({'width': 1024, 'height': VIEWPORT_HEIGHT})
    p.click('[data-chapter="1"]')
    p.wait_for_timeout(80)

    contract = p.eval_on_selector('#world', 'e=>e.dataset.sceneContract')
    check('#world exposes data-scene-contract="cartpole-v1"', contract == 'cartpole-v1', contract)

    # No leftover pixels from the removed in-canvas force arrows (blue/amber) or
    # the old brown pole fill -- real pixel inspection, not trust in markup.
    for color in OLD_ARROW_COLORS:
        present = _canvas_has_color(p, '#world', color)
        check(f'#world canvas has no leftover pixels of removed color rgb{color}', not present, color)

    # The canvas is a live render tied to real physics, not a static image.
    before = p.eval_on_selector('#world', "c=>c.toDataURL()")
    p.click('#singleStep')
    p.wait_for_timeout(60)
    after = p.eval_on_selector('#world', "c=>c.toDataURL()")
    check('#world canvas pixels actually change after a real physics step', before != after, None)

    # Force lane: same scene() event the renderer just drew from, read together
    # with the DOM in one synchronous call so there is no render-vs-read race.
    zero_read = p.evaluate('''() => {
        window.updateForceLane();
        const el = document.getElementById('forceLane');
        const items = Array.from(el.querySelectorAll('.force-item strong')).map(e => e.textContent.trim());
        const f = window.PPOStep.scene();
        return {items, f};
    }''')
    external_n = float(zero_read['items'][2].split(' ')[0])
    tip_n = float(zero_read['items'][3].split(' ')[0])
    check('force lane shows numeric 0.00 N (not blank/omitted) when external force is at rest',
          external_n == 0.0 and '0.00' in zero_read['items'][2], zero_read['items'])
    check('force lane external/tip readouts equal the real scene() values at rest',
          abs(external_n - (zero_read['f'].get('externalForce') or 0)) < 0.005
          and abs(tip_n - (zero_read['f'].get('tipForce') or 0)) < 0.005, zero_read)

    # A long-running suite may have let the episode terminate (autoReset is off
    # by default), or left it paused (#singleStep above intentionally pauses,
    # same as the real UI); beginHold() correctly refuses both. Use the real
    # app entry points (resetWorld()/#playWorld) to restore a fresh, running
    # live episode instead of poking internal state.
    st = p.evaluate('window.PPOStep.status()')
    if st['liveTerminated'] or st['liveTruncated']:
        p.evaluate('window.resetWorld()')
        p.wait_for_timeout(60)
    if p.evaluate('window.PPOStep.status().paused'):
        p.click('#playWorld')
        p.wait_for_timeout(60)

    # Drive a real held tip-force via the actual interaction path (beginHold/
    # heldForce/physics()), not a mocked value, then read command/delivered/tip
    # together against the same real scene() the lane renders from.
    p.evaluate("window.beginHold('provenance_probe', 1)")
    p.wait_for_timeout(400)
    hold_read = p.evaluate('''() => {
        window.updateForceLane();
        const el = document.getElementById('forceLane');
        const items = Array.from(el.querySelectorAll('.force-item strong')).map(e => e.textContent.trim());
        const labels = Array.from(el.querySelectorAll('.force-item small')).map(e => e.textContent.trim());
        const f = window.PPOStep.scene();
        window.releaseHold();
        return {items, labels, f};
    }''')
    cmd_n = float(hold_read['items'][0].split(' ')[0])
    delivered_n = float(hold_read['items'][1].split(' ')[0])
    tip_n2 = float(hold_read['items'][3].split(' ')[0])
    f = hold_read['f']
    delivered_real = (f.get('drive') or {}).get('contactForce')
    if delivered_real is None:
        delivered_real = f.get('motorForce') or 0
    check('force lane "commanded" equals real scene().command (the recorded/commanded force), not delivered',
          abs(cmd_n - (f.get('command') or 0)) < 0.01, hold_read)
    check('force lane "delivered" equals real actuator-delivered force (drive.contactForce/motorForce), not the raw command',
          abs(delivered_n - delivered_real) < 0.01, hold_read)
    total_incl_disturbance = (f.get('command') or 0) + (f.get('externalForce') or 0) + (f.get('tipForce') or 0)
    check('commanded/delivered are never silently redefined as "total force incl. disturbance" (delivered != command+external+tip while a real disturbance is active)',
          abs(f.get('tipForce') or 0) < 1e-9 or abs(delivered_real - total_incl_disturbance) > 1e-6, {'delivered': delivered_real, 'totalInclDisturbance': total_incl_disturbance, **f})
    check('held tip-push actually produced a nonzero real tip force (real interaction path, not a mock)',
          abs(f.get('tipForce') or 0) > 0.0001, f.get('tipForce'))
    check('force lane "tip-applied" reading matches the real scene().tipForce for this exact event',
          abs(tip_n2 - (f.get('tipForce') or 0)) < 0.01, hold_read)
    check('tip-applied label says "tip", not "cart"', 'tip' in hold_read['labels'][3].lower() and 'cart' not in hold_read['labels'][3].lower(), hold_read['labels'])

    # Click-to-goal <-> letterboxed renderer agreement at 320/390/1440.
    for w in (320, 390, 1440):
        p.set_viewport_size({'width': w, 'height': VIEWPORT_HEIGHT})
        p.click('[data-chapter="1"]')
        p.wait_for_timeout(80)
        _click_target_x(p, w, 0.6)
        _click_target_x(p, w, -0.35)
    p.set_viewport_size({'width': 1024, 'height': VIEWPORT_HEIGHT})


if __name__ == '__main__':
    run()
