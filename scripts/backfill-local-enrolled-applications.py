"""Backfill local enrolled applications only. Dry-run unless --apply is supplied."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
target = root / 'data' / 'pathway-db.json'
def fingerprint():
    digest = hashlib.sha256()
    with target.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()
before = fingerprint()
with target.open(encoding='utf-8') as source:
    db = json.load(source)
existing = {str(app.get('lead_id')) for app in db.get('applications', [])}
enrolled = [lead for lead in db.get('leads', []) if not lead.get('deleted_at') and str(lead.get('stage', '')).strip().lower() == 'enrolled']
missing = [lead for lead in enrolled if str(lead.get('id')) not in existing]
print(json.dumps({'enrolled_learners': len(enrolled), 'applications': len(db.get('applications', [])), 'missing': len(missing), 'apply': args.apply}))
if not args.apply or not missing:
    raise SystemExit(0)
# Run the actual application factory in isolation: no config, storage or network calls.
factory = r"""
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const scope={exports:{},Date,Buffer,process:{env:{}},require:name=>name==='node:crypto'?crypto:{}};
vm.runInNewContext(fs.readFileSync('server/applications.js','utf8'),scope);
process.stdout.write(JSON.stringify(input.leads.map((lead,i)=>scope.exports.automaticApplicationFromLead(`A-${input.start+i}`,lead,{name:'Local enrolment reconciliation'}))));
"""
numbers = [int(match.group(1)) for app in db.get('applications', []) if (match := re.fullmatch(r'A-(\d+)', str(app.get('id', ''))))]
result = subprocess.run(['node', '-e', factory], cwd=root, input=json.dumps({'leads': missing, 'start': max(numbers, default=0) + 1}), text=True, capture_output=True, check=True)
created = json.loads(result.stdout)
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
for app in created:
    db.setdefault('applications', []).append(app)
    db.setdefault('audit', []).append({'id': 'AU-ENROLLED-' + app['id'], 'actor': 'Local enrolment reconciliation', 'action': 'Application created for enrolled learner', 'entity': 'lead', 'entity_id': app['lead_id'], 'detail': app['id'], 'occurred_at': now})
backup = target.with_name('pathway-db.backup-before-enrolled-applications-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
fd, temporary = tempfile.mkstemp(prefix='enrolled-applications-', suffix='.json', dir=target.parent)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(db, output, ensure_ascii=True, separators=(',', ':'))
        output.flush()
        os.fsync(output.fileno())
    if fingerprint() != before:
        raise RuntimeError('Local database changed during reconciliation; no changes applied. Retry with the local server idle.')
    shutil.copy2(target, backup)
    if fingerprint() != before:
        raise RuntimeError('Local database changed while backing up; no changes applied.')
    os.replace(temporary, target)
    print(json.dumps({'created': len(created), 'applications': len(db['applications']), 'backup': backup.name}))
finally:
    if os.path.exists(temporary):
        os.remove(temporary)
