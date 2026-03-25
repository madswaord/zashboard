import json
from pathlib import Path

src = Path('/root/zashboard/src/assets/maps/world.json')
dst = Path('/root/zashboard/src/assets/maps/world-atlantic.json')

SEAM = 20  # Atlantic seam around 20E

data = json.loads(src.read_text())


def norm(lng: float) -> float:
    while lng > 180:
        lng -= 360
    while lng < -180:
        lng += 360
    return lng


def shift_point(coord):
    lng, lat = coord
    lng = norm(lng)
    if lng > SEAM:
        lng -= 360
    return [lng, lat]


def walk(obj):
    if obj is None:
        return obj
    if not isinstance(obj, list):
        return obj
    if len(obj) == 0:
        return obj
    first = obj[0]
    if isinstance(first, (int, float)) and len(obj) >= 2:
        return shift_point(obj)
    return [walk(item) for item in obj]


for feat in data.get('features', []):
    geom = feat.get('geometry')
    if geom and 'coordinates' in geom:
        geom['coordinates'] = walk(geom['coordinates'])

dst.write_text(json.dumps(data))
print(dst, dst.stat().st_size)
