import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { Geometry } from 'geojson';

@Entity('boletins_ocorrencia')
export class BoletimOcorrencia {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_departamento: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_seccional: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_delegacia: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cidade: string | null;

  @Column({ type: 'int', nullable: true })
  ano_bo: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  num_bo: string | null;

  @Column({ type: 'date', nullable: true })
  data_registro: Date | null;

  @Column({ type: 'date', nullable: true })
  data_ocorrencia_bo: Date | null;

  @Column({ type: 'time', nullable: true })
  hora_ocorrencia_bo: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descr_periodo: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descr_subtipolocal: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  bairro: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  logradouro: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  numero_logradouro: string | null;

  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_delegacia_circunscricao: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_departamento_circunscricao: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_seccional_circunscricao: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nome_municipio_circunscricao: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rubrica: string | null;

  @Column({ type: 'varchar', length: 510, nullable: true })
  descr_conduta: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  natureza_apurada: string | null;

  @Column({ type: 'int', nullable: true })
  mes_estatistica: number | null;

  @Column({ type: 'int', nullable: true })
  ano_estatistica: number | null;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: Geometry | null;
}
