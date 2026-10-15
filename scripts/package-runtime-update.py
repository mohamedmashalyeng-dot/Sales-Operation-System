"""Create a runtime upload archive from explicit project files; does not deploy."""
import datetime
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name',choices=['call-tasks','business-ai','zoom-overview'],default='call-tasks')
args=parser.parse_args()
files = [root / name for name in ('server.js', 'package.json', 'package-lock.json', 'sw.js')]
for directory in ('server', 'sql', 'frontend/out', 'assets/images'):
    files.extend(path for path in (root / directory).rglob('*') if path.is_file())
files = sorted(set(files))
assert (root / 'frontend/out/index.html').is_file(), 'Build the frontend before packaging.'
for path in files:
    assert path.resolve().is_relative_to(root), 'Refusing a path outside the project.'
    assert not any(part.startswith('.env') or part in ('node_modules', 'data', '.git') for part in path.relative_to(root).parts)
stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).strftime('%Y%m%d-%H%M%S')
destination = root / 'releases' / ('kbc-workspace-' + args.name + '-' + stamp + '.zip')
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root).as_posix())
    archive.writestr('UPLOAD-NOTES.txt', 'Runtime bundle: upload frontend/out, server, sql and root runtime files together.\nPreserve server .env and data. Install root production dependencies if needed and restart the Node application.\nThis archive does not include environment files, local data or node_modules. It has not been uploaded or deployed.\n')
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
print(json.dumps({'archive': str(destination), 'files': len(files), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}))
