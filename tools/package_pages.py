"""Stage the already verified standalone viewer, without rebuilding its bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
FILES = ('index.html', 'viewer.ko.html', 'README.md', 'README.ko.md', 'LICENSE', 'THIRD_PARTY.md')
DIRECTORIES = ('docs', 'archive/ko', 'licenses')


def stage(root: Path, destination: Path, revision: str) -> dict:
    root, destination = root.resolve(), destination.resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('A complete commit SHA is required.')
    if destination == root or root.is_relative_to(destination):
        raise ValueError('The destination must not contain the source repository.')
    paths = [root / name for name in FILES]
    paths += [p for name in DIRECTORIES for p in (root / name).rglob('*') if p.is_file()]
    for source in paths:
        if source.is_symlink() or not source.resolve().is_relative_to(root) or not source.is_file():
            raise ValueError(f'Unsafe or missing site file: {source}')
    destination.mkdir(parents=True, exist_ok=False)
    manifest = {'schema': 'cartpole-pages/v1', 'revision': revision, 'files': {}}
    for source in sorted(paths):
        relative = source.relative_to(root)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        data = target.read_bytes()
        manifest['files'][relative.as_posix()] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    (destination / '.nojekyll').write_text('')
    (destination / 'deployment.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--destination', type=Path, default=ROOT / '_site')
    args = parser.parse_args()
    report = stage(ROOT, args.destination, args.revision)
    print(f"Staged {len(report['files'])} files for {report['revision']}")
