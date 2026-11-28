#!/usr/bin/env bash
# Downloads every pack in sources.json into tools/art/cache/<id>/ and checks its sha256.
# Usage (repo root): bash tools/art/fetch.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p cache
python3 - <<'PY'
import json, hashlib, os, subprocess, zipfile
packs = json.load(open('sources.json'))['packs']
for pid, p in packs.items():
    dest = os.path.join('cache', pid)
    if os.path.isdir(dest):
        print('have', pid); continue
    out = os.path.join('cache', pid + os.path.splitext(p['file'])[1])
    subprocess.run(['curl', '-sfL', '-m', '300', p['file'], '-o', out], check=True)
    sha = hashlib.sha256(open(out, 'rb').read()).hexdigest()
    if p.get('sha256') and p['sha256'] != sha:
        raise SystemExit(f'{pid}: checksum changed ({sha}); check the page and licence before updating sources.json')
    if out.endswith('.zip'):
        zipfile.ZipFile(out).extractall(dest)
    else:
        os.makedirs(dest); os.replace(out, os.path.join(dest, os.path.basename(out)))
    n = sum(len(f) for _, _, f in os.walk(dest))
    print(f'got {pid}: {n} files, sha256 {sha}')
PY
