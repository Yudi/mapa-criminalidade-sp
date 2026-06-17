import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CategoryStatObject {
  @Field()
  name!: string;

  @Field(() => Int)
  count!: number;

  @Field()
  rubricaForStyling!: string;

  @Field()
  sourceType!: string;
}

@ObjectType()
export class PeriodStatObject {
  @Field()
  name!: string;

  @Field(() => Int)
  count!: number;
}

@ObjectType()
export class MapFeatureCategoryPeriodStatsObject {
  @Field(() => [CategoryStatObject])
  categories!: CategoryStatObject[];

  @Field(() => [PeriodStatObject])
  periods!: PeriodStatObject[];
}

@ObjectType()
export class ChartBucketObject {
  @Field()
  label!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => Float, { nullable: true })
  amount?: number | null;
}

@ObjectType()
export class MapFeatureChartsObject {
  @Field(() => Int)
  totalFeatures!: number;

  @Field(() => Int)
  totalRecords!: number;

  @Field(() => [ChartBucketObject])
  categoryDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  periodDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  weekdayDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  recordTypeDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  objectTypeDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  vehicleBrandDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  phoneBrandDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  locationTypeDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  policeCircumscriptionDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  policeUnitDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  weaponTypeDistribution!: ChartBucketObject[];

  @Field(() => [ChartBucketObject])
  drugTypeDistribution!: ChartBucketObject[];
}

@ObjectType()
export class DateRangeObject {
  @Field(() => String, { nullable: true })
  earliest!: string | null;

  @Field(() => String, { nullable: true })
  latest!: string | null;

  @Field(() => String, { nullable: true })
  defaultAfter!: string | null;
}

@ObjectType()
export class MapFeatureMetadataObject {
  @Field()
  format!: string;

  @Field(() => Int)
  minZoom!: number;

  @Field(() => Int)
  maxZoom!: number;

  @Field(() => [String])
  layers!: string[];

  @Field(() => [String])
  availableCategories!: string[];

  @Field(() => [String])
  availableRubricas!: string[];

  @Field(() => [String])
  availablePeriods!: string[];

  @Field(() => [CategoryStatObject])
  categoryStats!: CategoryStatObject[];

  @Field(() => [PeriodStatObject])
  periodStats!: PeriodStatObject[];

  @Field(() => DateRangeObject)
  dateRange!: DateRangeObject;

  @Field(() => Int)
  totalFeatures!: number;

  @Field()
  tileUrlTemplate!: string;
}

@InputType()
export class MapFeatureBoundsInput {
  @Field(() => Float)
  minLon!: number;

  @Field(() => Float)
  minLat!: number;

  @Field(() => Float)
  maxLon!: number;

  @Field(() => Float)
  maxLat!: number;
}

@InputType()
export class MapFeatureFilterInput {
  @Field({ nullable: true })
  beforeDate?: string;

  @Field({ nullable: true })
  afterDate?: string;

  @Field(() => [String], { nullable: true })
  categories?: string[];

  @Field(() => [String], { nullable: true })
  periods?: string[];

  @Field(() => Int, { nullable: true })
  startHour?: number;

  @Field(() => Int, { nullable: true })
  endHour?: number;

  @Field(() => MapFeatureBoundsInput, { nullable: true })
  bounds?: MapFeatureBoundsInput;
}

@InputType()
export class MapFeatureLocationInput {
  @Field(() => Float)
  longitude!: number;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  radius!: number;

  @Field({ nullable: true })
  beforeDate?: string;

  @Field({ nullable: true })
  afterDate?: string;

  @Field(() => [String], { nullable: true })
  periods?: string[];

  @Field(() => Int, { nullable: true })
  startHour?: number;

  @Field(() => Int, { nullable: true })
  endHour?: number;
}

@InputType()
export class MapFeatureLookupInput {
  @Field()
  numBo!: string;

  @Field(() => Int, { nullable: true })
  anoBo?: number;

