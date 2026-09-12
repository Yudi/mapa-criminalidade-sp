import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { CensusLevel } from '@mapa-criminalidade/shared-types';

@ObjectType()
export class CensusReleaseObject {
  @Field() id!: string;
  @Field(() => Int) year!: number;
  @Field(() => Int) municipalityCount!: number;
  @Field(() => Int) neighborhoodCount!: number;
}
@ObjectType()
export class CensusIndicatorObject {
  @Field() key!: string;
  @Field() group!: string;
  @Field() label!: string;
  @Field(() => Float, { nullable: true }) value!: number | null;
  @Field() unit!: string;
  @Field(() => Float, { nullable: true }) denominator!: number | null;
  @Field() sourceUrl!: string;
  @Field() variables!: string;
  @Field(() => String, { nullable: true }) universe!: string | null;
}
@ObjectType()
export class CensusAreaSummaryObject {
  @Field() releaseId!: string;
  @Field(() => String) level!: CensusLevel;
  @Field() code!: string;
  @Field() name!: string;
  @Field() municipalityName!: string;
}
@ObjectType()
export class CensusAreaObject extends CensusAreaSummaryObject {
  @Field(() => Int) year!: number;
  @Field(() => Int, { nullable: true }) population!: number | null;
  @Field(() => Float) areaKm2!: number;
  @Field(() => [Float]) bounds!: number[];
  @Field(() => [CensusIndicatorObject]) indicators!: CensusIndicatorObject[];
}
@ObjectType()
export class CensusCrimeStatsObject {
  @Field(() => Float) occurrences!: number;
  @Field(() => Float, { nullable: true }) per100k!: number | null;
  @Field() after!: string;
  @Field() before!: string;
}
