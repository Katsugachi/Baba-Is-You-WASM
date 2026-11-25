import json
import os
import sys

repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
path = os.path.join(repo, 'web', 'game-data.json')
with open(path, encoding='utf-8') as f:
    bundle = json.load(f)

errors = []
if len(bundle.get('tiles', {})) < 150:
    errors.append('tile metadata is incomplete')
if len(bundle.get('texts', {})) < 600:
    errors.append('level metadata text bundle is incomplete')
levels = bundle.get('levels', {})
if len(levels.get('baba', {})) < 280:
    errors.append('baba campaign levels are incomplete')
first = levels.get('baba', {}).get('0level')
if not first:
    errors.append('0level is missing')
else:
    if (first.get('w'), first.get('h')) != (35, 20):
        errors.append(f"0level dimensions are wrong: {first.get('w')}x{first.get('h')}")
    placements = sum(len(layer) for layer in first.get('layers', []))
    if placements < 50:
        errors.append(f'0level has too few object placements: {placements}')
for world, world_levels in levels.items():
    for name, level in world_levels.items():
        if not level.get('layers'):
            errors.append(f'{world}/{name} has no layers')
        elif level['w'] <= 2 or level['h'] <= 2:
            errors.append(f'{world}/{name} has invalid dimensions')

if errors:
    for error in errors[:50]:
        print(error, file=sys.stderr)
    sys.exit(1)
print(f"validated {sum(len(v) for v in levels.values())} levels and {len(bundle['texts'])} metadata files")