  @Field(() => String, { nullable: true })
  delegacia?: string | null;
}

@ObjectType()
export class MapFeatureSummaryObject {
  @Field()
  id!: string;

  @Field()
  numBo!: string;

  @Field(() => Int)
  anoBo!: number;

  @Field(() => String, { nullable: true })
  delegacia!: string | null;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field()
  category!: string;

  @Field()
  rubricaForStyling!: string;

  @Field(() => String, { nullable: true })
  dataOcorrencia!: string | null;

  @Field(() => [String])
  sourceTables!: string[];
}

@ObjectType()
export class LocationDataObject {
  @Field({ nullable: true })
  logradouro?: string;

  @Field({ nullable: true })
  numero?: string;

  @Field({ nullable: true })
  bairro?: string;

  @Field({ nullable: true })
  cidade?: string;

  @Field({ nullable: true })
  cep?: string;

  @Field({ nullable: true })
  tipo_local?: string;

  @Field({ nullable: true })
  subtipo_local?: string;
}

@ObjectType()
export class OccurrenceMetadataObject {
  @Field({ nullable: true })
  hora_ocorrencia?: string;

  @Field({ nullable: true })
  periodo?: string;

  @Field({ nullable: true })
  delegacia?: string;

  @Field({ nullable: true })
  delegacia_circunscricao?: string;

  @Field({ nullable: true })
  departamento?: string;

  @Field({ nullable: true })
  seccional?: string;

  @Field({ nullable: true })
  natureza_apurada?: string;

  @Field({ nullable: true })
  conduta?: string;

  @Field({ nullable: true })
  autoria?: string;

  @Field(() => Boolean, { nullable: true })
  flagrante?: boolean;

  @Field({ nullable: true })
  data_registro?: string;

  @Field({ nullable: true })
  data_comunicacao?: string;
}

@ObjectType()
export class SourceRecordObject {
  @Field()
  type!: string;

  @Field(() => Int)
  source_id!: number;

  @Field()
  source_table!: string;

  @Field({ nullable: true })
  rubrica?: string;

  @Field({ nullable: true })
  descr_modo_objeto?: string;

  @Field({ nullable: true })
  descr_tipo_objeto?: string;

  @Field({ nullable: true })
  descr_subtipo_objeto?: string;

  @Field({ nullable: true })
  descr_ocorrencia?: string;

  @Field({ nullable: true })
  descricao_apresentacao?: string;

  @Field({ nullable: true })
  marca?: string;

  @Field(() => Int, { nullable: true })
  quantidade?: number;

  @Field(() => Boolean, { nullable: true })
  bloqueio?: boolean;

  @Field(() => Boolean, { nullable: true })
  desbloqueio?: boolean;

  @Field({ nullable: true })
  tipo_veiculo?: string;

  @Field({ nullable: true })
  cor?: string;

  @Field({ nullable: true })
  placa?: string;

  @Field(() => Int, { nullable: true })
  ano_fabricacao?: number;

  @Field(() => Int, { nullable: true })
  ano_modelo?: number;

  @Field({ nullable: true })
  natureza_apurada?: string;

  @Field({ nullable: true })
  conduta?: string;

  @Field({ nullable: true })
  tipo_arma?: string;

  @Field({ nullable: true })
  calibre?: string;

  @Field({ nullable: true })
  tipo_droga?: string;

  @Field(() => Float, { nullable: true })
  quantidade_gramas?: number;

  @Field({ nullable: true })
  tipo_pessoa?: string;

  @Field({ nullable: true })
  sexo?: string;

  @Field(() => Int, { nullable: true })
  idade?: number;

  @Field({ nullable: true })
  profissao?: string;

  @Field({ nullable: true })
  grau_instrucao?: string;

  @Field({ nullable: true })
  nacionalidade?: string;
}

@ObjectType()
export class FeatureDataSummaryObject {
  @Field(() => Int)
  total_records!: number;

  @Field(() => Int)
  celulares_count!: number;

  @Field(() => Int)
  veiculos_count!: number;

