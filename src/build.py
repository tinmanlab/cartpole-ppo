"""Build the English-first bilingual viewer and a Korean entry from one engine.

No network requests or third-party Python packages are needed to build.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding='utf-8')


def catalog() -> str:
    data = {lang: json.loads((REPO / 'locales' / f'{lang}.json').read_text(encoding='utf-8'))
            for lang in ('en', 'ko')}
    extra = json.loads((REPO / 'locales' / 'interaction.json').read_text(encoding='utf-8'))
    for lang in data:
        if data[lang].keys() & extra[lang].keys():
            raise ValueError('Duplicate interaction message key.')
        data[lang].update(extra[lang])
    if data['en'].keys() != data['ko'].keys():
        raise ValueError('English and Korean must have identical message keys.')
    for key in data['en']:
        for lang in data:
            if not isinstance(data[lang][key], str):
                raise ValueError(f'Message {lang}:{key} is not a string.')
        placeholders = lambda text: sorted(re.findall(r'\{\d+\}', text))
        if placeholders(data['en'][key]) != placeholders(data['ko'][key]):
            raise ValueError(f'Placeholder mismatch: {key}')
    return 'const I18N_CATALOG = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';\n'


def build(language: str = 'en') -> str:
    robust_extension = 'const ROBUST_WORKER_SOURCE = ' + json.dumps(read('robust_worker.js'), ensure_ascii=False) + ';\n' + read('robust_ui.js')
    extension = '\n'.join(read(name) for name in ('extension.js', 'locale_refresh.js', 'ui_extra.js', 'interaction.js', 'follow_experience.js')) + '\n' + robust_extension
    if read('app.js').count('/* EXTENSION */') != 1:
        raise ValueError('The app must have exactly one extension slot.')
    parts = {
        'STYLE': read('style.css') + '\n' + read('interaction.css'),
        'I18N': catalog() + read('i18n.js') + '\n' + read('locale_boot.js'),
        'CORE': '\n'.join(read(name) for name in ('bam_params.js', 'plant.js', 'core.js', 'robust_v2.js')),
        'LESSON': read('lesson.js'), 'WORKER': read('worker.js'),
        'EXAMPLE': read('example.json').replace('</', '<\\/'),
        'ROBUST': read('example_robust.json').replace('</', '<\\/'),
        'APP': read('wheel_data.js') + '\n' + read('wheel_render.js') + '\n' + read('app.js').replace('/* EXTENSION */', extension),
    }
    text = read('shell.html')
    for key, value in parts.items():
        token = '/* ' + key + ' */'
        if text.count(token) != 1:
            raise ValueError(f'Expected exactly one template marker: {token}')
        text = text.replace(token, value)
    text = text.replace('data-default-lang="en"', f'data-default-lang="{language}"')
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=REPO / 'index.html')
    parser.add_argument('--lang', choices=['en', 'ko'], default='en')
    parser.add_argument('--check', action='store_true', help='Fail if generated viewer bytes differ from the source build.')
    args = parser.parse_args()
    targets = [(args.output, args.lang)]
    if args.output.resolve() == (REPO / 'index.html').resolve():
        targets.append((REPO / 'viewer.ko.html', 'ko'))
    for out, lang in targets:
        data = build(lang).encode('utf-8')
        if args.check:
            if not out.exists() or out.read_bytes() != data:
                raise SystemExit(f'Build is stale: {out}')
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
        print(f'{out.name}: {len(data):,} bytes ({lang}, same engine)')


if __name__ == '__main__':
    main()
