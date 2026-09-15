"""Static hosting contract; no network or browser dependency."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_pages', ROOT / 'tools/package_pages.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

class PagesContract(unittest.TestCase):
    def test_staged_bytes_and_allowlist(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'site'
            report = package.stage(ROOT, target, 'a' * 40)
            self.assertEqual(report['revision'], 'a' * 40)
            for name in ('index.html', 'viewer.ko.html', 'docs/media/walkthrough.mp4', 'docs/media/demo.gif', 'archive/ko/bam-studio.original.html', 'archive/en/body-pulse.v2.html'):
                self.assertEqual((target / name).read_bytes(), (ROOT / name).read_bytes())
                self.assertEqual(report['files'][name]['sha256'], hashlib.sha256((ROOT / name).read_bytes()).hexdigest())
            self.assertTrue((target / '.nojekyll').is_file())
            self.assertFalse((target / 'src').exists())
            self.assertFalse((target / '.git').exists())
            self.assertEqual(json.loads((target / 'deployment.json').read_text()), report)

    def test_bad_revision_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                package.stage(ROOT, Path(folder) / 'site', '../main')

    def test_source_and_existing_destination_never_overwritten(self):
        with self.assertRaises(ValueError):
            package.stage(ROOT, ROOT, 'a' * 40)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'site'
            target.mkdir()
            with self.assertRaises(FileExistsError):
                package.stage(ROOT, target, 'a' * 40)

    def test_project_subpath_links(self):
        from html.parser import HTMLParser
        from urllib.parse import urlparse, unquote
        links = []
        class Parser(HTMLParser):
            def handle_starttag(self, tag, attrs):
                for key, value in attrs:
                    if key in ('src', 'href', 'poster') and value:
                        links.append(value)
        page = ROOT / 'docs/demo.html'
        Parser().feed(page.read_text())
        for link in links:
            url = urlparse(link)
            if url.scheme or not url.path:
                continue
            self.assertFalse(url.path.startswith('/'), link)
            self.assertTrue((page.parent / unquote(url.path)).is_file(), link)

if __name__ == '__main__':
    unittest.main(verbosity=2)
