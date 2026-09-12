#!/usr/bin/env python3
"""Backend worker asset: prepare a compact SP-only census release. No database access.
Requires GDAL Python bindings (osgeo); raw national archives are temporary.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import re
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def number(raw):
    value = str(raw).strip()
    if value in ('', '.', '..', '...', 'X', 'x', 'None'):
        return None
    if value == '-':
        return 0
    value = value.replace(',', '.')
    if not re.fullmatch(r'\d+(?:\.\d+)?', value):
        raise ValueError(f'Unexpected IBGE value: {raw!r}')
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Nonfinite value')
    return int(result) if result.is_integer() else result


def total(row, variables):
    values = [number(row[v.upper()]) for v in variables]
    return None if not values or any(v is None for v in values) else sum(values)


def indicator(row, spec, url):
    value = total(row, spec['variables'])
    denominator = total(row, spec['denominator'])
    return dict(key=spec['key'], group=spec['group'], label=spec['label'],
                value=value, unit=spec['unit'], denominator=denominator,
                sourceUrl=url, variables=' + '.join(spec['variables']),
                universe=' / '.join(spec['denominator']) or None)


def download(url, path, sources, checksums=None):
    request = urllib.request.Request(url, headers={'User-Agent': 'mapa-criminalidade-census-import/1'})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=120) as response, path.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    if checksums and url in checksums and digest.hexdigest() != checksums[url]:
        raise ValueError(f'Source changed; review the manifest before replacing this release: {url}')
    sources.append(dict(url=url, sha256=digest.hexdigest()))
    return path


def read_aggregates(path, level, specs, url):
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith('.csv')]
        if len(names) != 1:
            raise ValueError(f'Expected one CSV: {names}')
        # IBGE aggregate CSVs are Latin-1 with semicolon delimiters.
        with io.TextIOWrapper(archive.open(names[0]), encoding='latin1') as stream:
            reader = csv.DictReader(stream, delimiter=';')
            fields = {f.upper() for f in reader.fieldnames or []}
            required = ({'CD_MUN'} if level == 'municipality' else {'CD_BAIRRO'}) | {v.upper() for s in specs for v in s['variables'] + s['denominator']}
            if level == 'neighborhood':
                required.add('CD_BAIRRO')
            if not required <= fields:
                raise ValueError(f'Missing columns in {url}: {required - fields}')
            for original in reader:
                row = {k.upper(): v for k, v in original.items() if k}
                municipality = row.get('CD_MUN') or row.get('CD_BAIRRO', '')[:7]
                if not municipality.startswith('35'):
                    continue
                if row.get('CD_UF', '35') != '35':
                    raise ValueError('Contradictory state code')
                code = row['CD_BAIRRO'] if level == 'neighborhood' else row['CD_MUN']
                yield code, [indicator(row, s, url) for s in specs]


def prepare(manifest, output):
    from osgeo import ogr, osr
    ogr.UseExceptions()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Output directory must be empty; releases are immutable')
    sources, records, counts = [], {}, {}
    with tempfile.TemporaryDirectory(prefix='raw-', dir=output) as raw:
        raw = Path(raw)
        for level, url in manifest['geometries'].items():
            path = download(url, raw / ('geometry.zip' if url.endswith('.zip') else 'geometry.gpkg'), sources, manifest.get('checksums'))
            dataset = ogr.Open('/vsizip/' + str(path) if url.endswith('.zip') else str(path))
            layer = dataset.GetLayer(0)
            target = osr.SpatialReference()
            target.ImportFromEPSG(4326)
            target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            source = layer.GetSpatialRef()
            source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            transform = osr.CoordinateTransformation(source, target)
            count = 0
            for feature in layer:
                attrs = feature.items()
                code = str(attrs['CD_MUN'] if level == 'municipality' else attrs['CD_BAIRRO'])
                if not str(attrs['CD_MUN']).startswith('35'):
                    continue
                geometry = feature.GetGeometryRef().Clone()
                geometry.FlattenTo2D()
                geometry.Transform(transform)
                if not geometry.IsValid() or geometry.IsEmpty():
                    raise ValueError(f'Invalid source geometry: {level}/{code}')
                key = level + ':' + code
                if key in records:
                    previous = records[key]
                    if previous['name'] != attrs['NM_BAIRRO'] or previous['municipalityCode'] != str(attrs['CD_MUN']):
                        raise ValueError(f'Inconsistent multipart neighborhood: {key}')
                    merged = ogr.CreateGeometryFromJson(json.dumps(previous['geometry'])).Union(geometry)
                    if not merged.IsValid():
                        raise ValueError(f'Invalid dissolved geometry: {key}')
                    previous['geometry'] = json.loads(merged.ExportToJson())
                    continue
                records[key] = dict(code=code, level=level, municipalityCode=str(attrs['CD_MUN']),
                    municipalityName=attrs['NM_MUN'], name=attrs['NM_MUN'] if level == 'municipality' else attrs['NM_BAIRRO'],
                    geometry=json.loads(geometry.ExportToJson()), indicators=[])
                count += 1
            counts[level] = count
            dataset = None
            path.unlink()
            print(f'{level}: {count} polygons', flush=True)
            for theme, url in manifest['sources'][level].items():
                specs = [s for s in manifest['indicators'] if s['theme'] == theme]
                path = download(url, raw / 'aggregate.zip', sources, manifest.get('checksums'))
                seen = set()
                for code, values in read_aggregates(path, level, specs, url):
                    key = level + ':' + code
                    if key not in records:
                        raise ValueError(f'Aggregate has no matching geometry: {key}')
                    if key in seen:
                        raise ValueError(f'Duplicate aggregate: {key}/{theme}')
                    seen.add(key)
                    records[key]['indicators'].extend(values)
                if len(seen) != count:
                    if theme not in manifest.get('allowMissingThemes', []):
                        raise ValueError(f'Incomplete join: {level}/{theme}: {len(seen)} of {count}')
                    missing = [key for key, record in records.items() if record['level'] == level and key not in seen]
                    sources[-1]['missingAreaCount'] = len(missing)
                    null_row = {v: '.' for s in specs for v in s['variables'] + s['denominator']}
                    for key in missing:
                        records[key]['indicators'].extend(indicator(null_row, s, url) for s in specs)
                    print(f'  {theme}: {len(missing)} areas absent from source, retained as null', flush=True)
                path.unlink()
                print(f'  {theme}: retained {len(seen)} SP rows', flush=True)
        education = manifest.get('education')
        if education:
            path = download(education['url'], raw / 'education.json', sources, manifest.get('checksums'))
            result = json.loads(path.read_text())[0]
            by_code = {}
            for group in result['resultados']:
                category = next(str(next(iter(c['categoria']))) for c in group['classificacoes'] if str(c['id']) == '1568')
                for series in group['series']:
                    code = series['localidade']['id']
                    if not code.startswith('35'):
                        raise ValueError('Education query returned another state')
                    values = by_code.setdefault(code, {})
                    if category in values:
                        raise ValueError('Duplicate education category')
                    values[category] = number(series['serie'][str(manifest['year'])])
            if len(by_code) != counts['municipality']:
                raise ValueError('Incomplete education municipality coverage')
            for code, values in by_code.items():
                for category, label in education['categories'].items():
                    records['municipality:' + code]['indicators'].append(dict(
                        key='education' + category, group='Escolaridade - 18 anos ou mais', label=label,
                        value=values[category], unit='count', denominator=values[education['total']],
                        sourceUrl=education['sourceUrl'], variables='SIDRA 10061 / 2667 / 1568:' + category,
                        universe='Pessoas de 18 anos ou mais; resultados da amostra'))
            path.unlink()
    if counts['municipality'] != manifest['expectedMunicipalities'] or counts.get('neighborhood', 0) != manifest['expectedNeighborhoods']:
        raise ValueError('Unexpected geographic coverage')
    data_path = output / 'areas.ndjson'
    with data_path.open('w') as stream:
        for key in sorted(records):
            record = records[key]
            population = next(i['value'] for i in record['indicators'] if i['key'] == 'population')
            record['population'] = population
            stream.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
    digest = hashlib.file_digest(data_path.open('rb'), 'sha256').hexdigest()
    release = dict(id=manifest['id'], year=manifest['year'], stateCode='35', counts=counts,
                   dataSha256=digest, sources=sources, dictionaries=manifest['dictionaries'])
    (output / 'release.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(counts=counts, bytes=data_path.stat().st_size, sha256=digest)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('manifest.json'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(json.loads(args.manifest.read_text()), args.output)
