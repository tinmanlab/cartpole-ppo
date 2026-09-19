"""Narrow-viewport reflow contract: zero page overflow, readable essential text,
touch-sized primary controls, and single-column stacking for dense diagrams.
Real engine/build, no mocked DOM. Can verify a staged/deployed origin with --base-url.
"""
import argparse
import json
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
    pressure; retry briefly rather than asserting on a mid-layout read."""
    for attempt in range(retries):
        sizes = page.eval_on_selector_all(selector, 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
        if sizes and all(s == s for s in sizes):  # s==s is False only for NaN
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
            box_rects = p.eval_on_selector_all('.decision-chain .flow-box', 'es=>es.map(e=>e.getBoundingClientRect().toJSON())')
            arrow_rects = p.eval_on_selector_all('.decision-chain .flow-arrow', 'es=>es.map(e=>e.getBoundingClientRect().toJSON())')
            check(f'{w}px decision-chain has 3 flow boxes and 2 arrows', len(box_rects) == 3 and len(arrow_rects) == 2, (len(box_rects), len(arrow_rects)))
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
                return {effectivePx: ctm.a * parseFloat(t.getAttribute("font-size"))};
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

        check('No uncaught JavaScript errors', not report['errors'], report['errors'])
        (args.output / 'responsive_tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        b.close()
    print('DONE', len(report['checks']))


if __name__ == '__main__':
    run()
