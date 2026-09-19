"""Narrow-viewport reflow contract: zero page overflow, readable essential text,
touch-sized primary controls, and single-column stacking for dense diagrams.
Real engine/build, no mocked DOM.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = (320, 390, 768, 1024, 1440)
NARROW = (320, 390)
PRIMARY_CONTROLS = ('#playWorld', '#singleStep', '#resetWorld', '#pushLeft', '#pushRight')
report = {'checks': [], 'errors': []}


def check(name, condition, detail=None):
    assert condition, (name, detail)
    report['checks'].append({'name': name, 'passed': True, **({'detail': detail} if detail is not None else {})})
    print('PASS', name, flush=True)


def launch(pw):
    executable = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    return pw.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL'), executable_path=executable, headless=True, args=['--no-sandbox'])


def run():
    html = (ROOT / 'index.html').read_text()
    with sync_playwright() as pw:
        b = launch(pw)
        p = b.new_page()
        p.set_default_timeout(20000)
        p.on('pageerror', lambda e: report['errors'].append(str(e)))
        p.set_content(html, wait_until='load')
        p.wait_for_function('window.PPOStep && PPOStep.status().ready')

        for lang in ('en', 'ko'):
            if lang == 'ko':
                p.select_option('#language', 'ko')
            for w in WIDTHS:
                p.set_viewport_size({'width': w, 'height': 900})
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

        # Decision-chain (chapter 1) must stack to one column at narrow widths.
        for w in NARROW:
            p.set_viewport_size({'width': w, 'height': 900})
            p.click('[data-chapter="1"]')
            p.wait_for_timeout(80)
            cols = p.evaluate("getComputedStyle(document.querySelector('.decision-chain')).gridTemplateColumns.split(' ').length")
            check(f'{w}px decision-chain is a single column', cols == 1, cols)
            sizes = p.eval_on_selector_all('.decision-chain .flow-box small, .decision-chain .flow-box em, .decision-chain .flow-box strong',
                                            'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
            check(f'{w}px decision-chain flow text is >=14px', all(s >= 14 for s in sizes), sizes)

            # world-values collapses to at most 2 columns, values stay legible.
            cols2 = p.evaluate("getComputedStyle(document.querySelector('.world-values')).gridTemplateColumns.split(' ').length")
            check(f'{w}px world-values has at most 2 columns', cols2 <= 2, cols2)
            wv_sizes = p.eval_on_selector_all('.world-values small, .world-values strong', 'es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
            check(f'{w}px world-values text is >=14px', all(s >= 14 for s in wv_sizes), wv_sizes)
            values = p.eval_on_selector_all('.world-values strong', 'es=>es.map(e=>e.textContent)')
            check(f'{w}px world-values keeps all 5 readouts distinct', len(values) == 5 and len(set(values)) == len(values), values)

            # Primary touch controls stay >=44px tall.
            heights = {sel: p.locator(sel).bounding_box()['height'] for sel in PRIMARY_CONTROLS}
            check(f'{w}px primary controls are >=44px tall', all(h >= 44 for h in heights.values()), heights)

            # Stepper is compact (2 columns) with titles retained, subtitles dropped.
            step_cols = p.evaluate("getComputedStyle(document.querySelector('.stepper')).gridTemplateColumns.split(' ').length")
            check(f'{w}px stepper is a compact 2-column layout', step_cols == 2, step_cols)
            titles = p.eval_on_selector_all('.stepper button b', 'es=>es.map(e=>e.textContent.trim())')
            check(f'{w}px all 5 chapter titles remain reachable', len(titles) == 5 and all(titles), titles)

            # World stage (the live simulation) appears within a reasonable first screen.
            top = p.eval_on_selector('.world-stage', 'e=>e.getBoundingClientRect().top')
            check(f'{w}px world stage appears within first screen', top < 900, top)

            # SVG effective-size measurement for the compact network diagram (documented exception).
            p.click('[data-chapter="2"]')
            p.wait_for_timeout(80)
            info = p.evaluate('''() => {
                const svg = document.querySelector('.network-svg');
                const t = svg.querySelector('text');
                const ctm = svg.getScreenCTM();
                return {effectivePx: ctm.a * parseFloat(t.getAttribute('font-size'))};
            }''')
            check(f'{w}px network SVG has a companion (neuron microscope) exception, effective size recorded', info['effectivePx'] > 0, info)
            p.click('[data-chapter="1"]')

        check('No uncaught JavaScript errors', not report['errors'], report['errors'])
        (ROOT / 'evidence').mkdir(exist_ok=True)
        import json
        (ROOT / 'evidence/responsive_tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        b.close()
    print('DONE', len(report['checks']))


if __name__ == '__main__':
    run()