  @Field(() => Int)
  objetos_count!: number;

  @Field(() => Int)
  dados_criminais_count!: number;

  @Field(() => Int)
  produtividade_count!: number;
}

@ObjectType()
export class MapFeatureDataObject {
  @Field(() => LocationDataObject)
  location!: LocationDataObject;

  @Field(() => OccurrenceMetadataObject)
  occurrence!: OccurrenceMetadataObject;

  @Field(() => [String])
  all_rubricas!: string[];

  @Field(() => [SourceRecordObject])
  records!: SourceRecordObject[];

  @Field(() => FeatureDataSummaryObject)
  summary!: FeatureDataSummaryObject;
}

@ObjectType()
export class ImlRecordObject {
  @Field(() => Int)
  sourceId!: number;

  @Field()
  sourceTable!: string;

  @Field(() => String, { nullable: true })
  dataEntradaIml!: string | null;

  @Field(() => String, { nullable: true })
  anoBo!: string | null;

  @Field(() => String, { nullable: true })
  numBo!: string | null;

  @Field(() => String, { nullable: true })
  delegaciaRegistro!: string | null;

  @Field(() => String, { nullable: true })
  numeroLaudo!: string | null;

  @Field(() => String, { nullable: true })
  anoLaudo!: string | null;

  @Field(() => String, { nullable: true })
  idadeVitima!: string | null;

  @Field(() => String, { nullable: true })
  tipoIdade!: string | null;

  @Field(() => String, { nullable: true })
  conclusao!: string | null;

  @Field(() => String, { nullable: true })
  declaracaoObito!: string | null;

  @Field(() => String, { nullable: true })
  causaMortis!: string | null;
}

@ObjectType()
export class MapFeatureDetailObject extends MapFeatureSummaryObject {
  @Field(() => MapFeatureDataObject)
  featureData!: MapFeatureDataObject;

  @Field(() => [ImlRecordObject])
  imlRecords!: ImlRecordObject[];
}

@ObjectType()
export class UnifiedOccurrenceObject {
  @Field()
  id!: string;

  @Field()
  sourceTable!: string;

  @Field()
  numBo!: string;

  @Field(() => Int, { nullable: true })
  anoBo!: number | null;

  @Field()
  category!: string;

  @Field()
  rubricaForStyling!: string;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field(() => String, { nullable: true })
  dataOcorrencia!: string | null;

  @Field(() => String, { nullable: true })
  horaOcorrencia!: string | null;

  @Field(() => String, { nullable: true })
  dataRegistro!: string | null;

  @Field(() => String, { nullable: true })
  logradouro!: string | null;

  @Field(() => String, { nullable: true })
  numeroLogradouro!: string | null;

  @Field(() => String, { nullable: true })
  bairro!: string | null;

  @Field(() => String, { nullable: true })
  cidade!: string | null;

  @Field(() => String, { nullable: true })
  localTipo!: string | null;

  @Field(() => String, { nullable: true })
  periodo!: string | null;

  @Field(() => String, { nullable: true })
  conduta!: string | null;

  @Field(() => String, { nullable: true })
  naturezaApurada!: string | null;

  @Field(() => String, { nullable: true })
  delegacia!: string | null;
}

@ObjectType()
export class GroupedOccurrenceObject {
  @Field()
  numBo!: string;

  @Field(() => Int)
  anoBo!: number;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field()
  primaryCategory!: string;

  @Field(() => [String])
  allCategories!: string[];

  @Field(() => Int)
  recordCount!: number;

  @Field(() => [String])
  sourceTables!: string[];

  @Field(() => [UnifiedOccurrenceObject])
  occurrences!: UnifiedOccurrenceObject[];
}

@ObjectType()
export class EtlStatusObject {
  @Field()
  source_table!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  rows_processed!: number;

  @Field(() => String, { nullable: true })
  last_etl_at!: string | null;

  @Field(() => String, { nullable: true })
  error_message!: string | null;
}
