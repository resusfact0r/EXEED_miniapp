"""Build the additional exact-article allowlist from a redacted, completed review."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'research/article-review-2026-11-17/review.json'
TARGET = ROOT / 'server/src/catalog/reviewed-applications.json'
BASE = ROOT / 'server/src/catalog/article-applications.json'
FORBIDDEN = re.compile(r'https?://|www\.|@|китайавто|xn--|privateProof|documentHash|pdfPage', re.I)
SOURCE_KINDS = {'manufacturer_table', 'catalog_scheme'}


def canonical(value):
    return re.sub(r'[-\s]', '', value).upper()


def build():
    raw = REVIEW.read_bytes()
    review = json.loads(raw)
    assert review['schemaVersion'] == 1
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', review['checkedDate'])
    assert not FORBIDDEN.search(raw.decode()), 'Review must contain facts and opaque witness hashes only'
    targets = review['targetArticleCodes']
    assert len(targets) == len(set(targets)) == 9334, 'Review must cover the frozen queue'
    assert review['summary']['sourcePagesAttempted'] == 13702, 'Source pass is incomplete'
    profiles = review['profiles']
    assert len({json.dumps(p, sort_keys=True) for p in profiles}) == len(profiles)
    for profile in profiles:
        assert set(profile) <= {'brand', 'model', 'configuration', 'modelYearFrom'}
        for key, limit in [('brand', 50), ('model', 80), ('configuration', 180)]:
            assert isinstance(profile[key], str) and 0 < len(profile[key]) <= limit
        if profile['brand'] == 'EXEED' and profile['model'] == 'VX FL':
            assert profile.get('modelYearFrom') == 2024
        elif 'modelYearFrom' in profile:
            assert type(profile['modelYearFrom']) is int and 1990 <= profile['modelYearFrom'] <= 2026
    base_codes = set(json.loads(BASE.read_text())['articles'])
    articles = {}
    used_profiles = set()
    for code, references in review['articles'].items():
        assert code in targets and code not in base_codes, 'Existing mappings must remain unchanged'
        assert references
        indices = []
        for index, source_article, source_kinds, witness_hashes in references:
            assert type(index) is int and 0 <= index < len(profiles)
            assert canonical(code) == canonical(source_article), 'Full article including suffix must match'
            assert re.fullmatch(r'[A-Z0-9]+', canonical(source_article))
            assert source_kinds and set(source_kinds) <= SOURCE_KINDS
            assert witness_hashes and all(re.fullmatch(r'[a-f0-9]{64}', h) for h in witness_hashes)
            assert index not in indices, 'Repeated application'
            indices.append(index)
            used_profiles.add(index)
        articles[code] = sorted(indices)
    assert used_profiles == set(range(len(profiles)))
    held = review['heldArticleCodes']
    assert len(held) == len(set(held)) and set(held) == set(targets) - set(articles)
    assert review['summary']['articlesWithApprovedRelations'] == len(articles)
    assert review['summary']['articlesHeld'] == len(held)
    assert review['summary']['approvedRelations'] == sum(map(len, articles.values()))
    result = {
        'schemaVersion': 1, 'checkedDate': review['checkedDate'],
        'reviewSha256': hashlib.sha256(raw).hexdigest(),
        'profiles': profiles, 'articles': dict(sorted(articles.items())),
    }
    return json.dumps(result, ensure_ascii=False, indent=2) + '\n', review['summary']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    output, summary = build()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != output:
            raise SystemExit('Additional allowlist differs from the completed review; rebuild and review it.')
    else:
        TARGET.write_text(output)
    print(json.dumps(summary, ensure_ascii=False))
