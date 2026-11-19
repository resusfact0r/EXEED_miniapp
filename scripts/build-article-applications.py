"""Rebuild the reviewed article allowlist offline; --check validates committed output."""
import argparse
import collections
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'research/kitaiavto-2026-11-17/evidence.json'
TARGET = ROOT / 'server/src/catalog/article-applications.json'
BRANDS = {
    'zapcasti-Chery': ('CHERY', 'Chery'),
    'zapcasti-exeed': ('EXEED', 'EXEED|EXLANTIX'),
    'zapcasti-omoda': ('OMODA', 'OMODA'),
    'zapcasti-jaecoo': ('JAECOO', 'Jaecoo'),
    'tenet': ('TENET', 'TENET'), 'jetour': ('JETOUR', 'Jetour'),
    'zapcasti-jeland': ('JELAND', 'JELAND'), 'vortex': ('VORTEX', 'Vortex'),
    'SOUEAST': ('SOUEAST', 'SOUEAST'),
    'zapcasti_TENET_Plus': ('TENET PLUS', 'TENET Plus'), 'KAIYI': ('KAIYI', 'Kaiyi'),
}


def canonical(code):
    return re.sub(r'[-\s]', '', code).upper()


def build():
    raw = EVIDENCE.read_bytes()
    evidence = json.loads(raw)
    with (ROOT / 'server/data/chery-catalog.csv').open(encoding='utf-8-sig') as file:
        codes = {row['code'] for row in csv.DictReader(file)}
    codes.update(evidence['liveArticleCodes'])
    by_canonical = collections.defaultdict(list)
    for code in sorted(codes):
        by_canonical[canonical(code)].append(code)
    corroborated = set(evidence['corroboratedArticleUrls'])
    profiles, articles, held = [], collections.defaultdict(list), collections.Counter()
    for document in sorted(evidence['documents'], key=lambda d: d['url']):
        url, title, heading = document['url'], document['title'], document['heading']
        if not heading or len(title.split(' — ')) < 2:
            held['missing_vehicle_or_configuration'] += 1
            continue
        branch = url.split('/')[4]
        if branch not in BRANDS:
            held['unsupported_vehicle_label'] += 1
            continue
        brand, aliases = BRANDS[branch]
        match = re.search(r'\b(' + aliases + r')\s+(.+)$', heading, re.I)
        if not match:
            held['unsupported_vehicle_label'] += 1
            continue
        model = re.sub(r'\bMAX\b', 'Max', match[2].strip())
        if match[1].upper() == 'EXLANTIX':
            model = 'EXLANTIX ' + model
        configuration = title.rsplit(' | ', 1)[0].split(' — ')[-1].strip()
        # Keep uncertainty out of the allowlist, including incomplete powertrain labels.
        if (not re.search(r'\d\.\d', configuration)
                or not re.search(r'CVT|DCT|\dAT|\dMT|\bAT\b|\bMT\b|АКПП|МКПП|AMT|DHT', configuration, re.I)
                or '№' in model
                or (brand == 'JETOUR' and model == 'Dashing' and '8AT' in configuration)
                or '7DCT300' in configuration):
            held['unresolved_configuration_scope'] += 1
            continue
        assert len(brand) <= 50 and len(model) <= 80
        profile = {'brand': brand, 'model': model, 'configuration': configuration, 'schemeUrl': url}
        if brand == 'EXEED' and model == 'VX FL':
            profile['modelYearFrom'] = 2024
        index = len(profiles)
        profiles.append(profile)
        for row in document['rows']:
            key = canonical(row['article'])
            if len(key) < 6 or len(by_canonical.get(key, [])) != 1:
                continue
            source_url = url + '/' + key
            if source_url not in corroborated:
                continue
            assert re.fullmatch(r'[A-Z0-9]+', key)
            assert re.fullmatch(r'[\d.,-]+', row['position'])
            code = by_canonical[key][0]
            articles[code].append([index, row['position'], key])
    for code, refs in articles.items():
        seen, unique = set(), []
        for reference in refs:
            profile = profiles[reference[0]]
            key = (profile['brand'], profile['model'], profile['configuration'])
            if key not in seen:
                seen.add(key)
                unique.append(reference)
        articles[code] = unique
    used = sorted({ref[0] for refs in articles.values() for ref in refs})
    remap = {old: new for new, old in enumerate(used)}
    result = {
        'schemaVersion': 1, 'sourceName': evidence['sourceName'],
        'sourceOrigin': evidence['sourceOrigin'], 'checkedDate': evidence['checkedDate'],
        'sourceEvidenceSha256': hashlib.sha256(raw).hexdigest(),
        'profiles': [profiles[index] for index in used],
        'articles': {code: [[remap[r[0]], r[1], r[2]] for r in refs] for code, refs in sorted(articles.items())},
    }
    summary = {'articles': len(articles), 'liveArticles': len(set(articles) & set(evidence['liveArticleCodes'])),
               'applications': sum(map(len, articles.values())), 'profiles': len(used),
               'heldDocuments': dict(held)}
    return json.dumps(result, ensure_ascii=False, indent=2) + '\n', summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    output, summary = build()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != output:
            raise SystemExit('Article allowlist differs from reviewed evidence; rebuild and review it.')
    else:
        TARGET.write_text(output)
    print(json.dumps(summary, ensure_ascii=False))
