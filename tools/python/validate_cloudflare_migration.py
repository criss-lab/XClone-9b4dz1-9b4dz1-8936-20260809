from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
errors = []

pkg = json.loads((ROOT / 'package.json').read_text())
if '@supabase/supabase-js' in pkg.get('dependencies', {}):
    errors.append('Supabase SDK remains in package.json')

for required in [
    ROOT / 'cloudflare' / 'wrangler.jsonc',
    ROOT / 'cloudflare' / 'worker' / 'index.ts',
    ROOT / 'cloudflare' / 'd1' / 'migrations' / '0001_auth.sql',
    ROOT / 'cloudflare' / 'd1' / 'migrations' / '0002_app.sql',
    ROOT / 'src' / 'lib' / 'cloudflare.ts',
]:
    if not required.exists():
        errors.append(f'missing required Cloudflare file: {required.relative_to(ROOT)}')

for path in (ROOT / 'src').rglob('*'):
    if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.js', '.jsx'}:
        continue
    text = path.read_text(errors='ignore')
    if "@supabase/supabase-js" in text:
        errors.append(f'Supabase SDK import remains: {path.relative_to(ROOT)}')
    if 'VITE_SUPABASE_' in text:
        errors.append(f'Supabase Vite environment variable remains: {path.relative_to(ROOT)}')

if errors:
    print('Cloudflare migration validation FAILED')
    print('\n'.join(f'- {e}' for e in errors))
    raise SystemExit(1)

print('Cloudflare migration validation passed: no Supabase SDK/client env usage remains in src.')
