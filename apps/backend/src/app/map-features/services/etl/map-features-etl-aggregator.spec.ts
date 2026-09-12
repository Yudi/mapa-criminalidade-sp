import { getSourceTableConfig } from '../../config/source-tables.config';
import {
  createEtlAggregationQuality,
  MapFeaturesEtlAggregator,
} from './map-features-etl-aggregator';

describe('MapFeaturesEtlAggregator', () => {
  const tableName = 'celulares_2026';
  const config = getSourceTableConfig(tableName);
  const columns = new Set([
    'ID',
    'NUM_BO',
    'ANO_BO',
    'LATITUDE',
    'LONGITUDE',
    'NOME_DELEGACIA',
    'RUBRICA',
  ]);

  if (!config) {
    throw new Error('Expected celulares source configuration');
  }

  function row(
    id: number,
    numBo: string,
    latitude = '-23.550010',
    longitude = '-46.633010',
    rubrica = 'Furto'
  ): Record<string, unknown> {
    return {
      id,
      NUM_BO: numBo,
      ANO_BO: '2026',
      LATITUDE: latitude,
      LONGITUDE: longitude,
      NOME_DELEGACIA: '01º DP',
      RUBRICA: rubrica,
      __etl_sort_num_bo: numBo.trim().toUpperCase(),
      __etl_sort_ano_bo: 2026,
      __etl_sort_delegacia: '01º DP',
      __etl_sort_latitude_bucket: Number(latitude).toFixed(6),
      __etl_sort_longitude_bucket: Number(longitude).toFixed(6),
    };
  }

  it('projects MDIP using registration-unit identity and excludes zero coordinates', () => {
    const mdip = getSourceTableConfig('mdip');
    if (!mdip) throw new Error('Expected MDIP adapter');
    const value = {
      id: 1,
      NUM_BO: 'MDIP-TEST',
      ANO_BO: '2026',
      DP_ELABORACAO: '01 DP',
      DP_CIRCUNSCRICAO: '02 DP',
      LATITUDE: '-23.55',
      LONGITUDE: '-46.63',
      DATA_FATO: '2026-01-02',
      HORA_FATO: '09:30',
      NATUREZA_APURADA: 'MORTE DECORRENTE DE INTERVENÇÃO POLICIAL',
      __etl_sort_num_bo: 'MDIP-TEST',
      __etl_sort_ano_bo: '2026',
      __etl_sort_delegacia: '01 DP',
      __etl_sort_latitude_bucket: '-23.550000',
      __etl_sort_longitude_bucket: '-46.630000',
    };
    const quality = createEtlAggregationQuality();
    const result = new MapFeaturesEtlAggregator().aggregateRows(
      [value, { ...value, id: 2, LATITUDE: '0', LONGITUDE: '0' }],
      'mdip',
      mdip,
      new Set(Object.keys(value)),
      undefined,
      quality
    );
    expect(result.size).toBe(1);
    const feature = Array.from(result.values())[0];
    expect(feature.delegacia).toBe('01 DP');
    expect(feature.data_ocorrencia?.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z'
    );
    expect(feature.feature_data.occurrence.delegacia_circunscricao).toBe(
      '02 DP'
    );
    expect(feature.feature_data.records[0]).toMatchObject({
      source_table: 'mdip',
      type: 'dados_criminais',
    });
    expect(quality.outsideSupportedAreaRows).toBe(1);
  });

  it('hashes database coordinate buckets independently of the raw rounding tie', () => {
    const aggregator = new MapFeaturesEtlAggregator();
    const first = row(1, 'BO-1', '-23.5000005');
    const second = row(2, 'BO-1', '-23.5000006');
    first.__etl_sort_latitude_bucket = '-23.500001';
    second.__etl_sort_latitude_bucket = '-23.500001';
    const hash = (value: Record<string, unknown>) =>
      Array.from(
        aggregator.aggregateRows([value], tableName, config, columns).values()
      )[0].location_hash;
    expect(hash(first)).toBe(hash(second));
  });

  it('keeps a canonical group intact across batch boundaries', () => {
    const aggregator = new MapFeaturesEtlAggregator();
    const quality = createEtlAggregationQuality();
    const firstBatch = aggregator.aggregateRows(
      [row(1, ' BO-1 '), row(2, 'BO-1')],
      tableName,
      config,
      columns,
      undefined,
      quality
    );
    const { completed: firstCompleted, nextCarryover } =
      aggregator.splitFinalAggregatedFeature(firstBatch);

    expect(firstCompleted.size).toBe(0);

    const secondBatch = aggregator.aggregateRows(
      [row(3, 'BO-1'), row(4, 'BO-2')],
      tableName,
      config,
      columns,
      nextCarryover,
      quality
    );
    const { completed, nextCarryover: finalCarryover } =
      aggregator.splitFinalAggregatedFeature(secondBatch);

    expect(completed.size).toBe(1);
    expect(
      Array.from(completed.values())[0].feature_data.summary.total_records
    ).toBe(3);
    expect(finalCarryover.size).toBe(1);
    expect(quality.acceptedRows).toBe(4);
  });

  it('does not merge nearby coordinates that only match at four decimals', () => {
    const aggregator = new MapFeaturesEtlAggregator();
    const features = aggregator.aggregateRows(
      [
        row(1, 'BO-1', '-23.550010', '-46.633010'),
        row(2, 'BO-1', '-23.550040', '-46.633040'),
      ],
      tableName,
      config,
      columns
    );

    expect(features.size).toBe(2);
    expect(
      new Set(Array.from(features.values()).map((item) => item.location_hash))
        .size
    ).toBe(2);
  });

  it('selects canonical feature metadata independently of row order', () => {
    const aggregator = new MapFeaturesEtlAggregator();
    const forward = aggregator.aggregateRows(
      [row(1, 'BO-1', undefined, undefined, 'Roubo'), row(2, 'BO-1')],
      tableName,
      config,
      columns
    );
    const reverse = aggregator.aggregateRows(
      [row(2, 'BO-1'), row(1, 'BO-1', undefined, undefined, 'Roubo')],
      tableName,
      config,
      columns
    );

    expect(Array.from(forward.values())[0].category).toBe(
      Array.from(reverse.values())[0].category
    );
  });
});
